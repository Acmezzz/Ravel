/**
 * Private PTY utility process wire protocol and sanitization boundaries.
 * Node-pty / child process handles never cross to the renderer.
 */

export const PTY_METHODS = Object.freeze([
  "init",
  "spawn",
  "write",
  "resize",
  "kill",
  "dispose",
]);

const METHOD_SET = new Set(PTY_METHODS);
const MAX_ID = 128;
const MAX_ERROR = 16_000;
const MAX_CHUNK_BYTES = 64 * 1024;

function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isPtyMethod(value) {
  return typeof value === "string" && METHOD_SET.has(value);
}

export function isPtyRequest(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "pty:req" &&
    boundedString(value.id, MAX_ID) && isPtyMethod(value.method) &&
    isGeneration(value.generation) &&
    (value.args === undefined || (value.args !== null && typeof value.args === "object")),
  );
}

export function isPtyResponse(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "pty:resp" &&
    boundedString(value.id, MAX_ID) && isGeneration(value.generation) &&
    (value.error === undefined || (typeof value.error === "string" && value.error.length <= MAX_ERROR)),
  );
}

export function isPtyOutputEvent(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "pty:data" &&
    boundedString(value.sessionId, MAX_ID) &&
    typeof value.chunk === "string" && value.chunk.length <= MAX_CHUNK_BYTES &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.isFinal === "boolean",
  );
}

export function sanitizePtyOutputDTO(sessionId, chunk, sequence, isFinal = false) {
  if (!boundedString(sessionId, MAX_ID) || typeof chunk !== "string" || !Number.isSafeInteger(sequence)) {
    throw new TypeError("Invalid PTY output event shape");
  }
  return {
    sessionId,
    chunk: chunk.slice(0, MAX_CHUNK_BYTES),
    sequence,
    isFinal: Boolean(isFinal),
  };
}

export function createPtyRequest(id, generation, method, args) {
  if (!boundedString(id, MAX_ID) || !isGeneration(generation) || !isPtyMethod(method)) {
    throw new TypeError("Invalid PTY request envelope");
  }
  return { type: "pty:req", id, generation, method, args: args ?? {} };
}

export function createPtyResponse(id, generation, data) {
  return { type: "pty:resp", id, generation, data: data === undefined ? null : data };
}

export function createPtyErrorResponse(id, generation, error, code) {
  return {
    type: "pty:resp",
    id,
    generation,
    error: String(error).slice(0, MAX_ERROR),
    ...(code ? { code: String(code).slice(0, 128) } : {}),
  };
}
