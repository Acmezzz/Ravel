const MAX_ID = 128;
const MAX_METHOD = 128;
const MAX_ERROR = 16_000;

export function isWorkerInit(value) {
  return Boolean(value && typeof value === "object" && value.type === "init" && typeof value.cwd === "string" && value.cwd.length > 0 && value.cwd.length <= 4096 && typeof value.extensionsRoot === "string" && Number.isInteger(value.generation) && value.generation >= 0);
}

export function isWorkerRequest(value) {
  return Boolean(value && typeof value === "object" && value.type === "req" && typeof value.id === "string" && value.id.length > 0 && value.id.length <= MAX_ID && typeof value.method === "string" && value.method.length > 0 && value.method.length <= MAX_METHOD && Number.isInteger(value.generation) && value.generation >= 0 && (!value.args || typeof value.args === "object"));
}

export function isWorkerResponse(value) {
  return Boolean(value && typeof value === "object" && value.type === "resp" && typeof value.id === "string" && value.id.length > 0 && value.id.length <= MAX_ID && (value.data === undefined || value.data === null || typeof value.data === "object") && (value.error === undefined || (typeof value.error === "string" && value.error.length <= MAX_ERROR)));
}

/**
 * Strict identity validation for worker-originated stream envelopes. Every
 * app-event/settled must carry a fully typed meta so the renderer can order
 * and attribute events without guessing.
 */
function isEventMeta(meta) {
  if (!meta || typeof meta !== "object") return false;
  if (typeof meta.sessionId !== "string" || meta.sessionId.length === 0) return false;
  if (meta.runId !== null && typeof meta.runId !== "string") return false;
  if (meta.clientMessageId !== null && typeof meta.clientMessageId !== "string") return false;
  if (!Number.isInteger(meta.generation) || meta.generation < 0) return false;
  if (!Number.isInteger(meta.runtimeEpoch) || meta.runtimeEpoch < 0) return false;
  if (!Number.isInteger(meta.sequence) || meta.sequence <= 0) return false;
  return true;
}

export function isWorkerEvent(value) {
  if (!value || typeof value !== "object") return false;
  if (!["app-event", "settled", "extension-ui-request"].includes(value.type)) return false;
  if (value.type === "extension-ui-request") {
    return value.meta === undefined || (value.meta !== null && typeof value.meta === "object");
  }
  return isEventMeta(value.meta);
}
