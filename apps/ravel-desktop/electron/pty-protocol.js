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
export const MAX_PTY_ID_LENGTH = 128;
export const MAX_PTY_WRITE_BYTES = 64 * 1024;
export const MAX_PTY_OUTPUT_BYTES = 64 * 1024;
export const MAX_PTY_SESSIONS = 8;
export const MAX_PTY_ARGS = 128;
export const MAX_PTY_ARG_LENGTH = 4096;
export const MAX_PTY_FILE_LENGTH = 4096;
export const MAX_PTY_CWD_LENGTH = 4096;
export const MAX_PTY_ERROR_LENGTH = 16_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function boundedString(value, maximum, allowEmpty = false) {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maximum && !CONTROL_CHARS.test(value);
}

export function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

export function isPtyDimensions(value) {
  return value !== null && typeof value === "object" &&
    Number.isInteger(value.cols) && value.cols >= 1 && value.cols <= 500 &&
    Number.isInteger(value.rows) && value.rows >= 1 && value.rows <= 300;
}

export function isPtySessionId(value) {
  return boundedString(value, MAX_PTY_ID_LENGTH);
}

export function isPtySpawnArgs(value) {
  return value !== null && typeof value === "object" &&
    boundedString(value.file, MAX_PTY_FILE_LENGTH) &&
    Array.isArray(value.args) && value.args.length <= MAX_PTY_ARGS &&
    value.args.every((arg) => boundedString(arg, MAX_PTY_ARG_LENGTH, true)) &&
    (value.cwd === undefined || boundedString(value.cwd, MAX_PTY_CWD_LENGTH)) &&
    (value.cols === undefined || (Number.isInteger(value.cols) && value.cols >= 1 && value.cols <= 500)) &&
    (value.rows === undefined || (Number.isInteger(value.rows) && value.rows >= 1 && value.rows <= 300));
}

export function isPtyRequestArgs(method, args = {}) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return false;
  if (method === "spawn") return isPtySessionId(args.sessionId) && isPtySpawnArgs(args);
  if (method === "write") return isPtySessionId(args.sessionId) && typeof args.data === "string" && byteLength(args.data) <= MAX_PTY_WRITE_BYTES;
  if (method === "resize") return isPtySessionId(args.sessionId) && isPtyDimensions(args);
  if (method === "kill") return isPtySessionId(args.sessionId);
  return method === "init" || method === "dispose";
}

function chunkUtf8(value, maximum = MAX_PTY_OUTPUT_BYTES) {
  const chunks = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + maximum);
    while (end > start && byteLength(value.slice(start, end)) > maximum) end -= 1;
    if (end === start) end += 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

export function chunkPtyOutput(value) {
  if (typeof value !== "string") throw new TypeError("PTY output must be a string");
  return chunkUtf8(value);
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
    boundedString(value.id, MAX_PTY_ID_LENGTH) && isPtyMethod(value.method) &&
    isGeneration(value.generation) &&
    (value.args === undefined || isPtyRequestArgs(value.method, value.args)),
  );
}

export function isPtyResponse(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "pty:resp" &&
    boundedString(value.id, MAX_PTY_ID_LENGTH) && isGeneration(value.generation) &&
    (value.error === undefined || (typeof value.error === "string" && value.error.length <= MAX_PTY_ERROR_LENGTH)),
  );
}

export function isPtyOutputEvent(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "pty:data" &&
    boundedString(value.sessionId, MAX_PTY_ID_LENGTH) &&
    typeof value.chunk === "string" && byteLength(value.chunk) <= MAX_PTY_OUTPUT_BYTES &&
    Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
    typeof value.isFinal === "boolean",
  );
}

export function isPtyExitEvent(value) {
  return Boolean(
    value && typeof value === "object" && value.type === "pty:exit" &&
    boundedString(value.sessionId, MAX_PTY_ID_LENGTH) &&
    (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
    (value.signal === null || Number.isSafeInteger(value.signal)),
  );
}

export function sanitizePtyOutputDTO(sessionId, chunk, sequence, isFinal = false) {
  if (!boundedString(sessionId, MAX_PTY_ID_LENGTH) || typeof chunk !== "string" || !Number.isSafeInteger(sequence) || byteLength(chunk) > MAX_PTY_OUTPUT_BYTES) {
    throw new TypeError("Invalid PTY output event shape");
  }
  return {
    sessionId,
    chunk,
    sequence,
    isFinal: Boolean(isFinal),
  };
}

export function createPtyRequest(id, generation, method, args) {
  if (!boundedString(id, MAX_PTY_ID_LENGTH) || !isGeneration(generation) || !isPtyMethod(method)) {
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
    error: String(error).slice(0, MAX_PTY_ERROR_LENGTH),
    ...(code ? { code: String(code).slice(0, 128) } : {}),
  };
}
