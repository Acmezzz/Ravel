/**
 * Remote skill registry (next-cycle B6; design ported from kilocode/opencode
 * skill discovery and omp's namespace discipline, MIT).
 *
 * A registry is a single https index.json listing single-file skills:
 *   { "skills": [ { "name": "...", "description": "...", "url": "https://..." } ] }
 * A bare array is accepted too. Fetching is read-only; downloading stages
 * each entry through the SAME sha256-keyed staging the single-URL flow uses,
 * and installation goes through the existing human-reviewed
 * installLocalResource gate. Nothing is ever executed.
 *
 * Per-entry failure is non-blocking: one broken entry never stops the others.
 * Pure parts (parsing, concurrency pool) are exported separately so tests run
 * without net access.
 */
import { validateRemoteResourceUrl, stageRemoteResource } from "./remote-resource-service.js";

export const MAX_REGISTRY_ENTRIES = 64;
export const MAX_REGISTRY_INDEX_BYTES = 1024 * 1024;
export const REGISTRY_FETCH_TIMEOUT_MS = 30_000;
const REGISTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

/**
 * Parse + normalize a registry index. Invalid entries are dropped (never
 * evaluated), duplicates by name keep the first occurrence, and the list is
 * capped at MAX_REGISTRY_ENTRIES.
 */
export function parseRegistryIndex(rawText, { maxEntries = MAX_REGISTRY_ENTRIES } = {}) {
  if (typeof rawText !== "string" || !rawText.trim()) throw invalid("registry index is empty");
  let value;
  try {
    value = JSON.parse(rawText);
  } catch {
    throw invalid("registry index is not valid JSON");
  }
  const list = Array.isArray(value) ? value : Array.isArray(value?.skills) ? value.skills : null;
  if (!list) throw invalid('registry index must be an array or {"skills": [...]}');
  const seen = new Set();
  const entries = [];
  for (const item of list) {
    if (entries.length >= maxEntries) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim().slice(0, 512) : "";
    if (!name || name.length > 64 || !REGISTRY_NAME.test(name) || seen.has(name)) continue;
    try {
      validateRemoteResourceUrl(url);
    } catch {
      continue;
    }
    seen.add(name);
    entries.push({ name, url, ...(description ? { description } : {}) });
  }
  return entries;
}

/** Bounded-concurrency map preserving input order. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Fetch + parse the index. fetchImpl injectable for tests. */
export async function fetchRegistryIndex(indexUrl, { fetchImpl = fetch } = {}) {
  const safeUrl = validateRemoteResourceUrl(indexUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(safeUrl, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    throw Object.assign(new Error(`registry index download failed: ${error instanceof Error ? error.message : String(error)}`), { code: "fetch_failed" });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw Object.assign(new Error(`registry index download failed: HTTP ${response.status}`), { code: "fetch_failed" });
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_REGISTRY_INDEX_BYTES) {
    throw Object.assign(new Error("registry index exceeds the 1MB cap"), { code: "too_large" });
  }
  return parseRegistryIndex(Buffer.from(buffer).toString("utf8"));
}

/**
 * Download the selected entries concurrently into the shared staging root
 * (sha256-keyed, round-trip verified by stageRemoteResource). Returns one
 * result per requested entry: staged { name, filename, path, sha256, bytes }
 * or { name, error } — partial success is the caller's decision to show.
 */
export async function downloadRegistryEntries(entries, stagingRoot, { fetchImpl = fetch, concurrency = 4 } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const capped = entries.slice(0, MAX_REGISTRY_ENTRIES);
  return mapWithConcurrency(capped, concurrency, async (entry) => {
    try {
      const staged = await stageRemoteResource(entry.url, stagingRoot, { fetchImpl });
      return { name: entry.name, filename: staged.filename, path: staged.path, sha256: staged.sha256, bytes: staged.bytes };
    } catch (error) {
      return { name: entry.name, error: error instanceof Error ? error.message : String(error), code: error?.code ?? "fetch_failed" };
    }
  });
}
