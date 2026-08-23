import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const MAX_FILES = 2000;
const MAX_LINE_CHARS = 512 * 1024;
const MAX_FIRST_MESSAGE_CHARS = 240;
const summaryCache = new Map();

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join(" ");
}

function sessionFileList(root) {
  const files = [];
  const queue = [resolve(root)];
  while (queue.length && files.length < MAX_FILES) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
      if (files.length >= MAX_FILES) break;
    }
  }
  return files;
}

async function readSummary(file) {
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return null;
  }
  const cacheKey = resolve(file);
  const cacheStamp = `${stats.mtimeMs}:${stats.size}`;
  const cached = summaryCache.get(cacheKey);
  if (cached?.stamp === cacheStamp) return cached.summary;
  let header = null;
  let name;
  let messageCount = 0;
  let firstMessage = "";
  let lastTimestamp = "";
  try {
    const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const rawLine of rl) {
      if (rawLine.length > MAX_LINE_CHARS) continue;
      let entry;
      try {
        entry = JSON.parse(rawLine);
      } catch {
        continue;
      }
      if (!header) {
        if (entry?.type !== "session" || typeof entry.id !== "string" || typeof entry.cwd !== "string") return null;
        header = entry;
        lastTimestamp = entry.timestamp ?? "";
        continue;
      }
      if (typeof entry.timestamp === "string") lastTimestamp = entry.timestamp;
      if (entry.type === "session_info") {
        name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 256) : undefined;
      }
      if (entry.type === "message") {
        messageCount += 1;
        if (!firstMessage && entry.message?.role === "user") {
          firstMessage = textOf(entry.message.content).replace(/\s+/g, " ").trim().slice(0, MAX_FIRST_MESSAGE_CHARS);
        }
      }
    }
  } catch {
    return null;
  }
  if (!header) return null;
  const createdAt = typeof header.timestamp === "string" ? header.timestamp : stats.birthtime.toISOString();
  const updatedAt = typeof lastTimestamp === "string" && lastTimestamp ? lastTimestamp : stats.mtime.toISOString();
  const parent = typeof header.parentSession === "string" ? header.parentSession.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, "") : undefined;
  const summary = {
    id: header.id,
    title: name || firstMessage || "未命名会话",
    workspace: header.cwd,
    createdAt,
    updatedAt,
    status: "active",
    messageCount,
    ...(parent ? { parentSessionId: parent } : {}),
  };
  summaryCache.set(cacheKey, { stamp: cacheStamp, summary });
  return summary;
}

export async function readSessionSummaries(root, { allowedWorkspaces = [], offset = 0, limit = 100 } = {}) {
  if (!existsSync(root)) return { items: [], total: 0, nextOffset: null };
  const normalize = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  const allowed = new Set(allowedWorkspaces.map(normalize));
  const files = sessionFileList(root);
  const summaries = [];
  for (const file of files) {
    const summary = await readSummary(file);
    if (!summary) continue;
    if (allowed.size && !allowed.has(normalize(summary.workspace))) continue;
    summaries.push(summary);
  }
  summaries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 100;
  return { items: summaries.slice(safeOffset, safeOffset + safeLimit), total: summaries.length, nextOffset: safeOffset + safeLimit < summaries.length ? safeOffset + safeLimit : null };
}
