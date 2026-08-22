/**
 * Session persistence — local JSON files under `<sessionsRoot>/`.
 *
 * V1 storage format (system_design.md §3.5):
 *   manifest.json        SessionSummary[]
 *   <sessionId>.json     SessionRecord (transcript + tool cards)
 *
 * All filesystem writes happen HERE (main process only). The renderer has no
 * filesystem access. The functions are pure with respect to `sessionsRoot`
 * (injected by main.js) so they remain testable without Electron.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {Object} SessionSummary
 * @property {string} id
 * @property {string} title
 * @property {string} [projectKey]
 * @property {string} workspace
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {"active"|"archived"} status
 */

/**
 * @typedef {Object} SessionRecord
 * @property {string} id
 * @property {string} title
 * @property {string} [projectKey]
 * @property {string} workspace
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {"active"|"archived"} status
 * @property {Array<{role:string,id:string,text:string,ts:string}>} messages
 * @property {Array<{toolCallId:string,toolName:string,status:string}>} [toolCards]
 */

function ensureDir(root) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function manifestPath(root) {
  return join(root, "manifest.json");
}

function readManifest(root) {
  const path = manifestPath(root);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifest(root, summaries) {
  ensureDir(root);
  const target = manifestPath(root);
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(summaries, null, "\t")}\n`);
  renameSync(temp, target);
}

function validId(id) {
  return typeof id === "string" && SESSION_ID_PATTERN.test(id);
}

function recordPath(root, id) {
  if (!validId(id)) throw new Error("invalid_session_id");
  const base = resolve(ensureDir(root));
  const target = resolve(base, `${id}.json`);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error("session_path_escape");
  return target;
}

function writeRecord(root, record) {
  const target = recordPath(root, record.id);
  const body = `${JSON.stringify(record, null, "\t")}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_RECORD_BYTES) throw new Error("session_record_too_large");
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, target);
}

/** List all sessions (most recently updated first). */
export function list(root) {
  const summaries = readManifest(ensureDir(root));
  return [...summaries].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** Create a new empty session and return its full record. */
export function create(root, req = {}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const record = {
    id,
    title: req.title?.trim() || "未命名会话",
    projectKey: req.projectKey,
    workspace: req.workspace || "",
    createdAt: now,
    updatedAt: now,
    status: "active",
    messages: [],
    toolCards: [],
  };
  writeRecord(root, record);
  const summaries = readManifest(root).filter((s) => s.id !== id);
  summaries.push({
    id: record.id,
    title: record.title,
    projectKey: record.projectKey,
    workspace: record.workspace,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
  });
  writeManifest(root, summaries);
  return record;
}

/** Load a full session record, or null when missing. */
export function load(root, id) {
  const path = recordPath(root, id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Persist (overwrite) a session record and refresh its manifest summary. */
export function save(root, record, expectedId) {
  if (!record || typeof record.id !== "string") {
    throw new Error("invalid_session_record");
  }
  if (expectedId && record.id !== expectedId) throw new Error("session_id_mismatch");
  if (!validId(record.id)) throw new Error("invalid_session_id");
  const now = new Date().toISOString();
  const enriched = { ...record, id: record.id, updatedAt: now };
  writeRecord(root, enriched);
  const summaries = readManifest(root).filter((s) => s.id !== enriched.id);
  summaries.push({
    id: enriched.id,
    title: enriched.title,
    projectKey: enriched.projectKey,
    workspace: enriched.workspace,
    createdAt: enriched.createdAt,
    updatedAt: enriched.updatedAt,
    status: enriched.status,
  });
  writeManifest(root, summaries);
  return enriched;
}

/** Delete a session (record + manifest entry). */
export function remove(root, id) {
  if (!validId(id)) throw new Error("invalid_session_id");
  const summaries = readManifest(root);
  if (!summaries.some((summary) => summary?.id === id)) return false;
  const path = recordPath(root, id);
  if (existsSync(path)) unlinkSync(path);
  writeManifest(root, summaries.filter((summary) => summary?.id !== id));
  return true;
}

export { validId };
