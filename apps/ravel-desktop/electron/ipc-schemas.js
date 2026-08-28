const MAX = Object.freeze({ sessionId: 128, workspace: 4096, path: 4096, ptyData: 64 * 1024, ptyCwd: 4096 });
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

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
  return { sourceSet, lens, granularity };
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

export function histosFactAddress(value) {
  return histosAddress(value);
}
