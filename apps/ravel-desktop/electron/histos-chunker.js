/**
 * UTF-8 byte-oriented derived spans. The source entry is never changed: these
 * chunks are selectors for an index, not replacement facts.
 */
import { Buffer } from "node:buffer";
import { normalizeFactAddress } from "./histos-address.js";

export const DEFAULT_CHUNK_MAX_BYTES = 16 * 1024;

function invalid(message) {
  throw new TypeError(`Invalid chunking input: ${message}`);
}

function maxBytesOf(value) {
  if (value === undefined) return DEFAULT_CHUNK_MAX_BYTES;
  if (typeof value === "number") return validateMaxBytes(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("options must be an object or maxBytes number");
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== "maxBytes") invalid(`unknown option ${JSON.stringify(key)}`);
  }
  return validateMaxBytes(value.maxBytes === undefined ? DEFAULT_CHUNK_MAX_BYTES : value.maxBytes);
}

function validateMaxBytes(value) {
  if (!Number.isSafeInteger(value) || value < 1) invalid("maxBytes must be a positive safe integer");
  return value;
}

/**
 * Split text into non-empty chunks whose `start` and `length` are UTF-8 byte
 * offsets. A Unicode code point is never split across chunks. The returned
 * `text` values concatenate exactly to the original input.
 */
export function chunkText(text, options) {
  if (typeof text !== "string") invalid("text must be a string");
  const maxBytes = maxBytesOf(options);
  if (text.length === 0) return [];

  const chunks = [];
  let chunkTextValue = "";
  let chunkStart = 0;
  let chunkLength = 0;
  let offset = 0;
  for (const codePoint of text) {
    const codePointLength = Buffer.byteLength(codePoint, "utf8");
    if (codePointLength > maxBytes) {
      invalid(`maxBytes ${maxBytes} is smaller than a UTF-8 code point (${codePointLength} bytes)`);
    }
    if (chunkLength > 0 && chunkLength + codePointLength > maxBytes) {
      chunks.push({ text: chunkTextValue, start: chunkStart, length: chunkLength });
      chunkTextValue = "";
      chunkStart = offset;
      chunkLength = 0;
    }
    chunkTextValue += codePoint;
    chunkLength += codePointLength;
    offset += codePointLength;
  }
  if (chunkLength > 0) chunks.push({ text: chunkTextValue, start: chunkStart, length: chunkLength });
  return chunks;
}

/** Explicitly named alias for callers that want the byte unit in the API. */
export const chunkUtf8Text = chunkText;
export const chunkTextUtf8 = chunkText;
export const chunkUtf8 = chunkText;

/**
 * Chunk a FactAddress's text and attach a session-span selector to each
 * derived index item. Existing selectors are rejected rather than silently
 * replacing provenance.
 */
export function chunkFactAddress(address, text, options) {
  const normalized = normalizeFactAddress(address);
  if (normalized.selector !== undefined) invalid("address must not already contain a selector");
  const chunks = chunkText(text, options);
  return chunks.map((chunk) => ({
    ...chunk,
    address: {
      sourceType: "session_span",
      objectId: normalized.objectId,
      revisionId: normalized.revisionId,
      selector: { kind: "span", start: chunk.start, length: chunk.length },
    },
  }));
}

export const chunkAddress = chunkFactAddress;
