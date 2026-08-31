const MAX = Object.freeze({ sessionId: 128, workspace: 4096, path: 4096, ptyData: 64 * 1024, ptyCwd: 4096 });
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function ptyCreateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sessionId = boundedString(value.sessionId, MAX.sessionId);
  const cwd = boundedString(value.cwd, MAX.ptyCwd);
  const cols = value.cols === undefined ? 80 : value.cols;
  const rows = value.rows === undefined ? 24 : value.rows;
  return sessionId && cwd && Number.isInteger(cols) && cols >= 1 && cols <= 500 && Number.isInteger(rows) && rows >= 1 && rows <= 300
    ? { sessionId, cwd, cols, rows } : null;
}

export function ptySessionRequest(value) {
  const sessionId = boundedString(value?.sessionId, MAX.sessionId);
  return sessionId ? { sessionId } : null;
}

export function ptyWriteRequest(value) {
  const request = ptySessionRequest(value);
  return request && typeof value.data === "string" && Buffer.byteLength(value.data, "utf8") <= MAX.ptyData
    ? { ...request, data: value.data } : null;
}

export function ptyResizeRequest(value) {
  const request = ptySessionRequest(value);
  return request && Number.isInteger(value.cols) && value.cols >= 1 && value.cols <= 500 && Number.isInteger(value.rows) && value.rows >= 1 && value.rows <= 300
    ? { ...request, cols: value.cols, rows: value.rows } : null;
}

export function boundedString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !CONTROL_CHARS.test(value) ? value : null;
}

export function sessionRequest(value) {
  const sessionId = boundedString(value?.sessionId, MAX.sessionId);
  return sessionId ? { sessionId } : null;
}

export function sessionNameRequest(value) {
  const name = boundedString(typeof value?.name === "string" ? value.name.trim() : "", 256);
  if (!name) return null;
  if (value?.sessionId == null || value.sessionId === "") return { name };
  const sessionId = boundedString(value.sessionId, MAX.sessionId);
  return sessionId ? { name, sessionId } : null;
}

export function workspaceRequest(value) {
  const workspace = boundedString(value?.workspace, MAX.workspace);
  return workspace ? { workspace } : null;
}

export function fileRequest(value) {
  const path = boundedString(value?.path, MAX.path);
  return path ? { path } : null;
}

export function replayRequest(value) {
  const sessionId = typeof value?.sessionId === "string" && value.sessionId.length <= MAX.sessionId ? value.sessionId : undefined;
  const after = Number.isFinite(value?.after) && value.after >= 0 ? value.after : 0;
  const runtimeEpoch = Number.isInteger(value?.runtimeEpoch) && value.runtimeEpoch >= 0 ? value.runtimeEpoch : 0;
  const limit = Number.isInteger(value?.limit) ? Math.max(1, Math.min(value.limit, 300)) : 100;
  return { sessionId, after, runtimeEpoch, limit };
}

export function gitCommitRequest(value) {
  const message = boundedString(value?.message, 8_000);
  return message ? { message } : null;
}

export function gitStageRequest(value) {
  const snapshotToken = boundedString(value?.snapshotToken, 256);
  const items = Array.isArray(value?.items) ? value.items.slice(0, 200).filter((item) => boundedString(item?.path, MAX.path)).map((item) => ({ path: item.path, hunks: Array.isArray(item.hunks) ? item.hunks.slice(0, 200).map((hunk) => String(hunk).slice(0, 64_000)) : undefined })) : [];
  return snapshotToken && items.length ? { snapshotToken, items } : null;
}

export function customProviderRequest(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

const HISTOS_LENSES = new Set(["structural", "semantic", "mixed"]);
const HISTOS_GRANULARITIES = new Set(["operation", "entry", "span", "file", "cluster"]);
const HISTOS_SOURCE_TYPES = new Set([
  "session_entry",
  "session_span",
  "operation",
  "tool",
  "approval",
  "file",
  "skill",
  "mcp_config",
  "checkpoint",
  "graph_revision",
  "flow_revision",
  "context_set",
  "web_resource",
  "agent_spec",
  "agent_run",
  "eval_result",
]);
const HISTOS_SELECTOR_KINDS = new Set(["span", "hunk", "json_path", "node", "edge"]);
const HISTOS_MAX_DEPTH = 12;
const HISTOS_MAX_ITEMS = 4_096;
const HISTOS_MAX_ID = 4_096;
const HISTOS_MAX_SELECTION = 2_000;
const HISTOS_MAX_FILES = 100_000;
const HISTOS_SHA256 = /^[0-9a-f]{64}$/;
const HISTOS_CONTROL = /[\u0000-\u001f\u007f]/;

function histosPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : null;
}

function histosString(value, _label, max = HISTOS_MAX_ID) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || HISTOS_CONTROL.test(value)) return null;
  return value;
}

function histosJsonValue(value, depth = 0, count = { items: 0 }) {
  count.items += 1;
  if (depth > HISTOS_MAX_DEPTH || count.items > HISTOS_MAX_ITEMS) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length <= HISTOS_MAX_ID && !HISTOS_CONTROL.test(value) ? value : null;
  if (Array.isArray(value)) {
    const mapped = value.map((item) => histosJsonValue(item, depth + 1, count));
    return mapped.every((item) => item !== null) ? mapped : null;
  }
  if (!histosPlainObject(value)) return null;
  const entries = Object.entries(value).map(([key, item]) => {
    const safeKey = histosString(key, "json key", HISTOS_MAX_ID);
    const safeValue = histosJsonValue(item, depth + 1, count);
    return safeKey && safeValue !== null ? [safeKey, safeValue] : null;
  });
  return entries.every((entry) => entry !== null) ? Object.fromEntries(entries) : null;
}

function histosSelector(value) {
  if (!value || typeof value !== "object" || typeof value.kind !== "string" || !HISTOS_SELECTOR_KINDS.has(value.kind)) return null;
  if (value.kind === "span") {
    if (!Number.isSafeInteger(value.start) || value.start < 0 || !Number.isSafeInteger(value.length) || value.length < 1) return null;
    return { kind: "span", start: value.start, length: value.length };
  }
  if (value.kind === "hunk") {
    if (!Number.isSafeInteger(value.startLine) || value.startLine < 1 || !Number.isSafeInteger(value.endLine) || value.endLine < value.startLine) return null;
    return { kind: "hunk", startLine: value.startLine, endLine: value.endLine };
  }
  if (value.kind === "json_path") {
    const path = histosString(value.path, "json_path.path", 512);
    return path ? { kind: "json_path", path } : null;
  }
  if (value.kind === "node") {
    const nodeRevisionId = histosString(value.nodeRevisionId, "nodeRevisionId", 512);
    return nodeRevisionId ? { kind: "node", nodeRevisionId } : null;
  }
  if (value.kind === "edge") {
    const edgeRevisionId = histosString(value.edgeRevisionId, "edgeRevisionId", 512);
    return edgeRevisionId ? { kind: "edge", edgeRevisionId } : null;
  }
  return null;
}

function histosAddress(value) {
  if (!value || typeof value !== "object") return null;
  const sourceType = histosString(value.sourceType, "sourceType", 64);
  if (!sourceType || !HISTOS_SOURCE_TYPES.has(sourceType)) return null;
  const objectId = histosString(value.objectId, "objectId", 512);
  if (!objectId) return null;
  if (sourceType === "file" && (/^\.\.\/|\.\.\\|\/\.\.\//i.test(objectId) || /^[A-Za-z]:[\\\/]/i.test(objectId) || /^[\\]{2}/i.test(objectId))) return null;
  const revisionId = histosString(value.revisionId, "revisionId", 512);
  if (!revisionId) return null;
  const selector = value.selector === undefined ? undefined : histosSelector(value.selector);
  if (selector === null) return null;
  return { sourceType, objectId, revisionId, ...(selector === undefined ? {} : { selector }) };
}

function histosQuery(value) {
  if (!value || typeof value !== "object") return null;
  const sourceSet = histosJsonValue(value.sourceSet, 0, { items: 0 });
  if (!sourceSet || typeof sourceSet !== "object" || Array.isArray(sourceSet)) return null;
  const lens = histosString(value.lens, "lens", 16);
  if (!lens || !HISTOS_LENSES.has(lens)) return null;
  const granularity = histosString(value.granularity, "granularity", 32);
  if (!granularity || !HISTOS_GRANULARITIES.has(granularity)) return null;
  const query = { sourceSet, lens, granularity };
  // P0 time travel: `asOf` is a timestamp (ms). The node/edge projection
  // shows the revision chain as it stood at that instant; triple asOf
  // semantics (validFrom/validUntil window) are unchanged elsewhere.
  if (value.asOf !== undefined && value.asOf !== null) {
    if (typeof value.asOf !== "number" || !Number.isFinite(value.asOf)) return null;
    query.asOf = value.asOf;
  }
  return query;
}

function histosSelection(value) {
  if (typeof value === "string") return histosString(value, "selection", 512);
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value).filter((key) => ["nodeRevisionId", "edgeRevisionId", "id"].includes(key));
  if (keys.length !== 1) return null;
  return { [keys[0]]: histosString(value[keys[0]], `selection.${keys[0]}`, 512) };
}

/** Normalize a Histos graph query without exposing filesystem or database paths. */
export function histosQueryRequest(value) {
  return histosQuery(value);
}

export function histosGetGraphRequest(value) {
  return histosQuery(value);
}

export function histosCondenseGraphRequest(value) {
  const query = histosQuery(value);
  if (!query || query.lens === "structural") return null;
  const budget = value?.budget === undefined ? undefined : Number.isSafeInteger(value.budget) && value.budget >= 1 && value.budget <= 32000 ? value.budget : null;
  if (budget === null) return null;
  const parentSha = value?.parentSha === undefined ? undefined : histosString(value.parentSha, "parentSha", 64);
  if (parentSha !== undefined && (parentSha === null || !HISTOS_SHA256.test(parentSha))) return null;
  return { ...query, ...(budget === undefined ? {} : { budget }), ...(parentSha === undefined ? {} : { parentSha }) };
}

export function histosExecuteFlowRequest(value) {
  const sha256 = histosString(value?.sha256, "sha256", 64);
  return sha256 && HISTOS_SHA256.test(sha256) ? { sha256 } : null;
}

export function histosSuggestContextRequest(value) {
  let terms = [];
  if (Array.isArray(value?.terms)) {
    if (value.terms.length < 1 || value.terms.length > 8) return null;
    terms = value.terms.map((term) => histosString(term, "terms", 64));
    if (terms.some((term) => term === null || term.length < 2)) return null;
  } else if (typeof value?.query === "string" && value.query.length > 0 && value.query.length <= 512) {
    terms = value.query.split(/\s+/).filter(Boolean);
  } else {
    return null;
  }
  const limit = value?.limit === undefined ? undefined : Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 16 ? value.limit : null;
  if (limit === null) return null;
  return { terms, ...(limit === undefined ? {} : { limit }) };
}

export function histosImportContextRequest(value) {
  const sourceWorkspaceId = histosString(value?.sourceWorkspaceId, "sourceWorkspaceId", 128);
  const sourceSha256 = histosString(value?.sourceSha256, "sourceSha256", 64);
  if (!sourceWorkspaceId || !sourceSha256 || !HISTOS_SHA256.test(sourceSha256)) return null;
  const budget = value?.budget === undefined ? undefined : Number.isSafeInteger(value.budget) && value.budget >= 1 && value.budget <= 64000 ? value.budget : null;
  if (budget === null) return null;
  return { sourceWorkspaceId, sourceSha256, ...(budget === undefined ? {} : { budget }) };
}

const HISTOS_DISTILL_KINDS = new Set(["skill", "extension", "prompt"]);

export function histosDistillResourceRequest(value) {
  const kind = histosString(value?.kind, "kind", 16);
  if (!kind || !HISTOS_DISTILL_KINDS.has(kind)) return null;
  const name = histosString(value?.name, "name", 256);
  const filePath = histosString(value?.filePath, "filePath", 1024);
  if (!name || !filePath) return null;
  const contentHash = histosString(value?.contentHash, "contentHash", 64);
  if (contentHash !== null && !HISTOS_SHA256.test(contentHash)) return null;
  return { kind, name, filePath, ...(contentHash ? { contentHash } : {}) };
}

/**
 * Web ingestion request. URLs are re-validated here as well as in the adapter:
 * the renderer is untrusted input, and a rejected URL must never reach the
 * network stack.
 */
export function histosApplyWebResourcesRequest(value) {
  if (!value || typeof value !== "object") return null;
  const granularity = value.granularity === undefined ? "entry" : value.granularity;
  if (granularity !== "entry" && granularity !== "span") return null;
  const urls = [];
  if (Array.isArray(value.urls)) {
    if (value.urls.length === 0 || value.urls.length > 64) return null;
    for (const url of value.urls) {
      if (typeof url !== "string" || url.length === 0 || url.length > 2_048) return null;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      if (parsed.username || parsed.password) return null;
      urls.push(url);
    }
  } else if (!Array.isArray(value.resources)) {
    return null;
  }
  if (value.resources !== undefined && (!Array.isArray(value.resources) || value.resources.length > 64)) return null;
  const payload = { granularity };
  if (urls.length) payload.urls = urls;
  if (Array.isArray(value.resources)) payload.resources = value.resources;
  if (Number.isSafeInteger(value.timeoutMs)) payload.timeoutMs = Math.min(value.timeoutMs, 120_000);
  if (Number.isSafeInteger(value.chunkLength)) payload.chunkLength = Math.min(value.chunkLength, 65_536);
  return payload;
}

/**
 * Agent orchestration activity. Only shape is checked here; the engine owns
 * semantic validation (fail-closed) so a malformed spec can never widen the
 * child's tool surface just because the renderer sent it.
 */
export function histosListCapabilitiesRequest(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.names !== undefined && (!Array.isArray(value.names) || value.names.length > 64 || value.names.some((name) => !histosString(name, 128)))) return null;
  return value.names ? { names: [...value.names] } : {};
}

export function histosInvokeNodeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nodeId = histosString(value.nodeId, 512);
  if (!nodeId) return null;
  if (value.revisionId !== undefined && !HISTOS_SHA256.test(value.revisionId)) return null;
  if (value.prompt !== undefined && (typeof value.prompt !== "string" || value.prompt.length > 40_000)) return null;
  if (value.args !== undefined && !histosJson(value.args)) return null;
  return { nodeId, ...(value.revisionId ? { revisionId: value.revisionId } : {}), ...(value.prompt !== undefined ? { prompt: value.prompt } : {}), ...(value.args !== undefined ? { args: value.args } : {}), ...(value.dryRun === true ? { dryRun: true } : {}) };
}

export function histosApplyAgentActivityRequest(value) {
  if (!value || typeof value !== "object") return null;
  const specs = Array.isArray(value.specs) ? value.specs.filter((spec) => spec && typeof spec === "object") : [];
  const runs = Array.isArray(value.runs) ? value.runs.filter((run) => run && typeof run === "object") : [];
  if (specs.length === 0 && runs.length === 0) return null;
  if (specs.length > 32 || runs.length > 64) return null;
  const payload = {};
  if (specs.length) payload.specs = specs;
  if (runs.length) payload.runs = runs;
  return payload;
}

export function histosApplyEvalResultsRequest(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.results) || value.results.length === 0 || value.results.length > 256) return null;
  if (value.results.some((result) => !result || typeof result !== "object" || Array.isArray(result))) return null;
  return { results: [...value.results] };
}

export function histosSaveViewStateRequest(value) {
  const query = histosQuery(value);
  if (!query || !Array.isArray(value?.positions) || value.positions.length > 500) return null;
  const positions = value.positions.map((position) => typeof position?.id === "string" && Number.isFinite(position.x) && Number.isFinite(position.y) ? { id: position.id, x: position.x, y: position.y } : null);
  return positions.some((position) => position === null) ? null : { ...query, positions };
}

export function histosGetViewStateRequest(value) {
  return histosQuery(value);
}

export function histosRebuildRequest(value) {
  const query = histosQuery(value);
  if (!query) return null;
  const maxFiles = value.maxFiles === undefined ? undefined : Number.isSafeInteger(value.maxFiles) && value.maxFiles >= 1 && value.maxFiles <= HISTOS_MAX_FILES ? value.maxFiles : null;
  return maxFiles === null ? null : { ...query, ...(maxFiles === undefined ? {} : { maxFiles }) };
}

export function histosGetNodeRequest(value) {
  const query = histosQuery(value);
  const nodeId = histosString(value?.nodeId ?? value?.id, "nodeId", 512);
  return query && nodeId ? { ...query, nodeId } : null;
}

export function histosFreezeContextRequest(value) {
  const query = histosQuery(value);
  if (!query || !Array.isArray(value.selection) || value.selection.length === 0 || value.selection.length > HISTOS_MAX_SELECTION) return null;
  const selection = value.selection.map(histosSelection);
  if (selection.some((item) => item === null)) return null;
  const targetSessionId = value.targetSessionId === undefined ? undefined : histosString(value.targetSessionId, "targetSessionId", 128);
  const budget = value.budget === undefined ? undefined : Number.isSafeInteger(value.budget) && value.budget >= 1 && value.budget <= 64000 ? value.budget : null;
  if (budget === null) return null;
  return targetSessionId === null ? null : { ...query, selection, ...(targetSessionId === undefined ? {} : { targetSessionId }), ...(budget === undefined ? {} : { budget }) };
}

export function histosConvertToFlowRequest(value) {
  const query = histosQuery(value);
  if (!query) return null;
  const selectedNodeRevisionIds = Array.isArray(value.selectedNodeRevisionIds) && value.selectedNodeRevisionIds.length > 0 && value.selectedNodeRevisionIds.length <= HISTOS_MAX_SELECTION
    ? value.selectedNodeRevisionIds.map((id) => histosString(id, "selectedNodeRevisionIds[]", 512)).filter((id) => id !== null)
    : undefined;
  if (selectedNodeRevisionIds !== undefined && (selectedNodeRevisionIds.length === 0 || selectedNodeRevisionIds.length !== value.selectedNodeRevisionIds.length)) return null;
  const selectedEdgeRevisionIds = Array.isArray(value.selectedEdgeRevisionIds) && value.selectedEdgeRevisionIds.length > 0 && value.selectedEdgeRevisionIds.length <= HISTOS_MAX_SELECTION
    ? value.selectedEdgeRevisionIds.map((id) => histosString(id, "selectedEdgeRevisionIds[]", 512)).filter((id) => id !== null)
    : undefined;
  if (selectedEdgeRevisionIds !== undefined && (selectedEdgeRevisionIds.length === 0 || selectedEdgeRevisionIds.length !== value.selectedEdgeRevisionIds.length)) return null;
  const parentSha = value.parentSha === undefined ? undefined : histosString(value.parentSha, "parentSha", 64);
  if (parentSha !== undefined && (parentSha === null || !HISTOS_SHA256.test(parentSha))) return null;
  return { ...query, ...(selectedNodeRevisionIds === undefined ? {} : { selectedNodeRevisionIds }), ...(selectedEdgeRevisionIds === undefined ? {} : { selectedEdgeRevisionIds }), ...(parentSha === undefined ? {} : { parentSha }) };
}

export function histosGetArtifactRequest(value) {
  const query = histosQuery(value);
  const sha256 = histosString(value?.sha256 ?? value?.hash, "artifact sha256", 64);
  return query && sha256 && HISTOS_SHA256.test(sha256) ? { ...query, sha256 } : null;
}

const HISTOS_TRIPLE_FIELDS = ["subject", "predicate", "object", "source", "scope", "tag"];
const HISTOS_TRIPLE_PREDICATE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_HISTOS_FACT_TRIPLES = 256;
const MAX_HISTOS_FACT_OBJECT = 4096;

function histosFactTriple(value) {
  if (!isPlainObject(value)) return null;
  const subject = histosString(value.subject, "subject", 512);
  if (!subject || /[^A-Za-z0-9_:./-]/.test(subject)) return null;
  const predicate = histosString(value.predicate, "predicate", 64);
  if (!predicate || !HISTOS_TRIPLE_PREDICATE_RE.test(predicate)) return null;
  const object = histosString(value.object, "object", MAX_HISTOS_FACT_OBJECT);
  if (!object) return null;
  const source = histosString(value.source, "source", 256) ?? "renderer:unknown";
  const out = { subject, predicate, object, source };
  if (typeof value.scope === "string" && value.scope.length > 0 && value.scope.length <= 128) out.scope = value.scope;
  if (typeof value.tag === "string" && value.tag.length > 0 && value.tag.length <= 128) out.tag = value.tag;
  if (typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1) out.confidence = value.confidence;
  if (typeof value.validFrom === "number" && Number.isFinite(value.validFrom)) out.validFrom = value.validFrom;
  if (typeof value.validUntil === "number" && Number.isFinite(value.validUntil)) out.validUntil = value.validUntil;
  for (const field of HISTOS_TRIPLE_FIELDS) {
    if (out[field] === undefined) delete out[field];
  }
  return out;
}

export function histosQueryFactsRequest(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) return null;
  const out = {};
  if (typeof value.subject === "string") out.subject = value.subject.slice(0, 512);
  if (typeof value.predicate === "string") out.predicate = value.predicate.slice(0, 64);
  if (typeof value.object === "string") out.object = value.object.slice(0, MAX_HISTOS_FACT_OBJECT);
  if (typeof value.scope === "string") out.scope = value.scope.slice(0, 128);
  if (typeof value.tag === "string") out.tag = value.tag.slice(0, 128);
  if (typeof value.asOf === "number" && Number.isFinite(value.asOf)) out.asOf = value.asOf;
  if (value.limit !== undefined) {
    if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 1000) return null;
    out.limit = value.limit;
  }
  return out;
}

export function histosWriteFactsRequest(value) {
  if (!isPlainObject(value) || !Array.isArray(value.triples)) return null;
  if (value.triples.length === 0 || value.triples.length > MAX_HISTOS_FACT_TRIPLES) return null;
  const triples = value.triples.map(histosFactTriple);
  if (triples.some((triple) => triple === null)) return null;
  return { triples };
}

// P0 traceability channels: archive (tombstone) / restore (revoke tombstone)
// / purge (physical erase). target_kind is the schema closed set; reason is
// the user-supplied deletion rationale (<= 512 chars, optional).
const HISTOS_TOMBSTONE_KINDS = new Set(["triple", "node", "edge", "artifact", "session_index"]);
const MAX_HISTOS_TOMBSTONE_IDS = 512;
const MAX_HISTOS_TOMBSTONE_REASON = 512;

function histosTombstoneReason(value) {
  if (value === undefined || value === null) return null;
  return histosString(value, "reason", MAX_HISTOS_TOMBSTONE_REASON);
}

export function histosArchiveRequest(value) {
  if (!isPlainObject(value)) return null;
  const kind = histosString(value.kind, "kind", 16);
  if (!kind || !HISTOS_TOMBSTONE_KINDS.has(kind)) return null;
  if (!Array.isArray(value.ids) || value.ids.length === 0 || value.ids.length > MAX_HISTOS_TOMBSTONE_IDS) return null;
  const ids = value.ids.map((id) => histosString(id, "id", 512));
  if (ids.some((id) => id === null)) return null;
  const reason = histosTombstoneReason(value.reason);
  if (value.reason !== undefined && value.reason !== null && reason === null) return null;
  return { kind, ids, ...(reason ? { reason } : {}) };
}

export function histosRestoreRequest(value) {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.tombstoneIds) || value.tombstoneIds.length === 0 || value.tombstoneIds.length > MAX_HISTOS_TOMBSTONE_IDS) return null;
  const tombstoneIds = value.tombstoneIds.map((id) => histosString(id, "tombstoneId", 64));
  if (tombstoneIds.some((id) => id === null)) return null;
  return { tombstoneIds };
}

export function histosPurgeRequest(value) {
  return histosArchiveRequest(value);
}

export function histosListTombstonesRequest(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) return null;
  const limit = value.limit === undefined ? undefined : value.limit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) return null;
  const includeRevoked = value.includeRevoked === undefined ? undefined : value.includeRevoked;
  if (includeRevoked !== undefined && typeof includeRevoked !== "boolean") return null;
  return { ...(limit !== undefined ? { limit } : {}), ...(includeRevoked !== undefined ? { includeRevoked } : {}) };
}

// P4 repo source: the renderer may only pass scan limits. The repository
// root is resolved by Main from the active authorized workspace — the
// renderer never supplies a path.
export function histosIndexRepoRequest(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) return null;
  const out = {};
  if (value.maxFiles !== undefined) {
    if (!Number.isSafeInteger(value.maxFiles) || value.maxFiles < 1 || value.maxFiles > 4000) return null;
    out.maxFiles = value.maxFiles;
  }
  if (value.maxDepth !== undefined) {
    if (!Number.isSafeInteger(value.maxDepth) || value.maxDepth < 1 || value.maxDepth > 12) return null;
    out.maxDepth = value.maxDepth;
  }
  return out;
}

export function histosFactAddress(value) {
  return histosAddress(value);
}
