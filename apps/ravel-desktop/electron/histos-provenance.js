/**
 * Histos provenance primitives.
 *
 * This module owns validation and content-addressed artifact I/O only. Durable
 * fact persistence remains delegated to the Agent/session-facts writer.
 */
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  FACT_SOURCE_TYPES,
  canonicalFactAddress,
  canonicalJson,
  factAddressId,
  formatFactAddress,
  validateFactAddress,
} from "./histos-address.js";

export { FACT_SOURCE_TYPES, canonicalFactAddress, canonicalJson, factAddressId, formatFactAddress, validateFactAddress };

export const ARTIFACT_KINDS = Object.freeze(["graph_revision", "flow_revision", "context_set"]);
export const FACT_SELECTOR_KINDS = Object.freeze(["span", "hunk", "json_path", "node", "edge"]);
export const EVIDENCE_ROLES = Object.freeze(["supports", "quotes", "produces", "navigates"]);

export const MAX_HASH_LENGTH = 64;
export const MAX_WORKSPACE_ID_LENGTH = 128;
export const MAX_FACT_ID_LENGTH = 1024;
export const MAX_SELECTOR_LENGTH = 4096;
export const MAX_SOURCE_SET_ITEMS = 4096;
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_ARTIFACT_ARRAY_ITEMS = 100_000;
export const MAX_ARTIFACT_PARENTS = 256;
export const MAX_EVIDENCE_ITEMS = 100_000;
export const MAX_NODE_OR_EDGE_ID_LENGTH = 512;
export const MAX_TITLE_LENGTH = 4096;

const ARTIFACT_KIND_SET = new Set(ARTIFACT_KINDS);
const EVIDENCE_ROLE_SET = new Set(EVIDENCE_ROLES);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.code = "not_found";
  return error;
}

function integrity(message) {
  const error = new Error(message);
  error.code = "integrity_error";
  return error;
}

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label} must be a plain object`);
  return value;
}

function boundedString(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) throw invalid(`${label} must be a non-empty string`);
  if (value.length > maximum) throw invalid(`${label} must be at most ${maximum} characters`);
  if (CONTROL_PATTERN.test(value)) throw invalid(`${label} must not contain control characters`);
  return value;
}

export function validateWorkspaceId(workspaceId) {
  const value = boundedString(workspaceId, "workspaceId", MAX_WORKSPACE_ID_LENGTH);
  if (/[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) throw invalid("workspaceId must not be a path");
  return value;
}

export function validateSha256(value, label = "sha256") {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw invalid(`${label} must be a 64-character lowercase SHA-256 hex string`);
  return value;
}

function validateHashOrId(value, label) {
  return boundedString(value, label, MAX_NODE_OR_EDGE_ID_LENGTH);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateBoundedJson(value, label, depth = 0, count = { value: 0 }) {
  if (depth > 12) throw invalid(`${label} is too deeply nested`);
  count.value += 1;
  if (count.value > MAX_SOURCE_SET_ITEMS) throw invalid(`${label} contains too many values`);
  if (typeof value === "string") {
    if (value.length > MAX_SELECTOR_LENGTH || CONTROL_PATTERN.test(value)) throw invalid(`${label} contains an invalid string`);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return;
  if (Array.isArray(value)) {
    if (value.length > MAX_SOURCE_SET_ITEMS) throw invalid(`${label} contains too many items`);
    for (const [index, item] of value.entries()) validateBoundedJson(item, `${label}[${index}]`, depth + 1, count);
    return;
  }
  requirePlainObject(value, label);
  for (const [key, item] of Object.entries(value)) {
    boundedString(key, `${label} key`, MAX_SELECTOR_LENGTH, { allowEmpty: true });
    if (/(?:^|_)sha(?:s)?$/i.test(key) || /artifact(?:s)?$/i.test(key)) {
      const values = Array.isArray(item) ? item : [item];
      for (const hash of values) validateSha256(hash, `${label}.${key}`);
    }
    validateBoundedJson(item, `${label}.${key}`, depth + 1, count);
  }
}

function validateArtifactArray(items, label, validator) {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > MAX_ARTIFACT_ARRAY_ITEMS) throw invalid(`${label} must be a bounded array`);
  return items.map((item, index) => validator(item, `${label}[${index}]`));
}

function validateNode(node, label) {
  requirePlainObject(node, label);
  const nodeRevisionId = node.nodeRevisionId ?? node.revisionId;
  validateHashOrId(node.nodeId, `${label}.nodeId`);
  validateHashOrId(nodeRevisionId, `${label}.nodeRevisionId`);
  if (node.kind !== undefined) boundedString(node.kind, `${label}.kind`, 64);
  if (node.title !== undefined) boundedString(node.title, `${label}.title`, MAX_TITLE_LENGTH, { allowEmpty: true });
  if (node.artifactSha !== undefined) validateSha256(node.artifactSha, `${label}.artifactSha`);
  return { ...node, nodeRevisionId };
}

function validateEdge(edge, label) {
  requirePlainObject(edge, label);
  validateHashOrId(edge.edgeRevisionId ?? edge.revisionId, `${label}.edgeRevisionId`);
  validateHashOrId(edge.edgeId, `${label}.edgeId`);
  validateHashOrId(edge.srcNodeId, `${label}.srcNodeId`);
  validateHashOrId(edge.dstNodeId, `${label}.dstNodeId`);
  if (edge.kind !== undefined) boundedString(edge.kind, `${label}.kind`, 64);
  if (edge.artifactSha !== undefined) validateSha256(edge.artifactSha, `${label}.artifactSha`);
  return { ...edge, edgeRevisionId: edge.edgeRevisionId ?? edge.revisionId };
}

/** Validate the durable GraphRevision/FlowRevision/ContextSet JSON contract. */
export function validateArtifact(artifact, { workspaceId, kind } = {}) {
  requirePlainObject(artifact, "artifact");
  if (Object.hasOwn(artifact, "sha256")) validateSha256(artifact.sha256, "artifact.sha256");
  const schemaVersion = artifact.schemaVersion;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 100) throw invalid("artifact.schemaVersion is out of bounds");
  const actualWorkspaceId = validateWorkspaceId(artifact.workspaceId);
  if (workspaceId !== undefined && actualWorkspaceId !== validateWorkspaceId(workspaceId)) throw invalid("artifact workspaceId does not match the requested workspace");
  const actualKind = artifact.kind;
  if (actualKind !== undefined) {
    boundedString(actualKind, "artifact.kind", 64);
    if (!ARTIFACT_KIND_SET.has(actualKind)) throw invalid(`Unknown artifact kind: ${actualKind}`);
  }
  if (kind !== undefined) {
    if (!ARTIFACT_KIND_SET.has(kind)) throw invalid(`Unknown artifact kind: ${kind}`);
    if (actualKind !== undefined && actualKind !== kind) throw invalid("artifact kind does not match the requested kind");
  }
  requirePlainObject(artifact.sourceSet, "artifact.sourceSet");
  validateBoundedJson(artifact.sourceSet, "artifact.sourceSet");
  const lens = boundedString(artifact.lens, "artifact.lens", 16);
  if (!["structural", "semantic", "mixed"].includes(lens)) throw invalid(`Invalid artifact lens: ${lens}`);
  const granularity = boundedString(artifact.granularity, "artifact.granularity", 32);
  if (!["operation", "entry", "span", "file", "cluster"].includes(granularity)) throw invalid(`Invalid artifact granularity: ${granularity}`);
  const nodes = validateArtifactArray(artifact.nodes, "artifact.nodes", validateNode);
  const edges = validateArtifactArray(artifact.edges, "artifact.edges", validateEdge);
  const parents = validateArtifactArray(artifact.parents, "artifact.parents", (parent, label) => validateSha256(parent, label));
  if (parents.length > MAX_ARTIFACT_PARENTS) throw invalid("artifact.parents contains too many entries");
  const evidence = validateEvidenceArray(artifact.evidence, "artifact.evidence");
  if (actualKind === "graph_revision" || kind === "graph_revision") {
    if (artifact.nodes === undefined || artifact.edges === undefined) throw invalid("graph_revision requires nodes and edges");
  }
  if (actualKind === "context_set" || kind === "context_set") {
    const selection = artifact.selection ?? artifact.addresses;
    if (selection !== undefined) validateEvidenceArray(selection, "artifact.selection", { allowRevisionIdOnly: false });
  }
  const normalized = { ...artifact, workspaceId: actualWorkspaceId, nodes, edges, parents, evidence };
  delete normalized.sha256;
  return normalized;
}

function validateEvidenceArray(items, label, { allowRevisionIdOnly = true } = {}) {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > MAX_EVIDENCE_ITEMS) throw invalid(`${label} must be a bounded array`);
  return items.map((item, index) => validateEvidence(item, `${label}[${index}]`, { allowRevisionIdOnly }));
}

/** Validate one M:N evidence link and, when present, its full FactAddress. */
export function validateEvidence(evidence, label = "evidence", { allowRevisionIdOnly = true } = {}) {
  requirePlainObject(evidence, label);
  const revisionId = validateHashOrId(evidence.revisionId, `${label}.revisionId`);
  const role = boundedString(evidence.role, `${label}.role`, 32);
  if (!EVIDENCE_ROLE_SET.has(role)) throw invalid(`Invalid evidence role: ${role}`);
  const address = evidence.address ?? evidence.factAddress;
  const addressId = evidence.addressId;
  if (address !== undefined) {
    const validatedAddress = validateFactAddress(address);
    const computedAddressId = factAddressId(validatedAddress);
    if (addressId !== undefined && validateSha256(addressId, `${label}.addressId`) !== computedAddressId) throw integrity(`${label}.addressId does not match FactAddress`);
    return { ...evidence, revisionId, role, address: validatedAddress, addressId: computedAddressId };
  }
  if (!allowRevisionIdOnly || addressId === undefined) throw invalid(`${label} requires a FactAddress or addressId`);
  validateSha256(addressId, `${label}.addressId`);
  return { ...evidence, revisionId, role, addressId };
}

export function artifactHashOf(artifact, options) {
  const validated = validateArtifact(artifact, options);
  const bytes = Buffer.from(canonicalJson(validated), "utf8");
  if (bytes.length > MAX_ARTIFACT_BYTES) throw invalid(`artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  return sha256Hex(bytes);
}

export const hashArtifact = artifactHashOf;

function artifactPath(artifactsDir, sha256) {
  validateSha256(sha256);
  const root = resolve(boundedString(artifactsDir, "artifactsDir", MAX_FACT_ID_LENGTH));
  const target = resolve(root, `${sha256}.json`);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel.includes("\\") || rel.includes("/")) throw invalid("artifact path escapes artifacts directory");
  return { root, target };
}

function parseWriteArguments(first, second, third) {
  if (typeof first === "string") return { artifactsDir: first, artifact: second, options: third ?? {} };
  requirePlainObject(first, "writeArtifact options");
  return { artifactsDir: first.artifactsDir ?? first.directory, artifact: first.artifact, options: { ...first, ...(second ?? {}) } };
}

/** Write an immutable artifact using a flushed temp file followed by rename. */
export async function writeArtifact(first, second, third) {
  const { artifactsDir, artifact, options } = parseWriteArguments(first, second, third);
  const validated = validateArtifact(artifact, options);
  const bytes = Buffer.from(canonicalJson(validated), "utf8");
  if (bytes.length > MAX_ARTIFACT_BYTES) throw invalid(`artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  const sha256 = sha256Hex(bytes);
  if (artifact.sha256 !== undefined && validateSha256(artifact.sha256, "artifact.sha256") !== sha256) {
    throw integrity("artifact.sha256 does not match canonical content");
  }
  const { root, target } = artifactPath(artifactsDir, sha256);
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw integrity("artifact target is not a regular file");
    const existing = await readFile(target);
    if (!existing.equals(bytes)) throw integrity("artifact hash collision or modified immutable artifact");
    return sha256;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = resolve(root, `.${sha256}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await rename(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw integrity("artifact hash collision or modified immutable artifact");
    }
    return sha256;
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export const writeArtifactAtomic = writeArtifact;

function parseReadArguments(first, second, third) {
  if (typeof first === "string") return { artifactsDir: first, sha256: second, options: third ?? {} };
  requirePlainObject(first, "readArtifact options");
  return { artifactsDir: first.artifactsDir ?? first.directory, sha256: first.sha256 ?? first.hash, options: { ...first, ...(second ?? {}) } };
}

/** Read, validate, and re-hash an artifact. Missing and tampered files fail closed. */
export async function readArtifact(first, second, third) {
  const { artifactsDir, sha256, options } = parseReadArguments(first, second, third);
  validateSha256(sha256);
  const { target } = artifactPath(artifactsDir, sha256);
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") throw notFound("Artifact not found");
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw integrity("artifact target is not a regular file");
  if (stat.size > MAX_ARTIFACT_BYTES) throw integrity("artifact exceeds the maximum size");
  let bytes;
  try {
    bytes = await readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") throw notFound("Artifact not found");
    throw error;
  }
  if (bytes.length > MAX_ARTIFACT_BYTES || sha256Hex(bytes) !== sha256) throw integrity("artifact content hash does not match its filename");
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw integrity("artifact is not valid JSON");
  }
  return validateArtifact(artifact, options);
}

export const readArtifactAtomic = readArtifact;

const NODE_KINDS = new Set(["entry", "span", "file", "skill", "operation", "tool", "approval", "cluster"]);
const EDGE_KINDS = new Set(["references", "contains", "produced", "approved", "derived_from", "session_ref", "context"]);

function isDatabase(value) {
  return value !== null && typeof value === "object" && typeof value.exec === "function" && typeof value.prepare === "function";
}

function databaseAndValue(first, second, label) {
  if (isDatabase(first)) return { database: first, value: second };
  if (first !== null && typeof first === "object" && isDatabase(first.database)) {
    const { database, ...value } = first;
    return { database, value: second === undefined ? value : second };
  }
  throw invalid(`${label} requires a DatabaseSync database`);
}

function validateCreatedAt(value, label = "createdAt") {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${label} must be a non-negative safe integer`);
  return value;
}

function selectorJson(address) {
  return address.selector === undefined ? null : canonicalJson(address.selector);
}

function insertAddressRow(database, address) {
  const normalized = validateFactAddress(address);
  const addressId = factAddressId(normalized);
  const existing = database.prepare("SELECT source_type, object_id, revision_id, selector_json FROM addresses WHERE address_id = ?").get(addressId);
  const row = [normalized.sourceType, normalized.objectId, normalized.revisionId, selectorJson(normalized)];
  if (existing && [existing.source_type, existing.object_id, existing.revision_id, existing.selector_json].some((value, index) => value !== row[index])) {
    throw integrity("address_id is already bound to different FactAddress data");
  }
  database.prepare("INSERT OR IGNORE INTO addresses (address_id, source_type, object_id, revision_id, selector_json) VALUES (?, ?, ?, ?, ?)").run(addressId, ...row);
  return addressId;
}

/** Insert one immutable FactAddress row and return its stable address_id. */
export function insertAddress(first, second) {
  const { database, value } = databaseAndValue(first, second, "insertAddress");
  return insertAddressRow(database, value?.address ?? value?.factAddress ?? value);
}

function immutableRow(database, table, keyColumn, keyValue, columns, values) {
  const existing = database.prepare(`SELECT ${columns.join(", ")} FROM ${table} WHERE ${keyColumn} = ?`).get(keyValue);
  if (existing && columns.some((column, index) => existing[column] !== values[index])) {
    throw integrity(`${table} revision is immutable and does not match the existing row`);
  }
}

function revisionValue(value, label) {
  return validateHashOrId(value, label);
}

function revisionTimestamp(value, fallback) {
  return value === undefined ? fallback : validateCreatedAt(value);
}

function nodeRow(node, options = {}) {
  requirePlainObject(node, "node revision");
  const nodeRevisionId = revisionValue(node.nodeRevisionId ?? node.revisionId, "nodeRevisionId");
  const nodeId = revisionValue(node.nodeId, "nodeId");
  const kind = boundedString(node.kind, "node.kind", 64);
  if (!NODE_KINDS.has(kind)) throw invalid(`Unknown node kind: ${kind}`);
  const title = node.title === undefined ? null : boundedString(node.title, "node.title", MAX_TITLE_LENGTH, { allowEmpty: true });
  const createdAt = revisionTimestamp(node.createdAt, options.createdAt ?? Date.now());
  const artifactSha = node.artifactSha ?? node.artifact_sha ?? options.artifactSha ?? null;
  if (artifactSha !== null) validateSha256(artifactSha, "node.artifactSha");
  return { nodeRevisionId, values: [nodeId, kind, title, createdAt, artifactSha] };
}

/** Insert one immutable node revision without updating an existing revision. */
export function insertNodeRevision(first, second, third) {
  const { database, value } = databaseAndValue(first, second, "insertNodeRevision");
  const row = nodeRow(value, third ?? {});
  const columns = ["node_id", "kind", "title", "created_at", "artifact_sha"];
  immutableRow(database, "node_revisions", "node_revision_id", row.nodeRevisionId, columns, row.values);
  database.prepare("INSERT OR IGNORE INTO node_revisions (node_revision_id, node_id, kind, title, created_at, artifact_sha) VALUES (?, ?, ?, ?, ?, ?)").run(row.nodeRevisionId, ...row.values);
  return row.nodeRevisionId;
}

function edgeRow(edge, options = {}) {
  requirePlainObject(edge, "edge revision");
  const edgeRevisionId = revisionValue(edge.edgeRevisionId ?? edge.revisionId, "edgeRevisionId");
  const edgeId = revisionValue(edge.edgeId, "edgeId");
  const srcNodeId = revisionValue(edge.srcNodeId, "srcNodeId");
  const dstNodeId = revisionValue(edge.dstNodeId, "dstNodeId");
  const kind = boundedString(edge.kind, "edge.kind", 64);
  if (!EDGE_KINDS.has(kind)) throw invalid(`Unknown edge kind: ${kind}`);
  const createdAt = revisionTimestamp(edge.createdAt, options.createdAt ?? Date.now());
  const artifactSha = edge.artifactSha ?? edge.artifact_sha ?? options.artifactSha ?? null;
  if (artifactSha !== null) validateSha256(artifactSha, "edge.artifactSha");
  return { edgeRevisionId, values: [edgeId, srcNodeId, dstNodeId, kind, createdAt, artifactSha] };
}

/** Insert one immutable edge revision without updating an existing revision. */
export function insertEdgeRevision(first, second, third) {
  const { database, value } = databaseAndValue(first, second, "insertEdgeRevision");
  const row = edgeRow(value, third ?? {});
  const columns = ["edge_id", "src_node_id", "dst_node_id", "kind", "created_at", "artifact_sha"];
  immutableRow(database, "edge_revisions", "edge_revision_id", row.edgeRevisionId, columns, row.values);
  database.prepare("INSERT OR IGNORE INTO edge_revisions (edge_revision_id, edge_id, src_node_id, dst_node_id, kind, created_at, artifact_sha) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.edgeRevisionId, ...row.values);
  return row.edgeRevisionId;
}

function parentValues(value, parentsArgument) {
  let childId;
  let parents;
  if (typeof value === "string") {
    childId = value;
    parents = parentsArgument;
  } else {
    requirePlainObject(value, "revision parents");
    childId = value.childId ?? value.child_id;
    parents = value.parentIds ?? value.parent_ids ?? value.parents ?? value.parentId ?? value.parent_id;
  }
  const normalizedChildId = revisionValue(childId, "childId");
  const list = Array.isArray(parents) ? parents : [parents];
  if (list.length === 0 || (list.length === 1 && list[0] === undefined)) return { childId: normalizedChildId, parentIds: [] };
  return { childId: normalizedChildId, parentIds: list.map((parentId) => revisionValue(parentId, "parentId")) };
}

function parentPathExists(database, startId, targetId) {
  const row = database.prepare(`
    WITH RECURSIVE ancestors(id) AS (
      SELECT ?
      UNION
      SELECT revision_parents.parent_id
      FROM revision_parents JOIN ancestors ON revision_parents.child_id = ancestors.id
    )
    SELECT 1 AS present FROM ancestors WHERE id = ? LIMIT 1
  `).get(startId, targetId);
  return row !== undefined;
}

/** Insert parent links, rejecting self-links and cycles in the revision DAG. */
export function insertRevisionParents(first, second, third) {
  const { database } = databaseAndValue(first, second, "insertRevisionParents");
  const { childId, parentIds } = parentValues(second, third);
  let inserted = 0;
  for (const parentId of parentIds) {
    if (childId === parentId) throw invalid("revision parent cannot be a self-link");
    if (parentPathExists(database, parentId, childId)) throw invalid("revision parent would create a cycle");
    const result = database.prepare("INSERT OR IGNORE INTO revision_parents (child_id, parent_id) VALUES (?, ?)").run(childId, parentId);
    inserted += Number(result.changes ?? 0);
  }
  return inserted;
}

function evidenceValues(value, evidenceArgument) {
  if (typeof value === "string") {
    if (Array.isArray(evidenceArgument)) return evidenceArgument.map((item) => ({ ...item, revisionId: item.revisionId ?? value }));
    const evidence = requirePlainObject(evidenceArgument, "evidence");
    return [{ ...evidence, revisionId: evidence.revisionId ?? value }];
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.evidence)) return value.evidence;
    return [value];
  }
  throw invalid("insertEvidence requires evidence");
}

/** Insert M:N evidence links, inserting full FactAddresses before their links. */
export function insertEvidence(first, second, third) {
  const { database } = databaseAndValue(first, second, "insertEvidence");
  const items = evidenceValues(second, third);
  let inserted = 0;
  for (const item of items) {
    const evidence = validateEvidence(item);
    if (evidence.address) insertAddressRow(database, evidence.address);
    else if (!database.prepare("SELECT 1 AS present FROM addresses WHERE address_id = ?").get(evidence.addressId)) {
      throw notFound("FactAddress for evidence addressId is not indexed");
    }
    const result = database.prepare("INSERT OR IGNORE INTO evidence (revision_id, address_id, role) VALUES (?, ?, ?)").run(evidence.revisionId, evidence.addressId, evidence.role);
    inserted += Number(result.changes ?? 0);
  }
  return inserted;
}

function artifactIndexValue(value, options = {}) {
  requirePlainObject(value, "artifact");
  const validated = validateArtifact(value, options);
  const sha256 = artifactHashOf(validated, options);
  const suppliedSha = value.sha256;
  if (suppliedSha !== undefined && validateSha256(suppliedSha, "artifact.sha256") !== sha256) throw integrity("artifact.sha256 does not match canonical content");
  const kind = options.kind ?? validated.kind;
  if (typeof kind !== "string" || !ARTIFACT_KIND_SET.has(kind)) throw invalid("artifact kind is required for indexing");
  const createdAt = revisionTimestamp(value.createdAt, options.createdAt ?? Date.now());
  return { validated, sha256, values: [kind, createdAt, canonicalJson(validated.sourceSet), validated.lens, validated.granularity] };
}

/** Insert the immutable artifact lookup row and return its content hash. */
export function insertArtifactIndex(first, second, third) {
  const { database, value } = databaseAndValue(first, second, "insertArtifactIndex");
  const options = third ?? {};
  const indexed = artifactIndexValue(value?.artifact ?? value, options);
  const columns = ["kind", "created_at", "source_set_json", "lens", "granularity"];
  immutableRow(database, "artifacts", "sha256", indexed.sha256, columns, indexed.values);
  database.prepare("INSERT OR IGNORE INTO artifacts (sha256, kind, created_at, source_set_json, lens, granularity) VALUES (?, ?, ?, ?, ?, ?)").run(indexed.sha256, ...indexed.values);
  return indexed.sha256;
}

function hydrateArguments(first, second, third, fourth) {
  if (isDatabase(first)) {
    if (typeof second === "string") return { database: first, artifactsDir: second, sha256: third, options: fourth ?? {} };
    const value = second ?? {};
    requirePlainObject(value, "hydrateArtifact options");
    return { database: first, artifactsDir: value.artifactsDir ?? value.directory, sha256: value.sha256 ?? value.hash, options: { ...value, ...(third ?? {}) } };
  }
  if (isDatabase(second)) return { database: second, artifactsDir: first, sha256: third, options: fourth ?? {} };
  if (first && typeof first === "object" && isDatabase(first.database)) {
    return { database: first.database, artifactsDir: first.artifactsDir ?? first.directory, sha256: first.sha256 ?? first.hash, options: { ...first, ...(second ?? {}) } };
  }
  throw invalid("hydrateArtifact requires a DatabaseSync database");
}

/** Read and verify an artifact, then project its durable revisions into SQLite. */
export async function hydrateArtifact(first, second, third, fourth) {
  const { database, artifactsDir, sha256, options } = hydrateArguments(first, second, third, fourth);
  const artifact = await readArtifact(artifactsDir, sha256, options);
  const artifactHash = artifactHashOf(artifact, options);
  const existingArtifact = database.prepare("SELECT created_at FROM artifacts WHERE sha256 = ?").get(artifactHash);
  const indexOptions = existingArtifact === undefined ? options : { ...options, createdAt: Number(existingArtifact.created_at) };
  database.exec("SAVEPOINT histos_hydrate_artifact");
  try {
    insertArtifactIndex(database, { ...artifact, sha256: artifactHash }, indexOptions);
    insertRevisionParents(database, artifactHash, artifact.parents);
    const evidenceRevisionIds = new Set(artifact.evidence.map((item) => item.revisionId));
    const revisionIds = new Set();
    for (const node of artifact.nodes) {
      const nodeRevisionId = node.nodeRevisionId;
      if (artifact.lens === "semantic" && !evidenceRevisionIds.has(nodeRevisionId)) continue;
      insertNodeRevision(database, node, { artifactSha: artifactHash, createdAt: artifact.createdAt });
      revisionIds.add(nodeRevisionId);
    }
    for (const edge of artifact.edges) {
      const edgeRevisionId = edge.edgeRevisionId;
      if (artifact.lens === "semantic" && !evidenceRevisionIds.has(edgeRevisionId)) continue;
      insertEdgeRevision(database, edge, { artifactSha: artifactHash, createdAt: artifact.createdAt });
      revisionIds.add(edgeRevisionId);
    }
    for (const evidence of artifact.evidence) {
      if (artifact.lens === "semantic" && !revisionIds.has(evidence.revisionId)) continue;
      insertEvidence(database, evidence);
    }
    database.exec("RELEASE SAVEPOINT histos_hydrate_artifact");
  } catch (error) {
    try { database.exec("ROLLBACK TO SAVEPOINT histos_hydrate_artifact"); } finally { database.exec("RELEASE SAVEPOINT histos_hydrate_artifact"); }
    throw error;
  }
  return { ...artifact, sha256: artifactHash };
}
