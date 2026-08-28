import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as schema from "./histos-schema.js";
import * as addressModule from "./histos-address.js";
import * as adapters from "./histos-adapters.js";
import * as provenance from "./histos-provenance.js";
import { chunkFactAddress } from "./histos-chunker.js";
import { convertGraphToFlowDraft, executionPlanOf, validateFlowSpec } from "./flow-validation.js";

const LENSES = new Set(["structural", "semantic", "mixed"]);
const GRANULARITIES = new Set(["operation", "entry", "span", "file", "cluster"]);
const MAX_JSONL_FILES = 4096;
const MAX_ID = 1024;
const MAX_CONDENSE_NODES = 128;
const MAX_CONDENSE_BUDGET = 32_000;

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
    ...(parentId === undefined ? {} : { parentId }),
  };
  result.nodes.set(nodeRevisionId, item);
  for (const itemEvidence of evidence) addEvidence(result, nodeRevisionId, itemEvidence.address ?? itemEvidence.factAddress ?? itemEvidence, itemEvidence.role ?? "supports");
}

function nodeAnchorPayload(item) {
  if (!item.anchor && item.parentId === undefined) return null;
  return {
    ...(item.anchor ?? {}),
    ...(item.parentId === undefined ? {} : { __histosParentId: item.parentId }),
  };
}

function readNodeRow(row) {
  const payload = row.anchorJson ? JSON.parse(row.anchorJson) : null;
  const parentId = payload?.__histosParentId;
  if (payload) delete payload.__histosParentId;
  const hasAnchor = payload && Object.keys(payload).length > 0;
  const node = { ...row };
  delete node.anchorJson;
  return {
    ...node,
    ...(hasAnchor ? { anchor: payload } : {}),
    ...(typeof parentId === "string" ? { parentId } : {}),
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
  return lens === "semantic" && row?.lens === "semantic";
}

function graphRows(database, query) {
  const nodes = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha, anchor_json AS anchorJson FROM node_revisions ORDER BY created_at, node_revision_id").all().map(readNodeRow).filter((row) => revisionLensMatches(database, row.artifactSha, query.lens) && revisionMatches(database, row.nodeRevisionId, query));
  const edges = database.prepare("SELECT edge_revision_id AS edgeRevisionId, edge_id AS edgeId, src_node_id AS srcNodeId, dst_node_id AS dstNodeId, kind, created_at AS createdAt, artifact_sha AS artifactSha, anchor_json AS anchorJson FROM edge_revisions ORDER BY created_at, edge_revision_id").all().map((row) => ({ ...row, ...(row.anchorJson ? { anchor: JSON.parse(row.anchorJson) } : {}) })).map(({ anchorJson, ...row }) => row).filter((row) => revisionLensMatches(database, row.artifactSha, query.lens) && revisionMatches(database, row.edgeRevisionId, query));
  const revisions = [...nodes.map((item) => item.nodeRevisionId), ...edges.map((item) => item.edgeRevisionId)];
  const evidence = revisions.length === 0 ? [] : database.prepare(`SELECT e.revision_id AS revisionId, e.address_id AS addressId, e.role, a.source_type AS sourceType, a.object_id AS objectId, a.revision_id AS addressRevisionId, a.selector_json AS selectorJson FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id IN (${revisions.map(() => "?").join(",")})`).all(...revisions).map((row) => ({ revisionId: row.revisionId, addressId: row.addressId, role: row.role, address: { sourceType: row.sourceType, objectId: row.objectId, revisionId: row.addressRevisionId, ...(row.selectorJson ? { selector: JSON.parse(row.selectorJson) } : {}) } }));
  const withAnchors = (items, revisionKey) => items.map((item) => {
    const fallback = traceAnchorFor(item[revisionKey], evidence);
    return fallback && !item.anchor ? { ...item, anchor: fallback } : item;
  });
  const parents = database.prepare("SELECT child_id AS childId, parent_id AS parentId FROM revision_parents").all();
  return { nodes: withAnchors(nodes, "nodeRevisionId"), edges: withAnchors(edges, "edgeRevisionId"), evidence, parents, sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity };
}

export class HistosEngine {
  constructor(options = {}) {
    if (!isObject(options)) throw invalid("options must be an object");
    this.workspaceId = string(options.workspaceId, "workspaceId", 128);
    this.databasePath = resolve(options.databasePath ?? options.dbPath ?? options.indexPath ?? join(resolve(options.userDataDir ?? process.cwd()), "index.sqlite"));
    this.artifactsDir = resolve(options.artifactsDir ?? join(dirname(this.databasePath), "artifacts"));
    this.scanOptions = { ...options };
    this.semanticProvider = typeof options.semanticProvider === "function" ? options.semanticProvider : null;
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
    return { nodeCount: result.nodes.size, edgeCount: result.edges.size };
  }

  getGraph(query) {
    return graphRows(this.assertOpen(), queryOf(query));
  }

  async condenseGraph(input = {}) {
    const query = queryOf(input);
    if (query.lens === "structural") throw invalid("condenseGraph requires semantic or mixed lens");
    const budget = input.budget === undefined ? MAX_CONDENSE_BUDGET : input.budget;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_CONDENSE_BUDGET) throw invalid(`budget must be between 1 and ${MAX_CONDENSE_BUDGET}`);
    const parentSha = typeof input.parentSha === "string" ? input.parentSha : null;
    if (parentSha !== null && !/^[0-9a-f]{64}$/.test(parentSha)) throw invalid("parentSha must be a lowercase SHA-256 hash");
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
      const result = await this.semanticProvider({ node, evidence: sourceEvidence, budget: remainingBudget });
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

  getNode(first, second) {
    const query = queryFromArgs(first, second);
    const nodeId = typeof first === "string" ? first : first.nodeId ?? first.id;
    string(nodeId, "nodeId");
    const database = this.assertOpen();
    const rows = database.prepare("SELECT node_revision_id AS nodeRevisionId, node_id AS nodeId, kind, title, created_at AS createdAt, artifact_sha AS artifactSha, anchor_json AS anchorJson FROM node_revisions WHERE node_id = ? OR node_revision_id = ? ORDER BY created_at DESC").all(nodeId, nodeId).map((row) => ({ ...row, ...(row.anchorJson ? { anchor: JSON.parse(row.anchorJson) } : {}) })).map(({ anchorJson, ...row }) => row).filter((row) => revisionMatches(database, row.nodeRevisionId, query));
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
    const selected = new Set(input.selection.map((item) => typeof item === "string" ? item : item.nodeRevisionId ?? item.edgeRevisionId ?? item.id));
    const nodes = graph.nodes.filter((item) => selected.has(item.nodeRevisionId) || selected.has(item.nodeId));
    const edges = graph.edges.filter((item) => selected.has(item.edgeRevisionId) || selected.has(item.edgeId));
    const evidence = graph.evidence.filter((item) => nodes.some((node) => node.nodeRevisionId === item.revisionId) || edges.some((edge) => edge.edgeRevisionId === item.revisionId));
    const size = canonicalJson({ nodes, edges, evidence }).length;
    if (size > budget) throw Object.assign(new Error("ContextSet budget exceeded; choose fewer nodes or increase the budget"), { code: "budget_exceeded" });
    const artifact = validateArtifact({ schemaVersion: 1, workspaceId: this.workspaceId, kind: "context_set", sourceSet: query.sourceSet, lens: query.lens, granularity: query.granularity, selection: evidence.map((item) => ({ revisionId: item.revisionId, addressId: item.addressId, role: item.role, address: item.address })), nodes, edges, evidence, parents: [] }, { workspaceId: this.workspaceId, kind: "context_set" });
    const sha256 = await writeArtifact(this.artifactsDir, artifact, { workspaceId: this.workspaceId, kind: "context_set" });
    const stored = { ...artifact, sha256 };
    database.exec("BEGIN IMMEDIATE");
    try { insertArtifact(database, stored, sha256); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { sha256, artifact: stored, targetSessionId: input.targetSessionId ?? null };
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
  }
}

export function createHistosEngine(options) {
  return new HistosEngine(options);
}

export const createEngine = createHistosEngine;
export default HistosEngine;
