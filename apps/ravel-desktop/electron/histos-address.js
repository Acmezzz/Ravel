import { createHash } from "node:crypto";

export const FACT_SOURCE_TYPES = Object.freeze([
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

const SOURCE_TYPES = new Set(FACT_SOURCE_TYPES);
const SELECTOR_KINDS = new Set(["span", "hunk", "json_path", "node", "edge"]);
const MAX_ID_LENGTH = 4096;
const MAX_SELECTOR_PATH_LENGTH = 16_384;
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function invalid(message) {
  throw Object.assign(new TypeError(`Invalid FactAddress: ${message}`), { code: "invalid_args" });
}

function plain(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${label} must be a plain object`);
  return value;
}

function bounded(value, label, max = MAX_ID_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL.test(value)) {
    invalid(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`${label} contains unknown field ${key}`);
}

function integer(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(`${label} must be a safe integer >= ${minimum}`);
  return value;
}

function validateSelector(selector) {
  if (selector === undefined) return undefined;
  plain(selector, "selector");
  const kind = bounded(selector.kind, "selector.kind", 32);
  if (!SELECTOR_KINDS.has(kind)) invalid(`unsupported selector kind ${kind}`);
  if (kind === "span") {
    exactKeys(selector, new Set(["kind", "start", "length"]), "selector");
    return { kind, start: integer(selector.start, "selector.start", 0), length: integer(selector.length, "selector.length", 1) };
  }
  if (kind === "hunk") {
    exactKeys(selector, new Set(["kind", "startLine", "endLine"]), "selector");
    const startLine = integer(selector.startLine, "selector.startLine", 1);
    return { kind, startLine, endLine: integer(selector.endLine, "selector.endLine", startLine) };
  }
  if (kind === "json_path") {
    exactKeys(selector, new Set(["kind", "path"]), "selector");
    const path = bounded(selector.path, "selector.path", MAX_SELECTOR_PATH_LENGTH);
    if (!path.startsWith("$") && !path.startsWith(".")) invalid("selector.path must be a JSON path");
    return { kind, path };
  }
  const field = `${kind}RevisionId`;
  exactKeys(selector, new Set(["kind", field]), "selector");
  return { kind, [field]: bounded(selector[field], `selector.${field}`) };
}

function validateFileObjectId(objectId) {
  const normalized = objectId.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    invalid("file objectId must be workspace-relative");
  }
}

/** Validate and normalize a structured, versioned FactAddress. */
export function normalizeFactAddress(address) {
  plain(address, "FactAddress");
  exactKeys(address, new Set(["sourceType", "objectId", "revisionId", "selector"]), "FactAddress");
  const sourceType = bounded(address.sourceType, "sourceType", 64);
  if (!SOURCE_TYPES.has(sourceType)) invalid(`unsupported sourceType ${sourceType}`);
  const objectId = bounded(address.objectId, "objectId");
  const revisionId = bounded(address.revisionId, "revisionId");
  if (sourceType === "file") validateFileObjectId(objectId.includes("/") ? objectId.slice(objectId.indexOf("/") + 1) : objectId);
  if (sourceType === "checkpoint" && !SHA1.test(revisionId)) invalid("checkpoint revisionId must be a Git SHA");
  if (["graph_revision", "flow_revision", "context_set"].includes(sourceType) && !SHA256.test(revisionId)) invalid(`${sourceType} revisionId must be a SHA-256`);
  const selector = validateSelector(address.selector);
  return selector === undefined ? { sourceType, objectId, revisionId } : { sourceType, objectId, revisionId, selector };
}

function canonicalValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("FactAddress contains a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") invalid("FactAddress contains a non-JSON value");
  if (ancestors.has(value)) invalid("FactAddress contains a cycle");
  ancestors.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonicalValue(item, ancestors)).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key], ancestors)}`).join(",")}}`;
  ancestors.delete(value);
  return result;
}

export function canonicalJson(value) {
  return canonicalValue(value);
}

export function canonicalFactAddress(address) {
  return canonicalJson(normalizeFactAddress(address));
}

export function addressIdForFactAddress(address) {
  return createHash("sha256").update(canonicalFactAddress(address), "utf8").digest("hex");
}

export const validateFactAddress = normalizeFactAddress;
export const addressIdOf = addressIdForFactAddress;
export const factAddressId = addressIdForFactAddress;

function objectParts(objectId) {
  const slash = objectId.indexOf("/");
  return slash > 0 && slash < objectId.length - 1 ? [objectId.slice(0, slash), objectId.slice(slash + 1)] : null;
}

export function formatFactAddress(address) {
  const value = normalizeFactAddress(address);
  const parts = objectParts(value.objectId);
  const suffix = value.selector === undefined ? "" : value.selector.kind === "span"
    ? `#${value.selector.start}:${value.selector.length}`
    : value.selector.kind === "hunk"
      ? `#lines:${value.selector.startLine}-${value.selector.endLine}`
      : value.selector.kind === "json_path"
        ? `#${value.selector.path}`
        : `#${value.selector.kind}:${value.selector[`${value.selector.kind}RevisionId`]}`;
  let base;
  if (value.sourceType === "session_entry" || value.sourceType === "session_span") base = parts ? `session:${parts[0]}/entry:${parts[1]}` : `session:${value.objectId}`;
  else if (["operation", "tool", "approval"].includes(value.sourceType)) base = parts ? `session:${parts[0]}/${value.sourceType === "operation" ? "op" : value.sourceType}:${parts[1]}` : `${value.sourceType}:${value.objectId}`;
  else if (value.sourceType === "file") base = `ws:${value.objectId}`;
  else if (value.sourceType === "skill") base = `skill:${value.objectId}`;
  else if (value.sourceType === "checkpoint") base = `git:${value.objectId}`;
  else base = `histos:${value.objectId}/${value.sourceType}`;
  return `${base}@${value.revisionId}${suffix}`;
}

export const displayFactAddress = formatFactAddress;
