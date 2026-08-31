import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as schema from "./histos-schema.js";
import * as addressModule from "./histos-address.js";
import * as adapters from "./histos-adapters.js";
import * as webSource from "./histos-web-source.js";
import * as repoSource from "./histos-repo-source.js";
import * as selection from "./histos-selection.js";
import { parseCapabilityFlow } from "./histos-capability-flow.js";
import { agentSpecGraph, agentRunGraph, agentSpecRevisionId, normalizeAgentSpec, seedSpecs } from "./histos-agent-spec.js";
import { normalizeInvocationRequest, planInvocationFromRequest } from "./histos-capability.js";
import * as provenance from "./histos-provenance.js";
import { chunkFactAddress } from "./histos-chunker.js";
import { convertGraphToFlowDraft, executionPlanOf, validateFlowSpec } from "./flow-validation.js";
import { evalResultGraph, normalizeEvalResult } from "./histos-eval.js";
import { createSqliteFactGraph } from "./histos-sqlite-fact-graph.js";
import { createOffFactGraph } from "./histos-fact-graph.js";
import { projectFactBatchToTriples } from "./histos-fact-derivation.js";
import * as strategy from "./histos-strategy.js";
import { boundEventPayload } from "./histos-event-bus.js";

const LENSES = new Set(["structural", "semantic", "mixed"]);
const GRANULARITIES = new Set(["operation", "entry", "span", "file", "cluster"]);
const MAX_JSONL_FILES = 4096;
const MAX_ID = 1024;
const MAX_CONDENSE_NODES = 128;
const MAX_CONDENSE_BUDGET = 32_000;
const MAX_DISTILL_CONTENT_BYTES = 262_144;
const MAX_DISTILL_CONTEXT_BUDGET = 64_000;

// Tombstone (P0 traceability) constants. `target_kind` is the closed set from
// the schema definition; approval accounting is protected fail-closed — those
// facts can never be archived or purged while their session exists.
const TOMBSTONE_TARGET_KINDS = new Set(["triple", "node", "edge", "artifact", "session_index"]);
const MAX_TOMBSTONE_IDS = 512;
const MAX_TOMBSTONE_REASON = 512;
const APPROVAL_TRIPLE_PREDICATES = new Set(["approves", "denies"]);
const APPROVAL_TRIPLE_TAGS = new Set(["approved", "denied"]);

const initializeSchema = schema.initializeHistosSchema ?? schema.createHistosSchema;
const validateSchema = schema.validateHistosSchema ?? schema.validateSchema;
const validateAddress = addressModule.validateFactAddress ?? addressModule.normalizeFactAddress;
const addressId = addressModule.factAddressId ?? addressModule.addressIdForFactAddress ?? addressModule.addressIdOf;
const canonicalJson = addressModule.canonicalJson;

const validateArtifact = provenance.validateArtifact;
const writeArtifact = provenance.writeArtifact;
const readArtifact = provenance.readArtifact;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: "invalid_args" });
}

function notReady() {
  return Object.assign(new Error("Histos Engine is closed or has no usable index"), { code: "not_ready" });
}

function cancelled() {
  return Object.assign(new Error("Histos rebuild cancelled"), { code: "cancelled" });
}

function isObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function string(value, label, max = MAX_ID) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function jsonValue(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, label));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [string(key, `${label} key`, 4096), jsonValue(item, `${label}.${key}`)]));
  throw invalid(`${label} must contain JSON values`);
}

function queryOf(input, label = "query") {
  if (!isObject(input)) throw invalid(`${label} must be an object`);
  if (!Object.hasOwn(input, "sourceSet") || !Object.hasOwn(input, "lens") || !Object.hasOwn(input, "granularity")) {
    throw invalid(`${label} requires sourceSet, lens, and granularity`);
  }
  const sourceSet = jsonValue(input.sourceSet, `${label}.sourceSet`);
  if (!isObject(sourceSet)) throw invalid(`${label}.sourceSet must be an object`);
  const lens = string(input.lens, `${label}.lens`, 16);
  if (!LENSES.has(lens)) throw invalid(`Invalid ${label}.lens: ${lens}`);
  const granularity = string(input.granularity, `${label}.granularity`, 32);
  if (!GRANULARITIES.has(granularity)) throw invalid(`Invalid ${label}.granularity: ${granularity}`);
  if (input.asOf !== undefined && input.asOf !== null) {
    if (typeof input.asOf !== "number" || !Number.isFinite(input.asOf)) throw invalid(`${label}.asOf must be a finite timestamp in milliseconds`);
  }
  return { sourceSet, lens, granularity, ...(Number.isFinite(input.asOf) ? { asOf: input.asOf } : {}) };
}

function checkAbort(signal, isCancelled) {
  if (signal?.aborted || isCancelled?.()) throw cancelled();
}

function hashId(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function now() {
  return Date.now();
}

function sessionObjectId(sessionId, id) {
  return `${sessionId}/${id}`;
}

function sessionAddress(sessionId, entryId) {
  return {
    sourceType: "session_entry",
    objectId: sessionObjectId(sessionId, entryId),
    revisionId: entryId,
  };
}

function normalizedAddress(address, workspaceId) {
  try {
    return validateAddress(address, { workspaceId });
  } catch {
    return validateAddress(address);
  }
}

function addAddress(result, address) {
  const normalized = normalizedAddress(address, result.workspaceId);
  const id = addressId(normalized, { workspaceId: result.workspaceId });
  result.addresses.set(id, normalized);
  return id;
}

function addEvidence(result, revisionId, address, role = "supports") {
  const addressIdValue = typeof address === "string" ? address : addAddress(result, address);
  const key = `${revisionId}\u0000${addressIdValue}\u0000${role}`;
  if (!result.evidence.has(key)) result.evidence.set(key, { revisionId, addressId: addressIdValue, role });
}

function traceAnchor(data) {
  if (!isObject(data) || typeof data.sessionId !== "string" || data.sessionId.length === 0) return undefined;
  const anchor = { sessionId: data.sessionId };
  for (const field of ["entryId", "toolCallId", "assistantEntryId", "resultEntryId"]) {
    if (typeof data[field] === "string" && data[field].length > 0 && data[field].length <= MAX_ID && !/[\u0000-\u001f\u007f]/.test(data[field])) anchor[field] = data[field];
  }
  return Object.keys(anchor).length > 1 ? anchor : undefined;
}

function addNode(result, node, evidence = []) {
  if (!isObject(node)) return;
  const nodeRevisionId = string(node.nodeRevisionId ?? node.revisionId, "nodeRevisionId");
  const nodeId = string(node.nodeId, "nodeId");
  const parentId = node.parentId === undefined || node.parentId === null ? node.parentId : string(node.parentId, "node.parentId", 512);
  const item = {
    nodeRevisionId,
    nodeId,
    kind: string(node.kind ?? "entry", "node.kind", 64),
    title: node.title === undefined ? null : String(node.title).slice(0, 4096),
    createdAt: Number.isSafeInteger(node.createdAt) ? node.createdAt : now(),
    artifactSha: node.artifactSha ?? null,
    anchor: traceAnchor(node.anchor ?? node.data),
    ...(isObject(node.metadata) ? { metadata: jsonValue(node.metadata, "node.metadata") } : {}),
    ...(isObject(node.spec) ? { spec: normalizeAgentSpec(node.spec) } : {}),
    ...(parentId === undefined ? {} : { parentId }),
  };
  result.nodes.set(nodeRevisionId, item);
  for (const itemEvidence of evidence) addEvidence(result, nodeRevisionId, itemEvidence.address ?? itemEvidence.factAddress ?? itemEvidence, itemEvidence.role ?? "supports");
}

function nodeAnchorPayload(item) {
  if (!item.anchor && item.parentId === undefined && !item.spec && !item.metadata) return null;
  return {
    ...(item.anchor ?? {}),
    ...(item.parentId === undefined ? {} : { __histosParentId: item.parentId }),
    ...(item.spec ? { __histosSpec: item.spec } : {}),
    ...(item.metadata ? { __histosMetadata: item.metadata } : {}),
  };
}

function readNodeRow(row) {
  const payload = row.anchorJson ? JSON.parse(row.anchorJson) : null;
  const parentId = payload?.__histosParentId;
  const spec = payload?.__histosSpec;
  const metadata = payload?.__histosMetadata;
  if (payload) {
    delete payload.__histosParentId;
    delete payload.__histosSpec;
    delete payload.__histosMetadata;
  }
  const hasAnchor = payload && Object.keys(payload).length > 0;
  const node = { ...row };
  delete node.anchorJson;
  return {
    ...node,
    ...(hasAnchor ? { anchor: payload } : {}),
    ...(typeof parentId === "string" ? { parentId } : {}),
    ...(isObject(spec) ? { spec: normalizeAgentSpec(spec) } : {}),
    ...(isObject(metadata) ? { metadata: jsonValue(metadata, "node.metadata") } : {}),
  };
}

function addEdge(result, edge, evidence = []) {
  if (!isObject(edge)) return;
  const edgeRevisionId = string(edge.edgeRevisionId ?? edge.revisionId, "edgeRevisionId");
  const item = {
    edgeRevisionId,
    edgeId: string(edge.edgeId ?? edgeRevisionId, "edgeId"),
    srcNodeId: string(edge.srcNodeId, "edge.srcNodeId"),
    dstNodeId: string(edge.dstNodeId, "edge.dstNodeId"),
    kind: string(edge.kind ?? "references", "edge.kind", 64),
    createdAt: Number.isSafeInteger(edge.createdAt) ? edge.createdAt : now(),
    artifactSha: edge.artifactSha ?? null,
    anchor: traceAnchor(edge.anchor ?? edge.data),
  };
  result.edges.set(edgeRevisionId, item);
  for (const itemEvidence of evidence) addEvidence(result, edgeRevisionId, itemEvidence.address ?? itemEvidence.factAddress ?? itemEvidence, itemEvidence.role ?? "supports");
}

function addParent(result, childId, parentId) {
  result.parents.add(`${childId}\u0000${parentId}`);
}

function indexFact(result, sessionId, fact, entryId) {
  if (!isObject(fact) || typeof fact.type !== "string") return;
  const outerEntryId = string(entryId, "entryId", 512);
  const sourceAddress = sessionAddress(sessionId, outerEntryId);
  const sourceAddressId = addAddress(result, sourceAddress);
  const kind = fact.type === "operation_started" || fact.type === "operation_finished" ? "operation" : fact.type === "approval_asked" || fact.type === "approval_decided" ? "approval" : fact.type === "context_attached" ? "cluster" : "entry";
  const factId = typeof fact.id === "string" && fact.id.length > 0 ? fact.id : outerEntryId;
  const nodeId = `${kind}:${sessionObjectId(sessionId, factId)}`;
  const nodeRevisionId = hashId(`fact-node:${nodeId}:${outerEntryId}`);
  addNode(result, { nodeRevisionId, nodeId, kind, title: fact.type, createdAt: 0 }, [{ address: sourceAddress, addressId: sourceAddressId, role: "produces" }]);
  const entryNodeId = `entry:${sessionObjectId(sessionId, outerEntryId)}`;
  addEdge(result, { edgeRevisionId: hashId(`fact-edge:${entryNodeId}:${nodeId}`), edgeId: `fact:${outerEntryId}:${factId}`, srcNodeId: entryNodeId, dstNodeId: nodeId, kind: "produced", createdAt: 0 }, [{ address: sourceAddress, addressId: sourceAddressId, role: "produces" }]);
}

function graphAnchor(item) {
  const data = isObject(item?.data) ? item.data : {};
  const kindSeparator = typeof item?.id === "string" ? item.id.indexOf(":") : -1;
  const objectSeparator = kindSeparator >= 0 ? item.id.indexOf("/", kindSeparator + 1) : -1;
  const sessionId = typeof data.sessionId === "string" && data.sessionId.length > 0
    ? data.sessionId
    : objectSeparator > kindSeparator ? item.id.slice(kindSeparator + 1, objectSeparator) : undefined;
  if (!sessionId) return undefined;
  return traceAnchor({ sessionId, ...data });
}

function resultFromStructuralGraph(graph, result) {
  const revisionByNodeId = new Map((graph.nodes ?? []).map((node) => [node.id, hashId(`adapter-node:${node.id}`)]));
  for (const node of graph.nodes ?? []) {
    const nodeRevisionId = revisionByNodeId.get(node.id);
    const evidence = (node.evidence ?? []).map((item) => ({ ...item, revisionId: nodeRevisionId }));
    addNode(result, { nodeRevisionId, nodeId: node.id, kind: node.kind, title: node.title, createdAt: 0, anchor: graphAnchor(node), parentId: node.parentId ? revisionByNodeId.get(node.parentId) : undefined }, evidence);
  }
  for (const edge of graph.edges ?? []) {
    const edgeRevisionId = hashId(`adapter-edge:${edge.id}`);
    const evidence = (edge.evidence ?? []).map((item) => ({ ...item, revisionId: edgeRevisionId }));
    addEdge(result, { edgeRevisionId, edgeId: edge.id, srcNodeId: edge.srcNodeId, dstNodeId: edge.dstNodeId, kind: edge.kind, createdAt: 0, anchor: graphAnchor(edge) }, evidence);
  }
}

/**
 * Project a web graph into the index.
 *
 * Unlike session graphs the revision id is not derived from the node id alone:
 * a web adapter supplies both a stable `nodeId` (the URL) and a content
 * addressed `nodeRevisionId`, so re-fetching a changed page appends a revision
 * instead of overwriting the previous reading.
 */
function resultFromWebGraph(graph, result) {
  for (const node of graph.nodes ?? []) {
    if (!isObject(node) || typeof node.nodeRevisionId !== "string") continue;
    const evidence = (node.evidence ?? []).map((item) => ({ ...item, revisionId: node.nodeRevisionId }));
    addNode(result, {
      nodeRevisionId: node.nodeRevisionId,
      nodeId: node.nodeId ?? node.id,
      kind: node.kind ?? "web_resource",
      title: node.title,
      createdAt: node.createdAt,
      parentId: node.parentId,
      spec: node.spec,
      metadata: node.metadata,
    }, evidence);
  }
  for (const edge of graph.edges ?? []) {
    if (!isObject(edge)) continue;
    const edgeRevisionId = typeof edge.edgeRevisionId === "string" ? edge.edgeRevisionId : hashId(`web-edge:${edge.id}`);
    const evidence = (edge.evidence ?? []).map((item) => ({ ...item, revisionId: edgeRevisionId }));
    addEdge(result, {
      edgeRevisionId,
      edgeId: edge.edgeId ?? edge.id,
      srcNodeId: edge.srcNodeId,
      dstNodeId: edge.dstNodeId,
      kind: edge.kind,
      createdAt: edge.createdAt,
    }, evidence);
  }
}

/**
 * Chain each incoming node revision onto the newest revision of the same node
 * already in the index. This is what turns repeated fetches of one URL into a
 * temporal chain rather than a pile of unrelated rows.
 */
function linkNodeRevisionParents(database, result) {
  if (result.nodes.size === 0) return;
  const select = database.prepare(
    "SELECT node_revision_id AS nodeRevisionId FROM node_revisions WHERE node_id = ? ORDER BY created_at DESC, node_revision_id DESC LIMIT 1",
  );
  for (const item of result.nodes.values()) {
    if (typeof item.nodeId !== "string") continue;
    const previous = select.get(item.nodeId);
    if (previous && previous.nodeRevisionId !== item.nodeRevisionId) {
      result.parents.add(`${item.nodeRevisionId}\u0000${previous.nodeRevisionId}`);
    }
  }
}

async function scanSources(options, result, check) {
  const adapterOptions = { workspaceId: result.workspaceId, maxFiles: Math.min(options.maxFiles ?? MAX_JSONL_FILES, MAX_JSONL_FILES) };
  const scans = [];
  for (const file of options.sessionFiles ?? []) {
    check();
    try { scans.push(await adapters.scanSessionFile(file, adapterOptions)); } catch { /* unreadable source files are skipped */ }
  }
  for (const root of [options.sessionsRoot, options.sessionRoot, options.workspaceRoot]) {
    if (typeof root !== "string") continue;
    check();
    const rootScans = await adapters.scanWorkspaceSessions(root, adapterOptions);
    scans.push(...rootScans);
  }
  const unique = new Map(scans.filter((scan) => scan?.sessionId).map((scan) => [scan.sessionId, scan]));
  const uniqueScans = [...unique.values()];
  const graph = adapters.projectStructuralGraph(uniqueScans, { workspaceId: result.workspaceId, granularity: options.granularity ?? "entry" });
  resultFromStructuralGraph(graph, result);
  for (const scan of uniqueScans) {
    result.sessionIds.add(scan.sessionId);
    indexScanMessages(result, scan);
  }
  return [...unique.values()].map((scan) => scan.filePath).filter(Boolean);
}

function emptyResult(workspaceId) {
  return { workspaceId, addresses: new Map(), nodes: new Map(), edges: new Map(), evidence: new Map(), spans: new Map(), parents: new Set(), sessionIds: new Set(), lastEntryBySession: new Map() };
}

function indexMessageSpans(result, message) {
  if (!message?.entryAddress || typeof message.text !== "string" || message.text.length === 0) return;
  for (const chunk of chunkFactAddress(message.entryAddress, message.text)) {
    const spanAddressId = addAddress(result, chunk.address);
    result.spans.set(spanAddressId, {
      spanId: spanAddressId,
      addressId: spanAddressId,
      entryObjectId: chunk.address.objectId,
      start: chunk.start,
      length: chunk.length,
    });
  }
}

function indexScanMessages(result, scan) {
  for (const message of scan?.messages ?? []) indexMessageSpans(result, message);
}

function rowsFromResult(database, result) {
  const insertAddress = database.prepare("INSERT OR IGNORE INTO addresses (address_id, source_type, object_id, revision_id, selector_json) VALUES (?, ?, ?, ?, ?)");
  const insertNode = database.prepare("INSERT OR IGNORE INTO node_revisions (node_revision_id, node_id, kind, title, created_at, artifact_sha, anchor_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertEdge = database.prepare("INSERT OR IGNORE INTO edge_revisions (edge_revision_id, edge_id, src_node_id, dst_node_id, kind, created_at, artifact_sha, anchor_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertEvidence = database.prepare("INSERT OR IGNORE INTO evidence (revision_id, address_id, role) VALUES (?, ?, ?)");
  const insertParent = database.prepare("INSERT OR IGNORE INTO revision_parents (child_id, parent_id) VALUES (?, ?)");
  const insertSpan = database.prepare("INSERT OR IGNORE INTO spans (span_id, address_id, entry_object_id, start, length) VALUES (?, ?, ?, ?, ?)");
  for (const [id, item] of result.addresses) {
    insertAddress.run(id, item.sourceType, item.objectId, item.revisionId, item.selector ? JSON.stringify(item.selector) : null);
    if (item.sourceType === "session_span" && item.selector?.kind === "span") {
      insertSpan.run(id, id, item.objectId, item.selector.start, item.selector.length);
    }
  }
  for (const item of result.spans.values()) insertSpan.run(item.spanId, item.addressId, item.entryObjectId, item.start, item.length);
  for (const item of result.nodes.values()) insertNode.run(item.nodeRevisionId, item.nodeId, item.kind, item.title, item.createdAt, item.artifactSha, nodeAnchorPayload(item) ? JSON.stringify(nodeAnchorPayload(item)) : null);
  for (const item of result.edges.values()) insertEdge.run(item.edgeRevisionId, item.edgeId, item.srcNodeId, item.dstNodeId, item.kind, item.createdAt, item.artifactSha, item.anchor ? JSON.stringify(item.anchor) : null);
  for (const item of result.evidence.values()) insertEvidence.run(item.revisionId, item.addressId, item.role);
  for (const pair of result.parents) { const [childId, parentId] = pair.split("\u0000"); insertParent.run(childId, parentId); }
}

function artifactRecord(artifact, sha256) {
  return { sha256, kind: artifact.kind, createdAt: now(), sourceSetJson: canonicalJson(artifact.sourceSet), lens: artifact.lens, granularity: artifact.granularity };
}

function contextBudgetResult(budget, minimumBytes, details) {
  return {
    ok: false,
    code: "budget_exceeded",
    message: `ContextSet budget exceeded: ${minimumBytes} bytes are required for the selected context; remove selected items or increase the budget`,
    diagnostics: [
      { code: "budget_exceeded", message: `Selected context requires ${minimumBytes} bytes, but the budget is ${budget} bytes.` },
      { code: "selected_evidence_required", message: "Selected evidence is never discarded; reduce the selection or increase the budget before attaching this context." },
    ],
    result: {
      action: "reduce_selection_or_increase_budget",
      message: "Remove selected nodes or edges, or increase the ContextSet budget, then try again.",
      budget,
      minimumBudget: minimumBytes,
      ...details,
    },
  };
}

function contextNeighborSummary(node) {
  return {
    nodeRevisionId: node.nodeRevisionId,
    nodeId: node.nodeId,
    kind: node.kind,
    title: node.title,
    createdAt: node.createdAt,
    artifactSha: node.artifactSha,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
  };
}

function contextPayload(query, workspaceId, nodes, edges, evidence, neighborSummaries = []) {
  const selection = evidence.map((item) => ({ revisionId: item.revisionId, addressId: item.addressId, role: item.role, address: item.address }));
  return {
    schemaVersion: 1,
    workspaceId,
    kind: "context_set",
    sourceSet: query.sourceSet,
    lens: query.lens,
    granularity: query.granularity,
    selection,
    nodes,
    edges,
    evidence,
    ...(neighborSummaries.length > 0 ? { neighborSummaries } : {}),
    parents: [],
  };
}

function contextBytes(payload) {
  return Buffer.byteLength(canonicalJson(payload), "utf8");
}

function contextBudgetDiagnostics(budget, requiredBytes, selectedCount, neighborCount, breakdown) {
  return {
    budget,
    requiredBytes,
    selectedCount,
    neighborCount,
    omittedNeighborCount: 0,
    breakdown,
  };
}

function insertArtifact(database, artifact, sha256) {
  const row = artifactRecord(artifact, sha256);
  database.prepare("INSERT OR IGNORE INTO artifacts (sha256, kind, created_at, source_set_json, lens, granularity) VALUES (?, ?, ?, ?, ?, ?)").run(row.sha256, row.kind, row.createdAt, row.sourceSetJson, row.lens, row.granularity);
  const result = emptyResult(artifact.workspaceId);
  for (const item of artifact.nodes ?? []) addNode(result, { ...item, artifactSha: sha256 }, (artifact.evidence ?? []).filter((evidence) => evidence.revisionId === item.nodeRevisionId));
  for (const item of artifact.edges ?? []) addEdge(result, { ...item, artifactSha: sha256 }, (artifact.evidence ?? []).filter((evidence) => evidence.revisionId === item.edgeRevisionId));
  for (const parent of artifact.parents ?? []) {
    for (const item of artifact.nodes ?? []) addParent(result, item.nodeRevisionId, parent);
    for (const item of artifact.edges ?? []) addParent(result, item.edgeRevisionId, parent);
  }
  rowsFromResult(database, result);
}

function listArtifacts(directory, check) {
  const artifacts = [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return artifacts; }
  for (const entry of entries) {
    check();
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const sha256 = entry.name.slice(0, -5);
    if (/^[0-9a-f]{64}$/.test(sha256)) artifacts.push({ sha256 });
  }
  return artifacts.sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function sourceMatches(sourceSet, address) {
  const sessions = sourceSet.sessions ?? sourceSet.sessionIds;
  if (Array.isArray(sessions) && sessions.length > 0) {
    const session = address.objectId.split("/")[0];
    if (!sessions.includes(session) && !sessions.includes(address.objectId)) return false;
  }
  const types = sourceSet.sourceTypes;
  if (Array.isArray(types) && types.length > 0 && !types.includes(address.sourceType)) return false;
  return true;
}

/**
 * P0 time travel (T0.6): project the revision DAG as it stood at `asOf`.
 *
 * Two rules, both needed: a revision created after `asOf` cannot be part of
 * the past state, and a revision that already has a surviving child was
 * superseded before `asOf` (the revision_parents DAG carries the lineage,
 * not the timestamps alone). The result keeps every revision that was a tip
 * at that instant, so a branched DAG can legitimately return more than one
 * live revision per object.
 */
function filterRevisionsAsOf(database, rows, asOf, idField) {
  if (!Number.isFinite(asOf)) return rows;
  const visible = rows.filter((row) => Number.isFinite(row.createdAt) && row.createdAt <= asOf);
  if (visible.length === 0) return [];
  const childOf = database.prepare("SELECT child_id AS childId, parent_id AS parentId FROM revision_parents").all();
  const visibleIds = new Set(visible.map((row) => row[idField]));
  const superseded = new Set();
  for (const { childId, parentId } of childOf) {
    if (childId !== parentId && visibleIds.has(childId) && visibleIds.has(parentId)) superseded.add(parentId);
  }
  return visible.filter((row) => !superseded.has(row[idField]));
}

function revisionMatches(database, revisionId, query, artifactSha = null) {
  const rows = database.prepare("SELECT a.source_type AS sourceType, a.object_id AS objectId, a.revision_id AS revisionId FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id = ?").all(revisionId);
  // Zero-evidence revisions bypass the SourceSet filter, so they are only
  // trusted when they carry no artifact (structural facts). A semantic
  // artifact revision without evidence must never surface for any source set.
  if (rows.length === 0) return artifactSha === null;
  return rows.some((address) => sourceMatches(query.sourceSet, address));
}

function queryFromArgs(first, second, third) {
  if (isObject(first) && Object.hasOwn(first, "sourceSet")) return queryOf(first);
  if (isObject(second) && Object.hasOwn(second, "sourceSet")) return queryOf(second);
  if (isObject(third) && Object.hasOwn(third, "sourceSet")) return queryOf(third);
  throw invalid("query requires sourceSet, lens, and granularity");
}

function traceAnchorFor(revision, evidence) {
  const addresses = evidence.filter((item) => item.revisionId === revision).map((item) => item.address);
  const sessionEntry = addresses.find((address) => address.sourceType === "session_entry");
  const tool = addresses.find((address) => address.sourceType === "tool");
  const operation = addresses.find((address) => address.sourceType === "operation");
  const approval = addresses.find((address) => address.sourceType === "approval");
  const selected = sessionEntry ?? tool ?? operation ?? approval;
  if (!selected) return undefined;
  const separator = selected.objectId.indexOf("/");
  if (separator <= 0) return undefined;
  const sessionId = selected.objectId.slice(0, separator);
  const objectId = selected.objectId.slice(separator + 1);
  if (selected.sourceType === "session_entry") return { sessionId, entryId: objectId };
  if (selected.sourceType === "tool") return { sessionId, toolCallId: objectId, ...(selected.revisionId ? { assistantEntryId: selected.revisionId } : {}) };
  if (selected.sourceType === "operation") return { sessionId, entryId: selected.revisionId };
  if (selected.sourceType === "approval") return { sessionId, entryId: selected.revisionId };
  return undefined;
}

function revisionLensMatches(database, artifactSha, lens) {
  if (lens === "mixed") return true;
  if (!artifactSha) return lens === "structural";
  const row = database.prepare("SELECT lens FROM artifacts WHERE sha256 = ?").get(artifactSha);
  return row?.lens === lens;
}

/**
 * Ids currently hidden by an active (non-revoked) tombstone of `kind`.
 * One prepared query per read path call; the tombstones table is joined in
 * memory so every query path shares the same "invisible" definition.
 */
function activeTombstoneIds(database, kind) {
  const rows = database.prepare("SELECT target_id AS targetId FROM tombstones WHERE target_kind = ? AND revoked_at IS NULL").all(kind);
  return new Set(rows.map((row) => row.targetId));
}

function tombstoneId() {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

/**
 * Delete fact_triples rows and keep the FTS5 mirror consistent. The FTS
 * index is an external-content table: row deletion must be driven through
 * the special 'delete' command with the old cell values, otherwise the
 * index keeps the tokens and a later rowid reuse joins MATCH to the wrong
 * row (purged/archived text stays searchable). Callers run inside their own
 * transaction; this only queues the FTS delete + row delete.
 */
function deleteTriplesWithFts(database, ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const rows = database.prepare(`SELECT rowid, subject, predicate, object FROM fact_triples WHERE id IN (${placeholders})`).all(...ids);
  const ftsDelete = database.prepare("INSERT INTO fact_triples_fts(fact_triples_fts, rowid, subject, predicate, object) VALUES('delete', ?, ?, ?, ?)");
  for (const row of rows) {
    try { ftsDelete.run(row.rowid, row.subject, row.predicate, row.object); } catch { /* best effort */ }
  }
  database.prepare(`DELETE FROM fact_triples WHERE id IN (${placeholders})`).run(...ids);
}

/**
 * Fail-closed gate for archive/purge: approval accounting is never
 * archivable, and the target rows must actually exist (a tombstone over a
 * missing object would silently pretend a deletion happened).
 * `kind='session_index'` points at JSONL session identifiers that live
 * outside sqlite, so existence is not verified here.
 */
function assertEntriesArchivable(database, kind, ids) {
  if (kind === "session_index") return;
  const table = { node: "node_revisions", edge: "edge_revisions", triple: "fact_triples", artifact: "artifacts" }[kind];
  const column = { node: "node_revision_id", edge: "edge_revision_id", triple: "id", artifact: "sha256" }[kind];
  const found = new Set();
  const select = database.prepare(`SELECT ${column} AS id FROM ${table}`);
  for (const row of select.all()) found.add(row.id);
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw Object.assign(new Error(`cannot archive unknown ${kind} target(s): ${missing.slice(0, 8).join(", ")}`), { code: "target_not_found", missing });
  }
  if (kind === "node") {
    const approvalRows = database.prepare("SELECT node_revision_id AS id FROM node_revisions WHERE kind = 'approval'").all();
    const approvalIds = new Set(approvalRows.map((row) => row.id));
    const blocked = ids.filter((id) => approvalIds.has(id));
    if (blocked.length > 0) {
      throw Object.assign(new Error("approval accounting facts cannot be archived"), { code: "approval_protected", blocked });
    }
  }
  if (kind === "triple") {
    const rows = database.prepare("SELECT id, predicate, tag FROM fact_triples").all();
    const blocked = rows.filter((row) => ids.includes(row.id) && (APPROVAL_TRIPLE_PREDICATES.has(row.predicate) || APPROVAL_TRIPLE_TAGS.has(row.tag))).map((row) => row.id);
    if (blocked.length > 0) {
      throw Object.assign(new Error("approval accounting triples cannot be archived"), { code: "approval_protected", blocked });
    }
  }
}

function graphRows(database, query) {
  const archivedNodeIds = activeTombstoneIds(database, "node");
  const archivedEdgeIds = activeTombstoneIds(database, "edge");
  const nodeRows = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha, anchor_json AS anchorJson FROM node_revisions ORDER BY created_at, node_revision_id").all().map(readNodeRow).filter((row) => !archivedNodeIds.has(row.nodeRevisionId)).filter((row) => revisionLensMatches(database, row.artifactSha, query.lens) && revisionMatches(database, row.nodeRevisionId, query, row.artifactSha));
  const edgeRows = database.prepare("SELECT edge_revision_id AS edgeRevisionId, edge_id AS edgeId, src_node_id AS srcNodeId, dst_node_id AS dstNodeId, kind, created_at AS createdAt, artifact_sha AS artifactSha, anchor_json AS anchorJson FROM edge_revisions ORDER BY created_at, edge_revision_id").all().map((row) => ({ ...row, ...(row.anchorJson ? { anchor: JSON.parse(row.anchorJson) } : {}) })).map(({ anchorJson, ...row }) => row).filter((row) => !archivedEdgeIds.has(row.edgeRevisionId)).filter((row) => revisionLensMatches(database, row.artifactSha, query.lens) && revisionMatches(database, row.edgeRevisionId, query, row.artifactSha));
  const nodes = filterRevisionsAsOf(database, nodeRows, query.asOf, "nodeRevisionId");
  const edges = filterRevisionsAsOf(database, edgeRows, query.asOf, "edgeRevisionId");
  const revisions = [...nodes.map((item) => item.nodeRevisionId), ...edges.map((item) => item.edgeRevisionId)];
  const evidence = revisions.length === 0 ? [] : database.prepare(`SELECT e.revision_id AS revisionId, e.address_id AS addressId, e.role, a.source_type AS sourceType, a.object_id AS objectId, a.revision_id AS addressRevisionId, a.selector_json AS selectorJson FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id IN (${revisions.map(() => "?").join(",")})`).all(...revisions).map((row) => ({ revisionId: row.revisionId, addressId: row.addressId, role: row.role, address: { sourceType: row.sourceType, objectId: row.objectId, revisionId: row.addressRevisionId, ...(row.selectorJson ? { selector: JSON.parse(row.selectorJson) } : {}) } }));
  const withAnchors = (items, revisionKey) => items.map((item) => {
    const fallback = traceAnchorFor(item[revisionKey], evidence);
    return fallback && !item.anchor ? { ...item, anchor: fallback } : item;
  });
  const parents = database.prepare("SELECT child_id AS childId, parent_id AS parentId FROM revision_parents").all();
  return { nodes: withAnchors(nodes, "nodeRevisionId"), edges: withAnchors(edges, "edgeRevisionId"), evidence, parents, sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity, ...(Number.isFinite(query.asOf) ? { asOf: query.asOf } : {}) };
}

export class HistosEngine {
  constructor(options = {}) {
    if (!isObject(options)) throw invalid("options must be an object");
    this.workspaceId = string(options.workspaceId, "workspaceId", 128);
    this.databasePath = resolve(options.databasePath ?? options.dbPath ?? options.indexPath ?? join(resolve(options.userDataDir ?? process.cwd()), "index.sqlite"));
    this.artifactsDir = resolve(options.artifactsDir ?? join(dirname(this.databasePath), "artifacts"));
    this.scanOptions = { ...options };
    this.semanticProvider = typeof options.semanticProvider === "function" ? options.semanticProvider : null;
    // Histos event bus (BeforeX/AfterX pub/sub). The bus is created on
    // demand so test code that never calls emit() doesn't pay for it.
    this.eventBus = options.eventBus ?? null;
    // Fact graph backend (FactGraphBackend contract, see histos-fact-graph.js).
    // Defaults to the sqlite implementation backed by the same `index.sqlite`,
    // but callers can swap in `off` / `in-memory` (tests) or any future
    // remote backend. The backend is started lazily on first write so the
    // schema is guaranteed to exist.
    if (options.factGraph === null) {
      this.factGraph = createOffFactGraph();
    } else if (options.factGraph && typeof options.factGraph.writeTriples === "function") {
      this.factGraph = options.factGraph;
    } else {
      this.factGraph = null; // assigned once the database opens
    }
    this.factGraphReady = false;
    // Specs are loaded from the durable graph after the database opens. Seeds are
    // materialized only for names that have no persisted node, so a user
    // revision is never replaced by the built-in defaults.
    this.agentSpecs = new Map();
    this.database = null;
    this.closed = false;
    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    mkdirSync(this.artifactsDir, { recursive: true, mode: 0o700 });
    try {
      this.database = this.openDatabase(this.databasePath);
      this.loadAgentSpecs();
      if (this.factGraph === null) {
        this.factGraph = createSqliteFactGraph({ database: this.database, workspaceId: this.workspaceId });
      }
    } catch (error) { this.initializationError = error; }
  }

  openDatabase(file) {
    const database = new DatabaseSync(file, { timeout: 5000 });
    try { initializeSchema(database, this.workspaceId); return database; } catch (error) { database.close(); throw error; }
  }

  /**
   * Copy every tombstone row (active and revoked) from the current index
   * into a replacement database during rebuild. Row-for-row, ids included,
   * so restore bookkeeping survives the swap.
   */
  copyTombstones(replacement) {
    const source = this.database;
    if (!source) return 0;
    const rows = source.prepare("SELECT id, target_kind, target_id, reason, created_at, revoked_at FROM tombstones").all();
    const insert = replacement.prepare("INSERT OR IGNORE INTO tombstones (id, target_kind, target_id, reason, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const row of rows) insert.run(row.id, row.target_kind, row.target_id, row.reason, row.created_at, row.revoked_at);
    return rows.length;
  }

  assertOpen() {
    if (this.closed || !this.database) throw this.initializationError ?? notReady();
    return this.database;
  }

  loadAgentSpecs() {
    const database = this.database;
    if (!database) return;
    const rows = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, created_at AS createdAt, anchor_json AS anchorJson FROM node_revisions WHERE kind = 'agent_spec' ORDER BY created_at DESC, node_revision_id DESC").all();
    const existingNames = new Set(rows.map((row) => typeof row.nodeId === "string" && row.nodeId.startsWith("agent-spec:") ? row.nodeId.slice("agent-spec:".length) : null).filter(Boolean));
    const revisionIds = new Set(rows.map((row) => row.nodeRevisionId));
    const parentIds = revisionIds.size === 0 ? new Set() : new Set(database.prepare("SELECT parent_id AS parentId FROM revision_parents WHERE parent_id IN (" + [...revisionIds].map(() => "?").join(",") + ")").all(...revisionIds).map((row) => row.parentId));
    const loaded = new Map();
    for (const row of rows) {
      if (parentIds.has(row.nodeRevisionId) || !row.anchorJson) continue;
      let payload;
      try { payload = JSON.parse(row.anchorJson); } catch { continue; }
      if (!isObject(payload?.__histosSpec)) continue;
      try {
        const spec = normalizeAgentSpec(payload.__histosSpec);
        if (!loaded.has(spec.name)) loaded.set(spec.name, { spec, nodeId: row.nodeId, nodeRevisionId: row.nodeRevisionId });
      } catch { /* malformed persisted specs are ignored until explicitly repaired */ }
    }
    for (const spec of seedSpecs()) {
      if (!existingNames.has(spec.name)) {
        const graph = agentSpecGraph(spec);
        this.agentSpecs.set(spec.name, spec);
        this.persistAgentSeed(graph);
      }
    }
    for (const [name, item] of loaded) this.agentSpecs.set(name, item.spec);
  }

  persistAgentSeed(graph) {
    const result = emptyResult(this.workspaceId);
    resultFromWebGraph(graph, result);
    this.database.exec("BEGIN IMMEDIATE");
    try { rowsFromResult(this.database, result); this.database.exec("COMMIT"); } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  async rebuild(options = {}) {
    if (!isObject(options)) throw invalid("rebuild options must be an object");
    if (this.closed) throw notReady();
    const temporary = `${this.databasePath}.${process.pid}.${randomUUID()}.tmp`;
    const check = () => checkAbort(options.signal, options.isCancelled ?? options.cancelled);
    let replacement = null;
    try {
      const result = emptyResult(this.workspaceId);
      await scanSources({ ...this.scanOptions, ...options }, result, check);
      // Agent specs are durable graph data, not process-local defaults. Carry the
      // currently resolved revisions into a rebuilt index so restart/rebuild
      // cannot erase user-authored capability definitions.
      for (const spec of this.agentSpecs.values()) resultFromWebGraph(agentSpecGraph(spec), result);
      check();
      replacement = this.openDatabase(temporary);
      replacement.exec("BEGIN IMMEDIATE");
      rowsFromResult(replacement, result);
      // Rebuild = rescan sources + replay tombstones: the rebuilt index must
      // inherit the archive state or an index refresh would resurrect
      // entries the user explicitly deleted.
      const tombstoneCount = this.copyTombstones(replacement);
      for (const { sha256 } of listArtifacts(this.artifactsDir, check)) {
        await provenance.hydrateArtifact(replacement, this.artifactsDir, sha256, { workspaceId: this.workspaceId });
      }
      replacement.prepare("INSERT INTO meta (key, value) VALUES ('last_rebuild_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now()));
      replacement.exec("COMMIT");
      validateSchema(replacement, this.workspaceId);
      check();
      replacement.close();
      replacement = null;
      if (this.database) this.database.close();
      this.database = null;
      const backup = `${this.databasePath}.${process.pid}.${randomUUID()}.bak`;
      let backedUp = false;
      try {
        try { renameSync(this.databasePath, backup); backedUp = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
        renameSync(temporary, this.databasePath);
        const opened = this.openDatabase(this.databasePath);
        this.database = opened;
        this.initializationError = undefined;
        if (backedUp) rmSync(backup, { force: true });
      } catch (error) {
        try { rmSync(this.databasePath, { force: true }); } catch { /* best effort */ }
        try { if (backedUp) renameSync(backup, this.databasePath); } catch { /* preserve original error */ }
        try { this.database = this.openDatabase(this.databasePath); this.initializationError = undefined; } catch { this.database = null; this.initializationError = error; }
        throw error;
      }
      return { workspaceId: this.workspaceId, nodeCount: result.nodes.size, edgeCount: result.edges.size, artifactCount: listArtifacts(this.artifactsDir, () => {}).length, tombstoneCount };
    } catch (error) {
      try { replacement?.close(); } catch { /* best effort */ }
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  async applySessionFacts(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("applySessionFacts input must be an object");
    const result = emptyResult(this.workspaceId);
    const check = () => checkAbort(input.signal, input.isCancelled ?? input.cancelled);
    if (Array.isArray(input.facts)) {
      const sessionId = string(input.sessionId, "sessionId", 128);
      for (const fact of input.facts) {
        check();
        if (!isObject(fact)) continue;
        const entryId = typeof fact.entryId === "string" ? fact.entryId : fact.id;
        if (!entryId) continue;
        indexFact(result, sessionId, fact.fact ?? fact, entryId);
      }
    } else if (typeof input.file === "string" || typeof input.sessionFile === "string") {
      const scan = await adapters.scanSessionFile(input.file ?? input.sessionFile, { workspaceId: this.workspaceId });
      resultFromStructuralGraph(adapters.projectStructuralGraph(scan, { workspaceId: this.workspaceId, granularity: "entry" }), result);
    } else if (typeof input.sessionId === "string" && typeof input.sessionsRoot === "string") {
      await scanSources({ sessionsRoot: input.sessionsRoot }, result, check);
    } else {
      throw invalid("applySessionFacts requires facts, sessionFile, or sessionsRoot");
    }
    database.exec("BEGIN IMMEDIATE");
    try { rowsFromResult(database, result); database.prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now())); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    // Project the same fact stream into the FactGraphBackend (triple store).
    // The graph is a derived index over the durable JSONL, so a write
    // failure here never propagates back to the caller — the JSONL already
    // won. The `factsIndexed` counter lets callers observe the projection
    // without re-reading the backend.
    const factsIndexed = await this.deriveAndWriteFacts(input);
    return { nodeCount: result.nodes.size, edgeCount: result.edges.size, factsIndexed };
  }

  /**
   * Read the durable facts out of `input` (or out of the JSONL file when
   * the caller passed a `sessionFile`), project each to triples, and push
   * them through the FactGraphBackend. Returns the number of triples
   * accepted by the backend.
   */
  async deriveAndWriteFacts(input) {
    if (!this.factGraph) return 0;
    if (!this.factGraphReady) {
      try { await this.factGraph.start({ workspaceId: this.workspaceId }); this.factGraphReady = true; }
      catch { return 0; }
    }
    try {
      let facts = [];
      if (Array.isArray(input.facts)) {
        facts = input.facts
          .filter((fact) => fact && typeof fact === "object")
          .map((fact) => ({ ...(fact.fact ?? fact), sessionId: fact.sessionId ?? input.sessionId }));
      } else if (typeof input.file === "string" || typeof input.sessionFile === "string") {
        const scan = await adapters.scanSessionFile(input.file ?? input.sessionFile, { workspaceId: this.workspaceId });
        facts = Array.isArray(scan?.facts) ? scan.facts : [];
      } else if (typeof input.sessionId === "string" && typeof input.sessionsRoot === "string") {
        // Rebuilt sessions: project *every* JSONL fact across the workspace
        // into the graph so facts queries return the same shape as a live
        // session would. The scan only re-yields structural entries; for
        // durability the JSONL is the source of truth, the projection is
        // best-effort, and a rebuild can be re-run to repair drift.
        const sessions = await adapters.scanWorkspaceSessions(input.sessionsRoot, { workspaceId: this.workspaceId });
        for (const session of sessions) {
          for (const f of session?.facts ?? []) facts.push({ ...f, sessionId: session.sessionId });
        }
      }
      const triples = projectFactBatchToTriples(facts, { sessionId: input.sessionId });
      this.eventBus?.emit("on_session_facts_applied", boundEventPayload({ sessionId: input.sessionId, factCount: facts.length, tripleCount: triples.length }));
      if (triples.length === 0) return 0;
      this.eventBus?.emit("before_fact_triple_write", boundEventPayload({ sessionId: input.sessionId, count: triples.length }));
      const result = await this.factGraph.writeTriples(triples);
      this.eventBus?.emit("after_fact_triple_write", boundEventPayload({ sessionId: input.sessionId, ok: Boolean(result?.ok), count: result?.count ?? 0, code: result?.code ?? null }));
      return result?.ok ? result.count : 0;
    } catch {
      return 0;
    }
  }

  /** Write a batch of FactTriples directly. Caller is responsible for
   *  shape; this only routes through the active backend. */
  async writeFacts(triples) {
    if (!this.factGraph) return { ok: false, code: "not_ready", message: "Fact graph backend is not configured", count: 0 };
    if (!this.factGraphReady) {
      try { await this.factGraph.start({ workspaceId: this.workspaceId }); this.factGraphReady = true; }
      catch (error) { return { ok: false, code: error?.code ?? "start_failed", message: error instanceof Error ? error.message : String(error), count: 0 }; }
    }
    return this.factGraph.writeTriples(Array.isArray(triples) ? triples : []);
  }

  /** Read FactTriples with the same scope-aware query the surface needs.
   *  Triples hidden by an active tombstone are filtered out of the result. */
  async queryFacts(query = {}) {
    if (!this.factGraph) return { ok: false, code: "not_ready", message: "Fact graph backend is not configured", triples: [] };
    if (!this.factGraphReady) {
      try { await this.factGraph.start({ workspaceId: this.workspaceId }); this.factGraphReady = true; }
      catch (error) { return { ok: false, code: error?.code ?? "start_failed", message: error instanceof Error ? error.message : String(error), triples: [] }; }
    }
    const result = await this.factGraph.queryTriples(query);
    if (!result?.ok || !Array.isArray(result.triples) || result.triples.length === 0) return result;
    const archived = activeTombstoneIds(this.assertOpen(), "triple");
    if (archived.size === 0) return result;
    return { ...result, triples: result.triples.filter((triple) => !archived.has(triple.id)) };
  }

  /** Return FactGraphBackend stats. */
  async factStats() {
    if (!this.factGraph) return { tripleCount: 0, distinctSubjects: 0, distinctPredicates: 0 };
    if (!this.factGraphReady) {
      try { await this.factGraph.start({ workspaceId: this.workspaceId }); this.factGraphReady = true; }
      catch { return { tripleCount: 0, distinctSubjects: 0, distinctPredicates: 0 }; }
    }
    return this.factGraph.stats();
  }

  /** Drop every fact triple in the current scope. */
  async clearFacts() {
    if (!this.factGraph) return { ok: false, code: "not_ready", message: "Fact graph backend is not configured", count: 0 };
    if (!this.factGraphReady) {
      try { await this.factGraph.start({ workspaceId: this.workspaceId }); this.factGraphReady = true; }
      catch (error) { return { ok: false, code: error?.code ?? "start_failed", message: error instanceof Error ? error.message : String(error), count: 0 }; }
    }
    return this.factGraph.clear();
  }

  /**
   * P5 observability: project diagnostic observations into the Fact Graph,
   * deduped by absolute path (newest per file wins, omp diagnostics ledger
   * pattern). The JSONL fact stream keeps full history; only the derived
   * index is compacted. The caller (Main) also routes the same observations
   * to the agent worker's recordDiagnosticObserved for the durable fact.
   */
  async applyDiagnostics(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || !Array.isArray(input.diagnostics)) throw invalid("applyDiagnostics requires a diagnostics array");
    if (input.diagnostics.length > 1000) throw invalid("applyDiagnostics accepts at most 1000 diagnostics");
    const normalized = [];
    for (const item of input.diagnostics) {
      if (!isObject(item) || typeof item.file !== "string" || item.file.length === 0 || item.file.length > 1024) throw invalid("each diagnostic requires a file");
      if (!["info", "warning", "error"].includes(item.severity)) throw invalid("diagnostic severity must be info, warning or error");
      normalized.push({ file: item.file, severity: item.severity, message: String(item.message ?? "").slice(0, 4096), ts: Number.isFinite(item.ts) ? item.ts : Date.now() });
    }
    const keyOf = (file) => file.replace(/[^A-Za-z0-9_.:-]/g, "_");
    // Collect the stale per-file rows *before* writing (the new rows match
    // the same subject+predicate and must not be deleted).
    const staleById = new Map();
    for (const item of normalized) {
      const subject = `file:${keyOf(item.file)}`;
      const stale = database.prepare("SELECT id FROM fact_triples WHERE subject = ? AND predicate = 'custom_diagnostic_observed'").all(subject);
      if (stale.length > 0) staleById.set(subject, stale.map((row) => row.id));
    }
    const triples = normalized.map((item) => ({
      subject: `file:${keyOf(item.file)}`,
      predicate: "custom_diagnostic_observed",
      object: `${item.severity}:${item.message}`,
      source: "diagnostic",
      validFrom: item.ts,
      tag: "diagnostic",
    }));
    // Write the new projection first, then delete the pre-collected stale
    // rows. A failed write leaves the previous diagnostics intact (never a
    // silent loss); the content-addressed ids make re-runs collapse. The
    // FTS5 mirror is kept in sync on delete (external-content tables need
    // the 'delete' command, not a plain row delete).
    const written = await this.writeFacts(triples);
    if (!written.ok) {
      return { ok: written.ok, count: 0, dedupedFiles: normalized.length, code: written.code, message: written.message };
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const ids of staleById.values()) {
        if (ids.length > 0) deleteTriplesWithFts(database, ids);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, count: written.count ?? 0, dedupedFiles: normalized.length };
  }

  /** P5 FTS5 keyword search over fact triple text. */
  async ftsSearch(input = {}) {
    if (!this.factGraph) return { ok: false, code: "not_ready", message: "Fact graph backend is not configured", triples: [] };
    if (!this.factGraphReady) {
      try { await this.factGraph.start({ workspaceId: this.workspaceId }); this.factGraphReady = true; }
      catch (error) { return { ok: false, code: error?.code ?? "start_failed", message: error instanceof Error ? error.message : String(error), triples: [] }; }
    }
    if (typeof this.factGraph.searchFts !== "function") return { ok: false, code: "unsupported", message: "backend does not provide FTS search", triples: [] };
    const result = await this.factGraph.searchFts(input);
    if (!result.ok) return result;
    // Archival consistency: archived/purged triples must stay invisible to
    // keyword search just like every other read path (the FTS mirror cannot
    // see tombstones, so filter the projection).
    const archived = activeTombstoneIds(this.assertOpen(), "triple");
    if (archived.size > 0) result.triples = result.triples.filter((triple) => !archived.has(triple.id));
    return result;
  }

  /**
   * P6 selection conversation: build the L0 skeleton + L1 distilled prompt
   * for a node/edge selection. Cheap and deterministic — the byte cost is
   * the enforceable part of the progressive-disclosure promise.
   */
  buildSelectionPrompt(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || !Array.isArray(input.nodeRevisionIds) || !Array.isArray(input.edgeRevisionIds)) {
      throw invalid("buildSelectionPrompt requires nodeRevisionIds and edgeRevisionIds arrays");
    }
    const query = { ...queryOf({ ...input, sourceSet: input.sourceSet ?? {}, lens: input.lens ?? "structural", granularity: input.granularity ?? "entry" }) };
    const graph = graphRows(database, query);
    const selectedNodes = graph.nodes.filter((node) => input.nodeRevisionIds.includes(node.nodeRevisionId) || input.nodeRevisionIds.includes(node.nodeId));
    const selectedEdges = graph.edges.filter((edge) => input.edgeRevisionIds.includes(edge.edgeRevisionId) || input.edgeRevisionIds.includes(edge.edgeId));
    const prompt = selection.buildSelectionPrompt({
      title: typeof input.title === "string" ? input.title : undefined,
      nodes: selectedNodes,
      edges: selectedEdges,
    });
    return { ok: true, prompt, bytes: selection.selectionPromptBytes(prompt), nodeCount: selectedNodes.length, edgeCount: selectedEdges.length };
  }

  /**
   * P6 histos_expand backend: extract span-level original text for a
   * FactAddress (L2) with a hard budget (fail-closed, never silently
   * truncated). The reader resolves the entry from the workspace sessions
   * root — the JSONL authority, never the derived index.
   */
  expandEvidence(input = {}) {
    const sessionsRoot = this.scanOptions?.sessionsRoot;
    if (typeof sessionsRoot !== "string" || sessionsRoot.length === 0) {
      return { ok: false, code: "no_sessions_root", message: "engine has no sessions root to expand against" };
    }
    return selection.expandEvidence(input, selection.jsonlEntryReader(sessionsRoot));
  }

  /**
   * P0 archive: write tombstones over the given targets. The JSONL fact
   * authority is never touched — a tombstone only hides rows from the
   * derived index read paths (graphRows/queryFacts/getNode/suggestContext).
   * Idempotent: an already-active tombstone for the same target is left as
   * is. Approval accounting is fail-closed (throws, nothing written).
   */
  archiveEntries(kind, ids, reason = null) {
    const database = this.assertOpen();
    if (typeof kind !== "string" || !TOMBSTONE_TARGET_KINDS.has(kind)) {
      throw invalid(`archiveEntries.kind must be one of ${[...TOMBSTONE_TARGET_KINDS].join(", ")}`);
    }
    if (!Array.isArray(ids) || ids.length === 0) throw invalid("archiveEntries requires a non-empty ids array");
    if (ids.length > MAX_TOMBSTONE_IDS) throw invalid(`archiveEntries accepts at most ${MAX_TOMBSTONE_IDS} ids per call`);
    const targets = [...new Set(ids.map((id) => string(id, "archiveEntries.id", 512)))];
    if (reason !== undefined && reason !== null) {
      if (typeof reason !== "string" || reason.length === 0 || reason.length > MAX_TOMBSTONE_REASON) {
        throw invalid(`archiveEntries.reason must be a string of at most ${MAX_TOMBSTONE_REASON} characters`);
      }
    }
    assertEntriesArchivable(database, kind, targets);
    const insert = database.prepare(
      "INSERT OR IGNORE INTO tombstones (id, target_kind, target_id, reason, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)",
    );
    const activeLookup = database.prepare("SELECT id FROM tombstones WHERE target_kind = ? AND target_id = ? AND revoked_at IS NULL");
    const archived = [];
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const target of targets) {
        if (activeLookup.get(kind, target)) continue;
        insert.run(tombstoneId(), kind, target, reason ?? null, now());
        archived.push(target);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    this.eventBus?.emit("on_entries_archived", boundEventPayload({ targetKind: kind, count: archived.length, targets: archived }));
    return { ok: true, targetKind: kind, archivedCount: archived.length, archived, skippedCount: targets.length - archived.length };
  }

  /**
   * P0 restore: revoke tombstones so the archived objects reappear in every
   * read path. The revocation itself is the audit record (revoked_at on the
   * tombstone row); rows are never deleted, so restore is repeatable and
   * the archive/restore chain stays queryable.
   */
  restoreEntries(tombstoneIds) {
    const database = this.assertOpen();
    if (!Array.isArray(tombstoneIds) || tombstoneIds.length === 0) throw invalid("restoreEntries requires a non-empty tombstoneIds array");
    if (tombstoneIds.length > MAX_TOMBSTONE_IDS) throw invalid(`restoreEntries accepts at most ${MAX_TOMBSTONE_IDS} ids per call`);
    const requested = [...new Set(tombstoneIds.map((id) => string(id, "restoreEntries.tombstoneId", 64)))];
    const select = database.prepare("SELECT id, target_kind AS targetKind, target_id AS targetId, revoked_at AS revokedAt FROM tombstones WHERE id = ?");
    const update = database.prepare("UPDATE tombstones SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL");
    const restored = [];
    const notFound = [];
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const id of requested) {
        const row = select.get(id);
        if (!row) {
          notFound.push(id);
          continue;
        }
        if (row.revokedAt === null || row.revokedAt === undefined) {
          update.run(now(), id);
          restored.push({ tombstoneId: id, targetKind: row.targetKind, targetId: row.targetId });
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    if (restored.length > 0) {
      this.eventBus?.emit("on_entries_restored", boundEventPayload({ count: restored.length, entries: restored }));
    }
    return { ok: true, restoredCount: restored.length, restored, notFound };
  }

  /**
   * List the archive ledger so the surface can show what is archived and
   * offer restore. Active tombstones (revoked_at IS NULL) come first; the
   * audit trail (revoked tombstones) stays queryable too, bounded so a
   * large ledger cannot blow up the IPC payload.
   */
  listTombstones({ limit = 200, includeRevoked = false } = {}) {
    const database = this.assertOpen();
    const bounded = Number.isSafeInteger(limit) ? Math.max(1, Math.min(1000, limit)) : 200;
    const rows = database.prepare(
      `SELECT id, target_kind AS targetKind, target_id AS targetId, reason, created_at AS createdAt, revoked_at AS revokedAt
       FROM tombstones
       WHERE revoked_at IS NULL OR (? = 1)
       ORDER BY (revoked_at IS NULL) DESC, created_at DESC, id ASC
       LIMIT ?`,
    ).all(includeRevoked === true ? 1 : 0, bounded);
    return { ok: true, tombstones: rows, count: rows.length, total: database.prepare("SELECT COUNT(*) AS count FROM tombstones WHERE revoked_at IS NULL").get().count };
  }

  /**
   * P0 erase: the only physical deletion. Index rows (fact_triples /
   * node_revisions / edge_revisions / artifacts) disappear for good and
   * artifact files are removed from disk. Approval accounting refuses to be
   * purged while its session exists. The caller (Main, forwarded to the
   * agent worker) records the returned `purgeFact` through
   * `session-facts.recordPurgeFact` so the erase itself stays auditable in
   * the JSONL — the erased payload never is. Content that lives in a
   * session JSONL cannot be removed by a record-level purge, so the result
   * names the owning sessions with the delete-session hint.
   */
  purgeEntries(kind, ids, reason = null) {
    const database = this.assertOpen();
    if (typeof kind !== "string" || !TOMBSTONE_TARGET_KINDS.has(kind)) {
      throw invalid(`purgeEntries.kind must be one of ${[...TOMBSTONE_TARGET_KINDS].join(", ")}`);
    }
    if (!Array.isArray(ids) || ids.length === 0) throw invalid("purgeEntries requires a non-empty ids array");
    if (ids.length > MAX_TOMBSTONE_IDS) throw invalid(`purgeEntries accepts at most ${MAX_TOMBSTONE_IDS} ids per call`);
    const targets = [...new Set(ids.map((id) => string(id, "purgeEntries.id", 512)))];
    if (reason !== undefined && reason !== null) {
      if (typeof reason !== "string" || reason.length === 0 || reason.length > MAX_TOMBSTONE_REASON) {
        throw invalid(`purgeEntries.reason must be a string of at most ${MAX_TOMBSTONE_REASON} characters`);
      }
    }
    assertEntriesArchivable(database, kind, targets);
    if (kind === "session_index") {
      // Session-level erase reuses omega:deleteSession (whole JSONL file,
      // path-containment checked); there is nothing to delete here.
      throw invalid("purgeEntries cannot purge session_index targets; use omega:deleteSession for session-level erase");
    }

    const affectedSessions = new Set();
    const placeholders = targets.map(() => "?").join(",");
    if (kind === "triple") {
      for (const row of database.prepare(`SELECT source FROM fact_triples WHERE id IN (${placeholders})`).all(...targets)) {
        const match = /^session:(.+)$/.exec(row.source ?? "");
        if (match) affectedSessions.add(match[1]);
      }
    } else {
      const revisionColumn = kind === "node" ? "node_revision_id" : kind === "edge" ? "edge_revision_id" : null;
      if (revisionColumn) {
        for (const row of database.prepare(`SELECT a.object_id AS objectId FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id IN (${placeholders}) AND a.source_type = 'session_entry'`).all(...targets)) {
          const separator = row.objectId.indexOf("/");
          if (separator > 0) affectedSessions.add(row.objectId.slice(0, separator));
        }
      }
    }

    const purged = [];
    const artifactFiles = [];
    database.exec("BEGIN IMMEDIATE");
    try {
      if (kind === "triple") {
        deleteTriplesWithFts(database, targets);
      } else if (kind === "node") {
        database.prepare(`DELETE FROM evidence WHERE revision_id IN (${placeholders})`).run(...targets);
        database.prepare(`DELETE FROM revision_parents WHERE child_id IN (${placeholders}) OR parent_id IN (${placeholders})`).run(...targets, ...targets);
        database.prepare(`DELETE FROM node_revisions WHERE node_revision_id IN (${placeholders})`).run(...targets);
      } else if (kind === "edge") {
        database.prepare(`DELETE FROM evidence WHERE revision_id IN (${placeholders})`).run(...targets);
        database.prepare(`DELETE FROM revision_parents WHERE child_id IN (${placeholders}) OR parent_id IN (${placeholders})`).run(...targets, ...targets);
        database.prepare(`DELETE FROM edge_revisions WHERE edge_revision_id IN (${placeholders})`).run(...targets);
      } else if (kind === "artifact") {
        for (const row of database.prepare(`SELECT sha256 FROM artifacts WHERE sha256 IN (${placeholders})`).all(...targets)) artifactFiles.push(row.sha256);
        database.prepare(`DELETE FROM artifacts WHERE sha256 IN (${placeholders})`).run(...targets);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    // Artifact files are deleted after the transaction commits; a failed
    // unlink leaves the file orphaned on disk but the index is already
    // honest (the row is gone and the next rebuild re-scans sources).
    for (const sha256 of [...new Set(artifactFiles)]) {
      try { rmSync(join(this.artifactsDir, `${sha256}.json`), { force: true }); purged.push(sha256); } catch { /* best effort; the row is already gone */ }
    }
    if (kind === "triple" || kind === "node" || kind === "edge") purged.push(...targets);
    const purgeFact = { targetKind: kind, targetIds: purged, ...(reason ? { reason } : {}) };
    this.eventBus?.emit("on_entries_purged", boundEventPayload({ targetKind: kind, count: purged.length, targets: purged, ...(affectedSessions.size > 0 ? { sessions: [...affectedSessions] } : {}) }));
    return {
      ok: true,
      targetKind: kind,
      purgedCount: purged.length,
      purged,
      // Record-level erase cannot reach into a session JSONL: name the
      // owning sessions so the UI can offer the session-level erase.
      ...(affectedSessions.size > 0
        ? {
            sessions: [...affectedSessions],
            hint: "原文属于会话 JSONL，记录级抹除不会删除会话原文；彻底删除请删除该会话",
          }
        : {}),
      purgeFact,
    };
  }

  /**
   * Index fetched web pages. Accepts either already-fetched `resources` or a
   * list of `urls` to fetch here. A single unreachable URL is recorded as a
   * diagnostic instead of failing the whole batch — one bad link should not
   * discard the pages that did load.
   */
  async applyWebResources(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("applyWebResources input must be an object");
    const check = () => checkAbort(input.signal, input.isCancelled ?? input.cancelled);
    const diagnostics = [];

    let resources = Array.isArray(input.resources) ? input.resources : null;
    if (!resources) {
      const urls = Array.isArray(input.urls) ? input.urls : [];
      if (urls.length === 0) throw invalid("applyWebResources requires resources or urls");
      resources = [];
      for (const url of urls) {
        check();
        try {
          resources.push(
            await webSource.fetchWebResource({
              url,
              ...(Number.isSafeInteger(input.timeoutMs) ? { timeoutMs: input.timeoutMs } : {}),
              ...(Number.isSafeInteger(input.maxBytes) ? { maxBytes: input.maxBytes } : {}),
              ...(typeof input.fetchImpl === "function" ? { fetchImpl: input.fetchImpl } : {}),
            }),
          );
        } catch (error) {
          diagnostics.push({
            code: typeof error?.code === "string" ? error.code : "fetch_failed",
            message: `failed to fetch ${String(url).slice(0, 512)}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
    if (resources.length === 0) return { nodeCount: 0, edgeCount: 0, diagnostics };

    const result = emptyResult(this.workspaceId);
    const graph = webSource.projectWebGraph(resources, {
      workspaceId: this.workspaceId,
      granularity: input.granularity === "span" ? "span" : "entry",
      ...(Number.isSafeInteger(input.chunkLength) ? { chunkLength: input.chunkLength } : {}),
    });
    resultFromWebGraph(graph, result);
    linkNodeRevisionParents(database, result);

    database.exec("BEGIN IMMEDIATE");
    try {
      rowsFromResult(database, result);
      database
        .prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(now()));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return {
      nodeCount: result.nodes.size,
      edgeCount: result.edges.size,
      diagnostics: [...diagnostics, ...(graph.diagnostics ?? [])],
    };
  }

  /**
   * P4 repo source: index a repository root into file/module nodes and
   * dependency edges (pure-text heuristics). Content changes append new
   * revisions via the same contentSha256 + revision-chain contract the web
   * source uses. `root` is supplied by Main (an authorized workspace root),
   * never by the renderer.
   */
  async applyRepoIndex(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || typeof input.root !== "string" || input.root.length === 0 || input.root.length > 4096) {
      throw invalid("applyRepoIndex requires a repository root");
    }
    const graph = repoSource.scanRepository(input.root, {
      ...(Number.isSafeInteger(input.maxFiles) ? { maxFiles: input.maxFiles } : {}),
      ...(Number.isSafeInteger(input.maxDepth) ? { maxDepth: input.maxDepth } : {}),
    });
    const result = emptyResult(this.workspaceId);
    resultFromWebGraph(graph, result);
    linkNodeRevisionParents(database, result);

    database.exec("BEGIN IMMEDIATE");
    try {
      rowsFromResult(database, result);
      database
        .prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(now()));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return {
      nodeCount: result.nodes.size,
      edgeCount: result.edges.size,
      fileCount: graph.fileCount ?? 0,
      diagnostics: graph.diagnostics ?? [],
    };
  }

  /**
   * Project MCP server configurations into the graph (P1). Config content
   * changes append a new revision to the mcp_config node's chain instead of
   * overwriting, so the canvas can show how a server's config evolved.
   */
  async applyMcpConfigs(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || !Array.isArray(input.configs)) throw invalid("applyMcpConfigs requires a configs array");
    const result = emptyResult(this.workspaceId);
    const graph = adapters.projectMcpConfigGraph(input.configs);
    resultFromWebGraph(graph, result);
    linkNodeRevisionParents(database, result);

    database.exec("BEGIN IMMEDIATE");
    try {
      rowsFromResult(database, result);
      database
        .prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(now()));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { nodeCount: result.nodes.size, edgeCount: result.edges.size, diagnostics: graph.diagnostics ?? [] };
  }

  /**
   * Persist evaluator observations as content-addressed GraphRevision artifacts.
   * Invalid batches are normalized before any artifact or database write, and
   * repeated observations collapse by their deterministic node revision id.
   */
  async applyEvalResults(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("applyEvalResults input must be an object");
    if (!Array.isArray(input.results) || input.results.length === 0) throw invalid("applyEvalResults requires results");

    // Normalize and validate the complete batch first: malformed evaluator data
    // must fail closed without partially materializing an otherwise valid prefix.
    const entries = input.results.map((item) => {
      const graph = evalResultGraph(normalizeEvalResult(item));
      const artifact = validateArtifact({ workspaceId: this.workspaceId, ...graph }, { workspaceId: this.workspaceId, kind: "graph_revision" });
      return { graph: artifact };
    });

    const stored = [];
    for (const { graph } of entries) {
      const sha256 = await writeArtifact(this.artifactsDir, graph, { workspaceId: this.workspaceId, kind: "graph_revision" });
      stored.push({ ...graph, sha256 });
    }

    const result = emptyResult(this.workspaceId);
    for (const artifact of stored) {
      // insertArtifact adds the artifact sha to its indexed rows; this second
      // projection carries that same sha while preserving the shared row path.
      resultFromWebGraph({
        ...artifact,
        nodes: artifact.nodes.map((node) => ({ ...node, artifactSha: artifact.sha256 })),
        edges: artifact.edges.map((edge) => ({ ...edge, artifactSha: artifact.sha256 })),
      }, result);
    }
    linkNodeRevisionParents(database, result);
    const latestIncoming = new Map();
    for (const item of result.nodes.values()) {
      const previous = latestIncoming.get(item.nodeId);
      if (previous && previous.nodeRevisionId !== item.nodeRevisionId) addParent(result, item.nodeRevisionId, previous.nodeRevisionId);
      latestIncoming.set(item.nodeId, item);
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const artifact of stored) insertArtifact(database, artifact, artifact.sha256);
      rowsFromResult(database, result);
      database
        .prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(now()));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return {
      nodeCount: result.nodes.size,
      edgeCount: result.edges.size,
      artifactCount: stored.length,
      sha256s: stored.map((artifact) => artifact.sha256),
    };
  }

  /**
   * Index agent orchestration activity: specs (configurations) and runs
   * (executions). Both reuse the web graph reader because a spec and a run are
   * nodes with content addressed revisions exactly like a fetched page — the
   * only difference is what the evidence addresses point at.
   */
  applyAgentActivity(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("applyAgentActivity input must be an object");
    const result = emptyResult(this.workspaceId);
    const specs = Array.isArray(input.specs) ? input.specs : [];
    const runs = Array.isArray(input.runs) ? input.runs : [];
    if (specs.length === 0 && runs.length === 0) throw invalid("applyAgentActivity requires specs or runs");
    for (const spec of specs) {
      const normalized = normalizeAgentSpec(spec);
      this.agentSpecs.set(normalized.name, normalized);
      resultFromWebGraph(agentSpecGraph(normalized), result);
    }
    for (const run of runs) resultFromWebGraph(agentRunGraph(run), result);
    linkNodeRevisionParents(database, result);
    database.exec("BEGIN IMMEDIATE");
    try {
      rowsFromResult(database, result);
      database
        .prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(now()));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { nodeCount: result.nodes.size, edgeCount: result.edges.size };
  }

  getGraph(query) {
    return graphRows(this.assertOpen(), queryOf(query));
  }

  /** Return the currently materialized capability specs and their revisions. */
  listCapabilities(input = {}) {
    this.assertOpen();
    if (!isObject(input)) throw invalid("listCapabilities input must be an object");
    const names = Array.isArray(input.names) ? new Set(input.names.map((name) => string(name, "capability name", 128))) : null;
    return [...this.agentSpecs.values()]
      .filter((spec) => !names || names.has(spec.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((spec) => {
        const graph = agentSpecGraph(spec);
        const node = graph.nodes[0];
        return { name: spec.name, nodeId: node.nodeId, revisionId: agentSpecRevisionId(spec), surface: spec.surface, executor: spec.executor, trust: spec.trust, wired: spec.executor === "agent-loop" || spec.executor === "flow-engine" };
      });
  }

  /** Resolve a graph-addressed spec and produce a safe dry-run/invocation plan. */
  invokeNode(input = {}) {
    const database = this.assertOpen();
    const request = normalizeInvocationRequest(input);
    if (!request) throw invalid("invokeNode requires a valid agent spec node request");
    const prefix = "agent-spec:";
    const name = request.nodeId.startsWith(prefix) ? request.nodeId.slice(prefix.length) : request.nodeId;
    if (!name || name.length > 128) return { ok: false, code: "not_found", message: "agent spec was not found" };

    const rows = database.prepare("SELECT n.node_revision_id AS nodeRevisionId, n.node_id AS nodeId, n.anchor_json AS anchorJson, a.revision_id AS specRevisionId FROM node_revisions n JOIN evidence e ON e.revision_id = n.node_revision_id JOIN addresses a ON a.address_id = e.address_id WHERE n.kind = 'agent_spec' AND n.node_id = ? AND a.source_type = 'agent_spec' AND a.object_id = ? AND e.role = 'produces' ORDER BY n.created_at DESC, n.node_revision_id DESC").all(`agent-spec:${name}`, name);
    if (rows.length === 0) return { ok: false, code: "not_found", message: `agent spec "${name}" was not found` };
    const selected = request.revisionId ? rows.find((row) => row.specRevisionId === request.revisionId) : rows[0];
    if (!selected) return { ok: false, code: "revision_mismatch", message: `agent spec "${name}" has no persisted revision "${request.revisionId}"` };
    if (!selected.anchorJson) return { ok: false, code: "revision_mismatch", message: `agent spec "${name}" revision is missing its persisted content` };
    let spec;
    try {
      const payload = JSON.parse(selected.anchorJson);
      spec = normalizeAgentSpec(payload?.__histosSpec);
      if (agentSpecRevisionId(spec) !== selected.specRevisionId) throw new Error("spec revision mismatch");
    } catch {
      return { ok: false, code: "not_found", message: `agent spec "${name}" has no usable persisted revision` };
    }
    const result = planInvocationFromRequest(request, spec, { options: { specRevisionId: selected.specRevisionId } });
    return {
      ...result,
      nodeId: `agent-spec:${spec.name}`,
      ...(result.ok && result.plan?.executionRequest ? {
        executionRequest: {
          ...result.plan.executionRequest,
          ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
          ...(request.args !== undefined ? { args: request.args } : {}),
        },
      } : {}),
    };
  }

  /**
   * P3 strategy co-creation gate: validate a mode/orchestration/workflow
   * draft (schema + permission + budget, fail-closed). Returns the draft
   * with its checks; a draft that fails any check must not be approved.
   */
  createStrategyDraft(input = {}) {
    return strategy.createStrategyDraft(input);
  }

  /**
   * P3 approval: persist an approved strategy draft as an agent_spec node
   * (new revision, content-addressed) so it appears on the canvas and
   * `invokeNode` can plan against it. Unapproved drafts never reach this
   * path and have no runnable representation.
   */
  approveStrategyDraft(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || typeof input.draftId !== "string") throw invalid("approveStrategyDraft requires draftId");
    const draft = isObject(input.draft) ? input.draft : null;
    if (!draft) throw invalid("approveStrategyDraft requires the draft object");
    const checks = strategy.validateStrategyDraft({ ...draft, ...(Number.isSafeInteger(input.budget) ? { maxBudget: input.budget } : {}) });
    if (!checks.ok) throw Object.assign(new Error(`strategy draft failed validation: ${checks.message}`), { code: checks.code });
    const spec = normalizeAgentSpec(strategy.strategyDraftToSpec(draft));
    const existing = database.prepare("SELECT 1 AS present FROM node_revisions WHERE node_id = ? AND kind = 'agent_spec' LIMIT 1").get(`agent-spec:${spec.name}`);
    if (existing) throw Object.assign(new Error(`strategy "${spec.name}" is already approved and persisted`), { code: "already_approved" });
    const graph = agentSpecGraph(spec);
    this.persistAgentSeed(graph);
    this.agentSpecs.set(spec.name, spec);
    const result = {
      ok: true,
      nodeId: `agent-spec:${spec.name}`,
      nodeRevisionId: graph.nodes[0].nodeRevisionId,
      specRevisionId: agentSpecRevisionId(spec),
      approvedAt: Date.now(),
    };
    this.eventBus?.emit("on_strategy_approved", boundEventPayload(result));
    return result;
  }

  /**
   * P7 capability operation flows: parse skill/extension/MCP content into
   * structured trigger->steps->outputs artifacts. Content hash changes
   * append a new revision (web-source contract), so the canvas shows how a
   * capability's operation flow evolved. Also indexes project knowledge
   * files (AGENTS.md / .ravel rules) as versioned knowledge nodes.
   */
  async applyCapabilityFlows(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || !Array.isArray(input.flows)) throw invalid("applyCapabilityFlows requires a flows array");
    if (input.flows.length > 512) throw invalid("applyCapabilityFlows accepts at most 512 flows");
    const result = emptyResult(this.workspaceId);
    const diagnostics = [];
    for (const flow of input.flows) {
      try {
        const parsed = parseCapabilityFlow({ kind: flow.kind, name: flow.name, content: String(flow.content ?? "") });
        const evidence = [{ role: "supports", address: { sourceType: "skill", objectId: `capability:${flow.kind}:${flow.name}`, revisionId: parsed.artifact.contentSha256 } }];
        resultFromWebGraph({
          nodes: [{
            id: parsed.nodeId,
            nodeId: parsed.nodeId,
            nodeRevisionId: parsed.nodeRevisionId,
            kind: "skill",
            title: `${parsed.artifact.name}: ${parsed.artifact.description}`.slice(0, 512),
            createdAt: Date.now(),
            evidence,
            metadata: { capability: parsed.artifact },
          }],
          edges: [],
          diagnostics: [],
        }, result);
      } catch (error) {
        diagnostics.push({ code: "invalid_flow", message: error instanceof Error ? error.message : String(error) });
      }
    }
    linkNodeRevisionParents(database, result);
    database.exec("BEGIN IMMEDIATE");
    try {
      rowsFromResult(database, result);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { nodeCount: result.nodes.size, diagnostics };
  }

  /**
   * P7 project knowledge: version AGENTS.md / .ravel rules / context-source
   * files into the graph with a revision chain, effective scope
   * (user/project) and a distilled summary (first non-empty lines).
   */
  async applyProjectKnowledge(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || !Array.isArray(input.files)) throw invalid("applyProjectKnowledge requires a files array");
    if (input.files.length > 512) throw invalid("applyProjectKnowledge accepts at most 512 files");
    const result = emptyResult(this.workspaceId);
    for (const file of input.files) {
      if (!isObject(file) || typeof file.path !== "string" || file.path.length === 0 || file.path.length > 1024) continue;
      const content = typeof file.content === "string" ? file.content : "";
      if (content.length === 0) continue;
      const scope = file.scope === "project" ? "project" : "user";
      const contentSha256 = hashId(content);
      const nodeId = `knowledge:${scope}:${file.path}`;
      const nodeRevisionId = hashId(`knowledge-node:${nodeId}:${contentSha256}`);
      const summary = content.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4).join(" ");
      resultFromWebGraph({
        nodes: [{
          id: nodeId,
          nodeId,
          nodeRevisionId,
          kind: "knowledge",
          title: `${file.path} · ${scope}`.slice(0, 512),
          createdAt: Date.now(),
          evidence: [{ role: "supports", address: { sourceType: "file", objectId: nodeId, revisionId: contentSha256 } }],
          metadata: { scope, summary: summary.slice(0, 512), bytes: content.length },
        }],
        edges: [],
        diagnostics: [],
      }, result);
    }
    linkNodeRevisionParents(database, result);
    database.exec("BEGIN IMMEDIATE");
    try {
      rowsFromResult(database, result);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { nodeCount: result.nodes.size };
  }

  /**
   * P8 handoff: package the current session into a handoff document artifact
   * (compaction-entry style, freezeable as a ContextSet for cross-session
   * attach). Refuses while a compaction is running (busy, fail-closed) so
   * handoff never races the summarizer.
   */
  async createHandoff(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input) || typeof input.sessionId !== "string" || input.sessionId.length === 0) throw invalid("createHandoff requires sessionId");
    if (input.busy === true) {
      return { ok: false, code: "handoff_busy", message: "compaction is running; handoff is refused to avoid racing it" };
    }
    const summary = typeof input.summary === "string" && input.summary.length > 0 ? input.summary.slice(0, 8192) : `Handoff for session ${input.sessionId}`;
    const anchors = Array.isArray(input.anchors) ? input.anchors.slice(0, 4096).map(String) : [];
    const artifact = validateArtifact({
      schemaVersion: 1,
      workspaceId: this.workspaceId,
      kind: "handoff",
      sourceSet: { sessionIds: [input.sessionId] },
      lens: "structural",
      granularity: "entry",
      handoff: { sessionId: input.sessionId, summary, anchors },
    }, { workspaceId: this.workspaceId, kind: "handoff" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "handoff" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try {
      insertArtifact(database, stored, sha256);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, sha256, kind: "handoff", sessionId: input.sessionId, freezeableAsContextSet: true };
  }

  /**
   * P8 artifact library: list every content-addressed artifact on disk.
   */
  listArtifacts() {
    const artifacts = listArtifacts(this.artifactsDir, () => {});
    return artifacts;
  }

  async condenseGraph(input = {}) {
    const query = queryOf(input);
    if (query.lens === "structural") throw invalid("condenseGraph requires semantic or mixed lens");
    const budget = input.budget === undefined ? MAX_CONDENSE_BUDGET : input.budget;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_CONDENSE_BUDGET) throw invalid(`budget must be between 1 and ${MAX_CONDENSE_BUDGET}`);
    const parentSha = typeof input.parentSha === "string" ? input.parentSha : null;
    if (parentSha !== null && !/^[0-9a-f]{64}$/.test(parentSha)) throw invalid("parentSha must be a lowercase SHA-256 hash");
    const provider = input.provider === undefined ? undefined : string(input.provider, "provider", 256);
    const modelId = input.modelId === undefined ? undefined : string(input.modelId, "modelId", 256);
    const semanticModel = provider !== undefined && modelId !== undefined ? { provider, modelId } : undefined;
    const database = this.assertOpen();
    const structural = graphRows(database, { ...query, lens: "structural" });
    const nodes = structural.nodes;
    if (nodes.length > MAX_CONDENSE_NODES) throw Object.assign(new Error(`semantic condensation exceeds ${MAX_CONDENSE_NODES} nodes`), { code: "cost_cap_exceeded" });
    if (!this.semanticProvider) {
      return { ok: false, code: "semantic_provider_unavailable", diagnostics: [{ code: "offline", message: "Semantic condensation requires an available model provider" }] };
    }
    const condensed = [];
    const condensedEvidence = [];
    const revisionMap = new Map(nodes.map((node) => [node.nodeRevisionId, hashId(`semantic-node:${query.lens}:${node.nodeRevisionId}:${parentSha ?? "root"}`)]));
    const semanticByNodeId = new Map(nodes.map((node) => [node.nodeId, revisionMap.get(node.nodeRevisionId)]));
    let remainingBudget = budget;
    for (const node of nodes) {
      const sourceEvidence = structural.evidence.filter((item) => item.revisionId === node.nodeRevisionId);
      const evidenceCost = sourceEvidence.reduce((total, item) => total + canonicalJson(item).length, 0);
      const nodeCost = canonicalJson(node).length + evidenceCost;
      if (nodeCost > MAX_CONDENSE_BUDGET) throw Object.assign(new Error("semantic condensation node exceeds maximum budget"), { code: "cost_cap_exceeded" });
      if (nodeCost > remainingBudget) throw Object.assign(new Error("semantic condensation budget exceeded"), { code: "cost_cap_exceeded" });
      const result = await this.semanticProvider({ node, evidence: sourceEvidence, budget: remainingBudget, ...(semanticModel ?? {}) });
      if (typeof result !== "string" || result.length === 0) throw Object.assign(new Error("semantic provider returned no summary"), { code: "provider_invalid" });
      const nodeRevisionId = revisionMap.get(node.nodeRevisionId);
      condensed.push({ ...node, nodeRevisionId, parentId: node.parentId ? revisionMap.get(node.parentId) ?? semanticByNodeId.get(node.parentId) ?? null : null, title: result.slice(0, 4096), artifactSha: null });
      for (const evidence of sourceEvidence) condensedEvidence.push({ ...evidence, revisionId: nodeRevisionId });
      remainingBudget -= nodeCost;
    }
    const condensedEdges = structural.edges.filter((edge) => revisionMap.has(edge.srcNodeId) && revisionMap.has(edge.dstNodeId)).map((edge) => ({
      ...edge,
      edgeRevisionId: hashId(`semantic-edge:${query.lens}:${edge.edgeRevisionId}:${parentSha ?? "root"}`),
      srcNodeId: revisionMap.get(edge.srcNodeId),
      dstNodeId: revisionMap.get(edge.dstNodeId),
      artifactSha: null,
    }));
    const artifact = validateArtifact({ schemaVersion: 1, workspaceId: this.workspaceId, kind: "graph_revision", sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity, nodes: condensed, edges: condensedEdges, evidence: condensedEvidence, parents: parentSha ? [parentSha] : [] }, { workspaceId: this.workspaceId, kind: "graph_revision" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "graph_revision" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { ok: true, sha256, artifact: stored, diagnostics: [] };
  }

  /**
   * resource.distill profile: one user-triggered LLM summary of a resource
   * center item (skill/extension/prompt). The file content arrives from Main
   * (which validates registration); the engine owns the prompt, the evidence
   * address (sourceType=skill anchored at the content hash) and the resulting
   * GraphRevision plus an optional draft ContextSet. Nothing executes.
   */
  async distillResource(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("distillResource input must be an object");
    const resourceKind = ["skill", "extension", "prompt"].includes(input.kind) ? input.kind : null;
    if (!resourceKind) throw invalid("distillResource.kind must be skill, extension, or prompt");
    const name = string(input.name, "distillResource.name", 256);
    const filePath = string(input.filePath, "distillResource.filePath", 1024);
    if (typeof input.revisionId !== "string" || !/^[0-9a-f]{64}$/.test(input.revisionId)) throw invalid("distillResource.revisionId must be a lowercase SHA-256 hash");
    if (typeof input.content !== "string" || input.content.length === 0 || Buffer.byteLength(input.content, "utf8") > MAX_DISTILL_CONTENT_BYTES) {
      throw invalid(`distillResource.content must be a non-empty string up to ${MAX_DISTILL_CONTENT_BYTES} bytes`);
    }
    if (!this.semanticProvider) {
      return { ok: false, code: "semantic_provider_unavailable", diagnostics: [{ code: "offline", message: "Resource distillation requires an available model provider" }] };
    }
    const parentSha = typeof input.parentSha === "string" && /^[0-9a-f]{64}$/.test(input.parentSha) ? input.parentSha : null;
    const provider = input.provider === undefined ? undefined : string(input.provider, "provider", 256);
    const modelId = input.modelId === undefined ? undefined : string(input.modelId, "modelId", 256);
    const semanticModel = provider !== undefined && modelId !== undefined ? { provider, modelId } : undefined;
    const prompt = [
      `Summarize this ${resourceKind} ("${name}") for an agent skill library.`,
      "Describe what it does, when an agent should use it, and its key constraints. Reply with the summary text only.",
      "",
      "CONTENT:",
      input.content,
    ].join("\n");
    let summary;
    try {
      summary = await this.semanticProvider({ kind: resourceKind, name, prompt, budget: MAX_CONDENSE_BUDGET, ...(semanticModel ?? {}) });
    } catch (error) {
      throw Object.assign(new Error(`Resource distillation failed: ${error instanceof Error ? error.message : String(error)}`), { code: error?.code ?? "provider_invalid" });
    }
    if (typeof summary !== "string" || summary.trim().length === 0) throw Object.assign(new Error("semantic provider returned no summary"), { code: "provider_invalid" });

    const address = validateAddress({ sourceType: "skill", objectId: `${resourceKind}:${name}+${filePath}`, revisionId: input.revisionId }, { workspaceId: this.workspaceId });
    const nodeId = hashId(`resource:${resourceKind}:${name}`);
    const nodeRevisionId = hashId(`resource-distill:${resourceKind}:${name}:${input.revisionId}:${parentSha ?? "root"}`);
    const node = { nodeId, nodeRevisionId, kind: "skill", title: summary.trim().slice(0, 4096), createdAt: now() };
    const evidence = [{ revisionId: nodeRevisionId, role: "supports", address }];
    const sourceSet = { resource: `${resourceKind}:${name}` };
    const artifact = validateArtifact(
      { schemaVersion: 1, workspaceId: this.workspaceId, kind: "graph_revision", sourceSet, lens: "semantic", granularity: "file", nodes: [node], edges: [], evidence, parents: parentSha ? [parentSha] : [] },
      { workspaceId: this.workspaceId, kind: "graph_revision" },
    );
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "graph_revision" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.prepare("INSERT INTO meta (key, value) VALUES ('last_apply_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now())); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }

    // Optional draft ContextSet over the distilled node. Freezing writes an
    // artifact only; context_attached is appended when the user attaches it
    // to a session, never automatically.
    const draft = await this.freezeContext({ sourceSet, lens: "semantic", granularity: "file", selection: [{ nodeRevisionId }], budget: MAX_DISTILL_CONTEXT_BUDGET });
    return { ok: true, graphSha256: sha256, contextSha256: draft?.sha256 ?? null, node: { nodeId, nodeRevisionId, title: node.title } };
  }

  /**
   * memory.import profile: attach a ContextSet frozen in ANOTHER workspace by
   * its content-addressed sha. The only thing that crosses the boundary is
   * the already-frozen, already-budgeted artifact file — never the foreign
   * workspace's disk beyond its own artifacts dir, and never raw原文. The
   * imported artifact is re-owned to this workspace, parents pin the source
   * sha, and it must fit the current session budget or it fails closed
   * (budget_exceeded) before any write. Unresolvable evidence stays as-is;
   * rebuild marks it missing rather than silently filling gaps.
   */
  async importContext(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("importContext input must be an object");
    const sourceWorkspaceId = string(input.sourceWorkspaceId, "importContext.sourceWorkspaceId", 128);
    if (sourceWorkspaceId === this.workspaceId) throw invalid("source workspace must differ from the current workspace");
    if (typeof input.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceSha256)) throw invalid("importContext.sourceSha256 must be a lowercase SHA-256 hash");
    const sourceArtifactsDir = string(input.sourceArtifactsDir, "importContext.sourceArtifactsDir", 4096);
    const budget = input.budget === undefined ? MAX_DISTILL_CONTEXT_BUDGET : input.budget;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 64_000) throw invalid("importContext.budget must be between 1 and 64000");
    const source = await readArtifact(sourceArtifactsDir, input.sourceSha256, { workspaceId: sourceWorkspaceId, kind: "context_set" });
    const payload = { ...source, workspaceId: this.workspaceId, parents: [input.sourceSha256] };
    const bytes = Buffer.byteLength(canonicalJson(payload), "utf8");
    if (bytes > budget) {
      throw Object.assign(new Error(`imported ContextSet is ${bytes} bytes and exceeds the ${budget}-byte session budget`), { code: "budget_exceeded" });
    }
    const artifact = validateArtifact(payload, { workspaceId: this.workspaceId, kind: "context_set" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "context_set" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { sha256, sourceSha256: input.sourceSha256, artifact: stored };
  }

  /**
   * memory.suggest profile: deterministic, zero-LLM retrieval over durable
   * artifacts (node titles) for the workspace. This NEVER writes anything and
   * never injects into a session — it only proposes candidates the user may
   * review and freeze. No hits is an honest empty result.
   */
  suggestContext(input = {}) {
    const database = this.assertOpen();
    if (!isObject(input)) throw invalid("suggestContext input must be an object");
    const rawTerms = Array.isArray(input.terms) ? input.terms : typeof input.query === "string" ? input.query.split(/\s+/) : [];
    if (rawTerms.length === 0) throw invalid("suggestContext requires terms or a query string");
    if (rawTerms.length > 8) throw invalid("suggestContext accepts at most 8 terms");
    const terms = [...new Set(rawTerms.map((term) => String(term).trim().toLowerCase()).filter((term) => term.length >= 2 && term.length <= 64))];
    if (terms.length === 0) throw invalid("suggestContext terms must each be 2-64 characters after trimming");
    const limit = input.limit === undefined ? 8 : input.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) throw invalid("suggestContext.limit must be between 1 and 16");
    const archivedNodeIds = activeTombstoneIds(database, "node");
    const rows = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha FROM node_revisions ORDER BY created_at DESC, node_revision_id").all().filter((row) => !archivedNodeIds.has(row.nodeRevisionId));
    const evidenceCounts = new Map(database.prepare("SELECT revision_id AS revisionId, COUNT(*) AS count FROM evidence GROUP BY revision_id").all().map((row) => [row.revisionId, row.count]));
    const lensBySha = new Map(database.prepare("SELECT sha256, lens FROM artifacts").all().map((row) => [row.sha256, row.lens]));
    const candidates = [];
    for (const row of rows) {
      const title = String(row.title ?? "").toLowerCase();
      if (!title) continue;
      const matched = terms.filter((term) => title.includes(term));
      if (matched.length === 0) continue;
      candidates.push({
        nodeRevisionId: row.nodeRevisionId,
        nodeId: row.nodeId,
        kind: row.kind,
        title: row.title,
        artifactSha: row.artifactSha,
        lens: row.artifactSha ? lensBySha.get(row.artifactSha) ?? null : "structural",
        createdAt: row.createdAt,
        evidenceCount: evidenceCounts.get(row.nodeRevisionId) ?? 0,
        matchedTerms: matched,
        score: matched.length,
      });
    }
    candidates.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    return { terms, candidates: candidates.slice(0, limit) };
  }

  getNode(first, second) {    const query = queryFromArgs(first, second);
    const nodeId = typeof first === "string" ? first : first.nodeId ?? first.id;
    string(nodeId, "nodeId");
    const database = this.assertOpen();
    const archivedNodeIds = activeTombstoneIds(database, "node");
    const candidateRows = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha, anchor_json AS anchorJson FROM node_revisions WHERE node_id = ? OR node_revision_id = ? ORDER BY created_at DESC").all(nodeId, nodeId).map((row) => ({ ...row, ...(row.anchorJson ? { anchor: JSON.parse(row.anchorJson) } : {}) })).map(({ anchorJson, ...row }) => row).filter((row) => !archivedNodeIds.has(row.nodeRevisionId)).filter((row) => revisionMatches(database, row.nodeRevisionId, query, row.artifactSha));
    const rows = filterRevisionsAsOf(database, candidateRows, query.asOf, "nodeRevisionId");
    if (rows.length === 0) return null;
    const graph = graphRows(database, query);
    return { ...rows[0], evidence: graph.evidence.filter((item) => item.revisionId === rows[0].nodeRevisionId), parents: graph.parents.filter((item) => item.childId === rows[0].nodeRevisionId) };
  }

  async executeFlow(input = {}) {
    if (!isObject(input) || typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sha256)) throw invalid("executeFlow requires a flow artifact SHA-256");
    const artifact = await readArtifact(this.artifactsDir, input.sha256, { workspaceId: this.workspaceId, kind: "flow_revision" });
    return executionPlanOf(artifact, input.sha256, { targetSessionId: input.targetSessionId });
  }

  async saveViewState(input = {}) {
    const query = queryOf(input);
    if (!isObject(input.viewState)) throw invalid("viewState must be an object");
    const positions = Array.isArray(input.viewState.positions) ? input.viewState.positions : [];
    if (positions.length > MAX_CONDENSE_NODES) throw invalid("viewState.positions exceeds the node limit");
    const normalized = positions.map((position) => {
      if (!isObject(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y) || typeof position.id !== "string") throw invalid("viewState position is invalid");
      return { id: string(position.id, "viewState position id", 512), x: position.x, y: position.y };
    });
    const artifact = validateArtifact({ schemaVersion: 1, workspaceId: this.workspaceId, kind: "view_state", sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity, positions: normalized, parents: [] }, { workspaceId: this.workspaceId, kind: "view_state" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "view_state" });
    const stored = { ...artifact, sha256 };
    this.assertOpen().exec("BEGIN IMMEDIATE");
    try { insertArtifact(this.database, stored, sha256); this.database.exec("COMMIT"); } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { sha256, artifact: stored };
  }

  async getViewState(input = {}) {
    const query = queryOf(input);
    const database = this.assertOpen();
    const row = database.prepare("SELECT sha256 FROM artifacts WHERE kind = 'view_state' AND source_set_json = ? AND lens = ? AND granularity = ? ORDER BY created_at DESC, sha256 DESC LIMIT 1").get(canonicalJson(query.sourceSet), query.lens, query.granularity);
    if (!row?.sha256) return null;
    const artifact = await readArtifact(this.artifactsDir, row.sha256, { workspaceId: this.workspaceId, kind: "view_state" });
    if (canonicalJson(artifact.sourceSet) !== canonicalJson(query.sourceSet) || artifact.lens !== query.lens || artifact.granularity !== query.granularity) {
      throw Object.assign(new Error("view state query does not match"), { code: "not_found" });
    }
    return { ...artifact, sha256: row.sha256 };
  }

  async freezeContext(input = {}) {
    const query = queryOf(input);
    const budget = input.budget === undefined ? 64_000 : input.budget;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 64_000) throw invalid("freezeContext.budget must be between 1 and 64000");
    const database = this.assertOpen();
    if (!Array.isArray(input.selection) || input.selection.length === 0) throw invalid("freezeContext.selection must be a non-empty array");
    const graph = graphRows(database, query);
    const requestedSelection = input.selection.map((item) => {
      if (typeof item === "string") return item;
      if (!isObject(item)) throw invalid("freezeContext.selection entries must be strings or objects");
      return item.nodeRevisionId ?? item.edgeRevisionId ?? item.id;
    });
    if (requestedSelection.some((item) => typeof item !== "string" || item.length === 0)) throw invalid("freezeContext.selection entries require an id");
    const selected = new Set(requestedSelection);
    const nodes = graph.nodes.filter((item) => selected.has(item.nodeRevisionId) || selected.has(item.nodeId));
    const edges = graph.edges.filter((item) => selected.has(item.edgeRevisionId) || selected.has(item.edgeId));
    const matchedSelection = new Set([...nodes.flatMap((node) => [node.nodeRevisionId, node.nodeId]), ...edges.flatMap((edge) => [edge.edgeRevisionId, edge.edgeId])]);
    const missingSelection = [...new Set(requestedSelection)].filter((item) => !matchedSelection.has(item)).sort();
    if (missingSelection.length > 0) {
      throw Object.assign(new Error(`ContextSet selection contains ${missingSelection.length} item(s) not present in the requested graph`), {
        code: "selection_not_found",
        diagnostics: [{ code: "selection_not_found", message: `Selected item(s) were not found: ${missingSelection.join(", ")}` }],
        result: { action: "refresh_or_adjust_selection", message: "Refresh the graph or remove selections that are no longer present, then try again.", missingSelection },
      });
    }
    const selectedRevisionIds = new Set([...nodes.map((node) => node.nodeRevisionId), ...edges.map((edge) => edge.edgeRevisionId)]);
    const evidence = graph.evidence.filter((item) => selectedRevisionIds.has(item.revisionId));

    // The selected node text and every selected FactAddress are mandatory. Only
    // one-hop neighbor summaries are optional, so a budget failure can never
    // turn into a successful attachment with silently missing evidence.
    const selectedPayload = contextPayload(query, this.workspaceId, nodes, edges, evidence);
    const selectedBytes = contextBytes(selectedPayload);
    const condensedTextBytes = contextBytes(contextPayload(query, this.workspaceId, nodes.map((node) => ({ nodeRevisionId: node.nodeRevisionId, nodeId: node.nodeId, title: node.title })), [], []));
    const directEvidenceBytes = contextBytes(contextPayload(query, this.workspaceId, [], [], evidence));
    const selectedStructureBytes = Math.max(0, selectedBytes - condensedTextBytes - directEvidenceBytes);
    const selectedBreakdown = { condensedTextBytes, directEvidenceBytes, selectedStructureBytes };
    const neighborNodeIds = new Set();
    const selectedNodeIds = new Set(nodes.map((node) => node.nodeId));
    for (const edge of edges) {
      if (!selectedNodeIds.has(edge.srcNodeId)) neighborNodeIds.add(edge.srcNodeId);
      if (!selectedNodeIds.has(edge.dstNodeId)) neighborNodeIds.add(edge.dstNodeId);
    }
    for (const edge of graph.edges) {
      if (selectedNodeIds.has(edge.srcNodeId) && !selectedNodeIds.has(edge.dstNodeId)) neighborNodeIds.add(edge.dstNodeId);
      if (selectedNodeIds.has(edge.dstNodeId) && !selectedNodeIds.has(edge.srcNodeId)) neighborNodeIds.add(edge.srcNodeId);
    }
    const neighbors = graph.nodes
      .filter((node) => neighborNodeIds.has(node.nodeId) && !selectedRevisionIds.has(node.nodeRevisionId))
      .map(contextNeighborSummary)
      .sort((left, right) => left.nodeRevisionId.localeCompare(right.nodeRevisionId));
    if (selectedBytes > budget) {
      return contextBudgetResult(budget, selectedBytes, contextBudgetDiagnostics(budget, selectedBytes, selectedRevisionIds.size, neighbors.length, selectedBreakdown));
    }

    const includedNeighbors = [];
    let payload = selectedPayload;
    for (const neighbor of neighbors) {
      const candidate = contextPayload(query, this.workspaceId, nodes, edges, evidence, [...includedNeighbors, neighbor]);
      if (contextBytes(candidate) > budget) break;
      includedNeighbors.push(neighbor);
      payload = candidate;
    }
    const omittedNeighborCount = neighbors.length - includedNeighbors.length;
    const diagnostics = omittedNeighborCount > 0
      ? [{ code: "neighbors_omitted", message: `${omittedNeighborCount} neighbor summaries were omitted to stay within the ${budget}-byte budget.` }]
      : [];
    const artifact = validateArtifact(payload, { workspaceId: this.workspaceId, kind: "context_set" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "context_set" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { sha256, artifact: stored, targetSessionId: input.targetSessionId ?? null, diagnostics, budget: { budget, selectedBytes, neighborCount: includedNeighbors.length, omittedNeighborCount } };
  }

  async convertToFlow(input = {}) {
    const query = queryOf(input);
    const database = this.assertOpen();
    const graph = graphRows(database, query);
    const selectedNodeRevisionIds = Array.isArray(input.selectedNodeRevisionIds) && input.selectedNodeRevisionIds.length > 0 ? input.selectedNodeRevisionIds : null;
    const selectedEdgeRevisionIds = Array.isArray(input.selectedEdgeRevisionIds) && input.selectedEdgeRevisionIds.length > 0 ? input.selectedEdgeRevisionIds : null;
    const draft = convertGraphToFlowDraft(graph, { workspaceId: this.workspaceId, selectedNodeRevisionIds, selectedEdgeRevisionIds, parentSha: input.parentSha ?? null });
    const validation = validateFlowSpec(draft, { workspaceId: this.workspaceId });
    if (!validation.ok) {
      const error = new Error(`Flow validation failed: ${validation.errors.join("; ")}`);
      error.code = "validation_failed";
      error.errors = validation.errors;
      throw error;
    }
    const sha256 = await writeArtifact(this.artifactsDir, validation.artifact, { workspaceId: this.workspaceId, kind: "flow_revision" });
    const stored = { ...validation.artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { sha256, artifact: stored, validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings } };
  }

  async getArtifact(input, maybeOptions) {
    const query = queryFromArgs(input, maybeOptions);
    const sha256 = typeof input === "string" ? input : input.sha256 ?? input.hash;
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw invalid("artifact sha256 must be a lowercase SHA-256 hash");
    const artifact = await readArtifact(this.artifactsDir, sha256, { workspaceId: this.workspaceId });
    if (artifact.sourceSet && canonicalJson(artifact.sourceSet) !== canonicalJson(query.sourceSet)) throw Object.assign(new Error("artifact sourceSet does not match query"), { code: "not_found" });
    if (artifact.lens !== query.lens || artifact.granularity !== query.granularity) throw Object.assign(new Error("artifact query does not match"), { code: "not_found" });
    return { ...artifact, sha256 };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.database?.close();
    this.database = null;
    if (this.factGraph && this.factGraphReady) {
      try { this.factGraph.stop?.(); } catch { /* best effort */ }
      this.factGraphReady = false;
    }
  }
}

export function createHistosEngine(options) {
  return new HistosEngine(options);
}

export const createEngine = createHistosEngine;
export default HistosEngine;
