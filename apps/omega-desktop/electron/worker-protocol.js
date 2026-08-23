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

export function isWorkerEvent(value) {
  if (!value || typeof value !== "object") return false;
  if (!["app-event", "settled", "extension-ui-request"].includes(value.type)) return false;
  return value.meta === undefined || (value.meta !== null && typeof value.meta === "object");
}
