import { appendFileSync, createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { deriveActivityFromFacts } from "./session-facts.js";

const MAX_FILES = 2000;
const MAX_LINE_CHARS = 512 * 1024;
const MAX_FIRST_MESSAGE_CHARS = 240;
const MAX_CACHE_ENTRIES = 200;
const summaryCache = new Map();
const messageCache = new Map();

function rememberCache(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return value;
}

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
  rememberCache(summaryCache, cacheKey, { stamp: cacheStamp, summary });
  return summary;
}

const treeIndexCache = new Map();

/**
 * Fact-derived 动态 row for one session JSONL (restart reconciliation path).
 * Scans ravel_record custom entries only; cached by mtime+size so repeated
 * snapshots are cheap. Returns null when the session carries no facts.
 */
const activityCache = new Map();
export async function readSessionActivity(file) {
	let stats;
	try {
		stats = statSync(file);
	} catch {
		return null;
	}
	const key = resolve(file);
	const stamp = `${stats.mtimeMs}:${stats.size}`;
	const cached = activityCache.get(key);
	if (cached?.stamp === stamp) return cached.activity;
	const facts = [];
	try {
		const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
		for await (const rawLine of rl) {
			if (rawLine.length > MAX_LINE_CHARS) continue;
			if (!rawLine.includes("ravel_record")) continue;
			try {
				const entry = JSON.parse(rawLine);
				if (entry?.type === "custom" && entry.customType === "ravel_record" && entry.data?.type) facts.push(entry.data);
			} catch { /* skip malformed lines */ }
		}
	} catch {
		return null;
	}
	const activity = deriveActivityFromFacts(facts);
	rememberCache(activityCache, key, { stamp, activity });
	return activity;
}

function treeIndexOf(summaries) {
  const byParent = new Map();
  for (const summary of summaries) {
    if (!summary.parentSessionId) continue;
    const children = byParent.get(summary.parentSessionId) ?? [];
    children.push(summary.id);
    byParent.set(summary.parentSessionId, children);
  }
  return Object.fromEntries([...byParent.entries()]);
}

export function appendSessionInfo(file, name) {
  const resolved = resolve(file);
  const sanitized = String(name ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 256);
  if (!sanitized) throw new Error("name is required");
  statSync(resolved);
  const entry = {
    type: "session_info",
    id: `info-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    name: sanitized,
  };
  appendFileSync(resolved, `${JSON.stringify(entry)}\n`, "utf8");
  summaryCache.delete(resolved);
  messageCache.delete(resolved);
  return entry;
}

export async function readSessionMessages(file, { offset = 0, limit = 100 } = {}) {
  const resolved = resolve(file);
  let stats;
  try { stats = statSync(resolved); } catch { throw new Error("Session file not found"); }
  const stamp = `${stats.mtimeMs}:${stats.size}`;
  const cached = messageCache.get(resolved);
  let messages = cached?.stamp === stamp ? cached.messages : null;
  if (!messages) {
    messages = [];
    const rl = createInterface({ input: createReadStream(resolved, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const rawLine of rl) {
      if (rawLine.length > MAX_LINE_CHARS) continue;
      try {
        const entry = JSON.parse(rawLine);
        if (entry?.type !== "message" || !entry.message) continue;
        const message = entry.message;
        const text = textOf(message.content);
        if (!text && message.role !== "toolResult") continue;
        messages.push({ role: message.role === "toolResult" ? "tool" : message.role, id: message.id ?? entry.id, text, ts: entry.timestamp ?? new Date(stats.mtimeMs).toISOString(), entryId: entry.id });
      } catch { /* skip malformed lines */ }
    }
    rememberCache(messageCache, resolved, { stamp, messages });
  }
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 100;
  return { items: messages.slice(safeOffset, safeOffset + safeLimit), total: messages.length, nextOffset: safeOffset + safeLimit < messages.length ? safeOffset + safeLimit : null };
}

export async function readSessionSummaries(root, { allowedWorkspaces = [], offset = 0, limit = 100 } = {}) {
  if (!existsSync(root)) return { items: [], total: 0, nextOffset: null, treeIndex: {} };
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
  const stamp = `${files.length}:${summaries.map((item) => `${item.id}:${item.updatedAt}`).join("|")}`;
  const cachedTree = treeIndexCache.get(root);
  const treeIndex = cachedTree?.stamp === stamp ? cachedTree.index : treeIndexOf(summaries);
  if (cachedTree?.stamp !== stamp) rememberCache(treeIndexCache, root, { stamp, index: treeIndex });
  return {
    items: summaries.slice(safeOffset, safeOffset + safeLimit),
    total: summaries.length,
    nextOffset: safeOffset + safeLimit < summaries.length ? safeOffset + safeLimit : null,
    treeIndex,
  };
}
