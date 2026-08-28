/**
 * Private Histos process wire protocol. This envelope never crosses the
 * renderer boundary; it is only used by histos-host and histos-worker.
 */

export const HISTOS_METHODS = Object.freeze([
  "init",
  "getGraph",
  "condenseGraph",
  "saveViewState",
  "executeFlow",
  "rebuild",
  "getNode",
  "freezeContext",
  "convertToFlow",
  "getArtifact",
  "applySessionFacts",
  "dispose",
]);

const METHOD_SET = new Set(HISTOS_METHODS);
const MAX_ID = 128;
const MAX_ERROR = 16_000;

function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isHistosMethod(value) {
  return typeof value === "string" && METHOD_SET.has(value);
}

export function isHistosRequest(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "req" &&
    boundedString(value.id, MAX_ID) && isHistosMethod(value.method) &&
    isGeneration(value.generation) &&
    (value.args === undefined || (value.args !== null && typeof value.args === "object")),
  );
}

export function isHistosResponse(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "resp" &&
    boundedString(value.id, MAX_ID) && isGeneration(value.generation) &&
    (value.error === undefined || (typeof value.error === "string" && value.error.length <= MAX_ERROR)),
  );
}

export function isHistosInit(value) {
  return Boolean(value && typeof value === "object" && value.type === "init" && isGeneration(value.generation));
}

export function isHistosTransportMessage(value) {
  return isHistosResponse(value) || (value && typeof value === "object" && value.type === "error");
}

export function createHistosRequest(id, generation, method, args) {
  if (!boundedString(id, MAX_ID) || !isGeneration(generation) || !isHistosMethod(method)) {
    throw new TypeError("Invalid Histos request envelope");
  }
  return { type: "req", id, generation, method, args: args ?? {} };
}

export function createHistosResponse(id, generation, data) {
  return { type: "resp", id, generation, data: data === undefined ? null : data };
}

export function createHistosErrorResponse(id, generation, error, code) {
  return {
    type: "resp",
    id,
    generation,
    error: String(error).slice(0, MAX_ERROR),
    ...(code ? { code: String(code).slice(0, 128) } : {}),
  };
}
