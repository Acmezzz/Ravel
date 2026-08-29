/**
 * Private Histos process wire protocol. This envelope never crosses the
 * renderer boundary; it is only used by histos-host and histos-worker.
 */

export const HISTOS_METHODS = Object.freeze([
  "init",
  "getGraph",
  "condenseGraph",
  "saveViewState",
  "getViewState",
  "executeFlow",
  "rebuild",
  "getNode",
  "freezeContext",
  "convertToFlow",
  "getArtifact",
  "applySessionFacts",
  "applyWebResources",
  "applyAgentActivity",
  "applyEvalResults",
  "listCapabilities",
  "invokeNode",
  "distillResource",
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

/**
 * Provider relay: the Histos worker has no model credentials of its own, so a
 * semantic condensation asks the host (Main) to run one bounded completion
 * through the agent worker's Pi model runtime. These envelopes are host↔worker
 * only and never cross the renderer boundary.
 */
const MAX_PROVIDER_PROMPT = 262_144;
const PROVIDER_DATA_LIMIT = 1_048_576;

export function isHistosProviderRequest(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "histos-provider" &&
    boundedString(value.reqId, MAX_ID) &&
    value.request !== null && typeof value.request === "object" && !Array.isArray(value.request) &&
    boundedString(value.request.prompt, MAX_PROVIDER_PROMPT) &&
    (value.request.maxTokens === undefined || (Number.isSafeInteger(value.request.maxTokens) && value.request.maxTokens >= 1 && value.request.maxTokens <= 8192)),
  );
}

export function isHistosProviderResult(value) {
  if (!(value && typeof value === "object" && value.type === "histos-provider-result" && boundedString(value.reqId, MAX_ID))) return false;
  if (typeof value.error === "string") return value.error.length > 0 && value.error.length <= MAX_ERROR;
  return value.error === undefined && value.data !== null && value.data !== undefined &&
    typeof value.data === "object" && boundedString(value.data.text, PROVIDER_DATA_LIMIT);
}

export function createHistosProviderResult(reqId, data, error, code) {
  if (error !== undefined) {
    return {
      type: "histos-provider-result",
      reqId,
      error: String(error).slice(0, MAX_ERROR),
      ...(code ? { code: String(code).slice(0, 128) } : {}),
    };
  }
  return { type: "histos-provider-result", reqId, data: data ?? null };
}
