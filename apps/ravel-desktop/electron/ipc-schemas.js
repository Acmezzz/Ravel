const MAX = Object.freeze({ sessionId: 128, workspace: 4096, path: 4096 });

export function boundedString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
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
  return typeof value === "string" && value.length > 0 && value.length <= max && !HISTOS_CONTROL.test(value) ? value : null;
}

function histosJson(value, label, depth = 0, count = { value: 0 }) {
  count.value += 1;
  if (depth > HISTOS_MAX_DEPTH || count.value > HISTOS_MAX_ITEMS) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length <= HISTOS_MAX_ID && !HISTOS_CONTROL.test(value) ? value : null;
  if (Array.isArray(value)) {
    const items = value.map((item) => histosJson(item, label, depth + 1, count));
    return items.every((item) => item !== null || value.some((original) => original === null)) ? items : null;
  }
  const object = histosPlainObject(value, label);
  if (!object) return null;
  const result = {};
  for (const [key, item] of Object.entries(object)) {
    if (!histosString(key, `${label} key`, 256)) return null;
    const normalized = histosJson(item, `${label}.${key}`, depth + 1, count);
    if (normalized === null && item !== null) return null;
    result[key] = normalized;
  }
  return result;
}

function histosSourceSet(value) {
  const normalized = histosJson(value, "sourceSet");
  return histosPlainObject(normalized, "sourceSet") ? normalized : null;
}

function histosQuery(value) {
  const object = histosPlainObject(value, "Histos query");
  if (!object) return null;
  const sourceSet = histosSourceSet(object.sourceSet);
  if (!sourceSet || typeof object.lens !== "string" || !HISTOS_LENSES.has(object.lens) || typeof object.granularity !== "string" || !HISTOS_GRANULARITIES.has(object.granularity)) return null;
  return { sourceSet, lens: object.lens, granularity: object.granularity };
}

function histosAddress(value) {
  const object = histosPlainObject(value, "FactAddress");
  if (!object || typeof object.sourceType !== "string" || !HISTOS_SOURCE_TYPES.has(object.sourceType)) return null;
  const objectId = histosString(object.objectId, "FactAddress.objectId");
  const revisionId = histosString(object.revisionId, "FactAddress.revisionId");
  if (!objectId || !revisionId) return null;
  if (object.sourceType === "file") {
    const relative = objectId.includes("/") ? objectId.slice(objectId.indexOf("/") + 1) : objectId;
    if (relative.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relative) || relative.split(/[\\/]/).includes("..")) return null;
  }
  if (["graph_revision", "flow_revision", "context_set"].includes(object.sourceType) && !HISTOS_SHA256.test(revisionId)) return null;
  const selector = object.selector;
  if (selector === undefined) return { sourceType: object.sourceType, objectId, revisionId };
  const selectorObject = histosPlainObject(selector, "FactAddress.selector");
  if (!selectorObject || typeof selectorObject.kind !== "string" || !HISTOS_SELECTOR_KINDS.has(selectorObject.kind)) return null;
  if (selectorObject.kind === "span" && Number.isSafeInteger(selectorObject.start) && selectorObject.start >= 0 && Number.isSafeInteger(selectorObject.length) && selectorObject.length >= 1) {
    return { sourceType: object.sourceType, objectId, revisionId, selector: { kind: "span", start: selectorObject.start, length: selectorObject.length } };
  }
  if (selectorObject.kind === "hunk" && Number.isSafeInteger(selectorObject.startLine) && selectorObject.startLine >= 1 && Number.isSafeInteger(selectorObject.endLine) && selectorObject.endLine >= selectorObject.startLine) {
    return { sourceType: object.sourceType, objectId, revisionId, selector: { kind: "hunk", startLine: selectorObject.startLine, endLine: selectorObject.endLine } };
  }
  if (selectorObject.kind === "json_path" && histosString(selectorObject.path, "FactAddress.selector.path", 16_384) && (selectorObject.path.startsWith("$") || selectorObject.path.startsWith("."))) {
    return { sourceType: object.sourceType, objectId, revisionId, selector: { kind: "json_path", path: selectorObject.path } };
  }
  const selectorId = `${selectorObject.kind}RevisionId`;
  if ((selectorObject.kind === "node" || selectorObject.kind === "edge") && histosString(selectorObject[selectorId], `FactAddress.selector.${selectorId}`)) {
    return { sourceType: object.sourceType, objectId, revisionId, selector: { kind: selectorObject.kind, [selectorId]: selectorObject[selectorId] } };
  }
  return null;
}

function histosSelection(value) {
  if (typeof value === "string") return histosString(value, "selection item", 512);
  const object = histosPlainObject(value, "selection item");
  if (!object) return null;
  const keys = ["nodeRevisionId", "edgeRevisionId", "id"].filter((key) => typeof object[key] === "string");
  if (keys.length !== 1 || Object.keys(object).some((key) => !["nodeRevisionId", "edgeRevisionId", "id"].includes(key))) return null;
  return { [keys[0]]: histosString(object[keys[0]], `selection.${keys[0]}`, 512) };
}

/** Normalize a Histos graph query without exposing filesystem or database paths. */
export function histosQueryRequest(value) {
  return histosQuery(value);
}

export function histosGetGraphRequest(value) {
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
  return targetSessionId === null ? null : { ...query, selection, ...(targetSessionId === undefined ? {} : { targetSessionId }) };
}

export function histosGetArtifactRequest(value) {
  const query = histosQuery(value);
  const sha256 = histosString(value?.sha256 ?? value?.hash, "artifact sha256", 64);
  return query && sha256 && HISTOS_SHA256.test(sha256) ? { ...query, sha256 } : null;
}

export function histosFactAddress(value) {
  return histosAddress(value);
}
