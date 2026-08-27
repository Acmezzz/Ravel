import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as schema from "./histos-schema.js";
import * as addressModule from "./histos-address.js";
import * as adapters from "./histos-adapters.js";
import * as provenance from "./histos-provenance.js";

const LENSES = new Set(["structural", "semantic", "mixed"]);
const GRANULARITIES = new Set(["operation", "entry", "span", "file", "cluster"]);
const MAX_JSONL_FILES = 4096;
const MAX_ID = 1024;

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
  return { sourceSet, lens, granularity };
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

function addNode(result, node, evidence = []) {
  if (!isObject(node)) return;
  const nodeRevisionId = string(node.nodeRevisionId ?? node.revisionId, "nodeRevisionId");
  const nodeId = string(node.nodeId, "nodeId");
  const item = {
    nodeRevisionId,
    nodeId,
    kind: string(node.kind ?? "entry", "node.kind", 64),
    title: node.title === undefined ? null : String(node.title).slice(0, 4096),
    createdAt: Number.isSafeInteger(node.createdAt) ? node.createdAt : now(),
    artifactSha: node.artifactSha ?? null,
  };
  result.nodes.set(nodeRevisionId, item);
  for (const itemEvidence of evidence) addEvidence(result, nodeRevisionId, itemEvidence.address ?? itemEvidence.factAddress ?? itemEvidence, itemEvidence.role ?? "supports");
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
  };
  result.edges.set(edgeRevisionId, item);
  for (const itemEvidence of evidence) addEvidence(result, edgeRevisionId, itemEvidence.address ?? itemEvidence.factAddress ?? itemEvidence, itemEvidence.role ?? "supports");
}

function addParent(result, childId, parentId) {
  result.parents.add(`${childId}\u0000${parentId}`);
}

function resultFromStructuralGraph(graph, result) {
  for (const node of graph.nodes ?? []) {
    const nodeRevisionId = hashId(`adapter-node:${node.id}`);
    const evidence = (node.evidence ?? []).map((item) => ({ ...item, revisionId: nodeRevisionId }));
    addNode(result, { nodeRevisionId, nodeId: node.id, kind: node.kind, title: node.title, createdAt: 0 }, evidence);
  }
  for (const edge of graph.edges ?? []) {
    const edgeRevisionId = hashId(`adapter-edge:${edge.id}`);
    const evidence = (edge.evidence ?? []).map((item) => ({ ...item, revisionId: edgeRevisionId }));
    addEdge(result, { edgeRevisionId, edgeId: edge.id, srcNodeId: edge.srcNodeId, dstNodeId: edge.dstNodeId, kind: edge.kind, createdAt: 0 }, evidence);
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
  const graph = adapters.projectStructuralGraph([...unique.values()], { workspaceId: result.workspaceId, granularity: options.granularity ?? "entry" });
  resultFromStructuralGraph(graph, result);
  for (const scan of unique.values()) result.sessionIds.add(scan.sessionId);
  return [...unique.values()].map((scan) => scan.filePath).filter(Boolean);
}

function emptyResult(workspaceId) {
  return { workspaceId, addresses: new Map(), nodes: new Map(), edges: new Map(), evidence: new Map(), parents: new Set(), sessionIds: new Set(), lastEntryBySession: new Map() };
}

function rowsFromResult(database, result) {
  const insertAddress = database.prepare("INSERT OR IGNORE INTO addresses (address_id, source_type, object_id, revision_id, selector_json) VALUES (?, ?, ?, ?, ?)");
  const insertNode = database.prepare("INSERT OR IGNORE INTO node_revisions (node_revision_id, node_id, kind, title, created_at, artifact_sha) VALUES (?, ?, ?, ?, ?, ?)");
  const insertEdge = database.prepare("INSERT OR IGNORE INTO edge_revisions (edge_revision_id, edge_id, src_node_id, dst_node_id, kind, created_at, artifact_sha) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertEvidence = database.prepare("INSERT OR IGNORE INTO evidence (revision_id, address_id, role) VALUES (?, ?, ?)");
  const insertParent = database.prepare("INSERT OR IGNORE INTO revision_parents (child_id, parent_id) VALUES (?, ?)");
  for (const [id, item] of result.addresses) insertAddress.run(id, item.sourceType, item.objectId, item.revisionId, item.selector ? JSON.stringify(item.selector) : null);
  for (const item of result.nodes.values()) insertNode.run(item.nodeRevisionId, item.nodeId, item.kind, item.title, item.createdAt, item.artifactSha);
  for (const item of result.edges.values()) insertEdge.run(item.edgeRevisionId, item.edgeId, item.srcNodeId, item.dstNodeId, item.kind, item.createdAt, item.artifactSha);
  for (const item of result.evidence.values()) insertEvidence.run(item.revisionId, item.addressId, item.role);
  for (const pair of result.parents) { const [childId, parentId] = pair.split("\u0000"); insertParent.run(childId, parentId); }
}

function artifactRecord(artifact, sha256) {
  return { sha256, kind: artifact.kind, createdAt: now(), sourceSetJson: canonicalJson(artifact.sourceSet), lens: artifact.lens, granularity: artifact.granularity };
}

function insertArtifact(database, artifact, sha256) {
  const row = artifactRecord(artifact, sha256);
  database.prepare("INSERT OR IGNORE INTO artifacts (sha256, kind, created_at, source_set_json, lens, granularity) VALUES (?, ?, ?, ?, ?, ?)").run(row.sha256, row.kind, row.createdAt, row.sourceSetJson, row.lens, row.granularity);
  const result = emptyResult(artifact.workspaceId);
  for (const item of artifact.nodes ?? []) addNode(result, { ...item, artifactSha: sha256 }, artifact.evidence ?? []);
  for (const item of artifact.edges ?? []) addEdge(result, { ...item, artifactSha: sha256 }, artifact.evidence ?? []);
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
  const sessions = sourceSet.sessions ?? sourceSet.sessionIds ?? sourceSet.sessionIds;
  if (Array.isArray(sessions) && sessions.length > 0) {
    const session = address.objectId.split("/")[0];
    if (!sessions.includes(session) && !sessions.includes(address.objectId)) return false;
  }
  const types = sourceSet.sourceTypes;
  if (Array.isArray(types) && types.length > 0 && !types.includes(address.sourceType)) return false;
  return true;
}

function revisionMatches(database, revisionId, query) {
  const rows = database.prepare("SELECT a.source_type AS sourceType, a.object_id AS objectId, a.revision_id AS revisionId FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id = ?").all(revisionId);
  return rows.length === 0 || rows.some((address) => sourceMatches(query.sourceSet, address));
}

function queryFromArgs(first, second, third) {
  if (isObject(first) && Object.hasOwn(first, "sourceSet")) return queryOf(first);
  if (isObject(second) && Object.hasOwn(second, "sourceSet")) return queryOf(second);
  if (isObject(third) && Object.hasOwn(third, "sourceSet")) return queryOf(third);
  throw invalid("query requires sourceSet, lens, and granularity");
}

function graphRows(database, query) {
  const nodes = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha FROM node_revisions ORDER BY created_at, node_revision_id").all().filter((row) => revisionMatches(database, row.nodeRevisionId, query));
  const edges = database.prepare("SELECT edge_revision_id AS edgeRevisionId, edge_id AS edgeId, src_node_id AS srcNodeId, dst_node_id AS dstNodeId, kind, created_at AS createdAt, artifact_sha AS artifactSha FROM edge_revisions ORDER BY created_at, edge_revision_id").all().filter((row) => revisionMatches(database, row.edgeRevisionId, query));
  const revisions = [...nodes.map((item) => item.nodeRevisionId), ...edges.map((item) => item.edgeRevisionId)];
  const evidence = revisions.length === 0 ? [] : database.prepare(`SELECT e.revision_id AS revisionId, e.address_id AS addressId, e.role, a.source_type AS sourceType, a.object_id AS objectId, a.revision_id AS addressRevisionId, a.selector_json AS selectorJson FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id IN (${revisions.map(() => "?").join(",")})`).all(...revisions).map((row) => ({ revisionId: row.revisionId, addressId: row.addressId, role: row.role, address: { sourceType: row.sourceType, objectId: row.objectId, revisionId: row.addressRevisionId, ...(row.selectorJson ? { selector: JSON.parse(row.selectorJson) } : {}) } }));
  const parents = database.prepare("SELECT child_id AS childId, parent_id AS parentId FROM revision_parents").all();
  return { nodes, edges, evidence, parents, sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity };
}

export class HistosEngine {
  constructor(options = {}) {
    if (!isObject(options)) throw invalid("options must be an object");
    this.workspaceId = string(options.workspaceId, "workspaceId", 128);
    this.databasePath = resolve(options.databasePath ?? options.dbPath ?? options.indexPath ?? join(resolve(options.userDataDir ?? process.cwd()), "index.sqlite"));
    this.artifactsDir = resolve(options.artifactsDir ?? join(dirname(this.databasePath), "artifacts"));
    this.scanOptions = { ...options };
    this.database = null;
    this.closed = false;
    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    mkdirSync(this.artifactsDir, { recursive: true, mode: 0o700 });
    try { this.database = this.openDatabase(this.databasePath); } catch (error) { this.initializationError = error; }
  }

  openDatabase(file) {
    const database = new DatabaseSync(file, { timeout: 5000 });
    try { initializeSchema(database, this.workspaceId); return database; } catch (error) { database.close(); throw error; }
  }

  assertOpen() {
    if (this.closed || !this.database) throw this.initializationError ?? notReady();
    return this.database;
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
      check();
      replacement = this.openDatabase(temporary);
      replacement.exec("BEGIN IMMEDIATE");
      rowsFromResult(replacement, result);
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
      return { workspaceId: this.workspaceId, nodeCount: result.nodes.size, edgeCount: result.edges.size, artifactCount: listArtifacts(this.artifactsDir, () => {}).length };
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
        indexFact(result, sessionId, fact, sessionAddress(sessionId, fact.id ?? `fact-${now()}`));
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
    return { nodeCount: result.nodes.size, edgeCount: result.edges.size };
  }

  getGraph(query) {
    return graphRows(this.assertOpen(), queryOf(query));
  }

  getNode(first, second) {
    const query = queryFromArgs(first, second);
    const nodeId = typeof first === "string" ? first : first.nodeId ?? first.id;
    string(nodeId, "nodeId");
    const database = this.assertOpen();
    const rows = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha FROM node_revisions WHERE node_id = ? OR node_revision_id = ? ORDER BY created_at DESC").all(nodeId, nodeId).filter((row) => revisionMatches(database, row.nodeRevisionId, query));
    if (rows.length === 0) return null;
    const graph = graphRows(database, query);
    return { ...rows[0], evidence: graph.evidence.filter((item) => item.revisionId === rows[0].nodeRevisionId), parents: graph.parents.filter((item) => item.childId === rows[0].nodeRevisionId) };
  }

  async freezeContext(input = {}) {
    const query = queryOf(input);
    const database = this.assertOpen();
    if (!Array.isArray(input.selection) || input.selection.length === 0) throw invalid("freezeContext.selection must be a non-empty array");
    const graph = graphRows(database, query);
    const selected = new Set(input.selection.map((item) => typeof item === "string" ? item : item.nodeRevisionId ?? item.edgeRevisionId ?? item.id));
    const nodes = graph.nodes.filter((item) => selected.has(item.nodeRevisionId) || selected.has(item.nodeId));
    const edges = graph.edges.filter((item) => selected.has(item.edgeRevisionId) || selected.has(item.edgeId));
    const evidence = graph.evidence.filter((item) => nodes.some((node) => node.nodeRevisionId === item.revisionId) || edges.some((edge) => edge.edgeRevisionId === item.revisionId));
    const artifact = validateArtifact({ schemaVersion: 1, workspaceId: this.workspaceId, kind: "context_set", sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity, selection: evidence.map((item) => ({ revisionId: item.revisionId, addressId: item.addressId, role: item.role, address: item.address })), nodes, edges, evidence, parents: [] }, { workspaceId: this.workspaceId, kind: "context_set" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "context_set" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { sha256, artifact: stored, targetSessionId: input.targetSessionId ?? null };
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
  }
}

export function createHistosEngine(options) {
  return new HistosEngine(options);
}

export const createEngine = createHistosEngine;
export default HistosEngine;
