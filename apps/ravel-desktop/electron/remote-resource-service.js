/**
 * Remote resource staging — fetch a single-file skill/prompt/extension from an
 * https URL into a local staging dir so the existing local-path install flow
 * (human-reviewed, policy-gated) can take over. Archives and registry
 * catalogs are out of scope; add when a real registry needs them.
 *
 * Pure parts (URL/filename validation) are exported separately from the
 * network operation so tests run without net access.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const MAX_REMOTE_RESOURCE_BYTES = 8 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

export function validateRemoteResourceUrl(url) {
  if (typeof url !== "string" || !url.trim()) throw invalid("url is required");
  const trimmed = url.trim();
  if (trimmed.length > 2048) throw invalid("url must be at most 2048 characters");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid("url must be an absolute URL");
  }
  if (parsed.protocol !== "https:") throw invalid("only https URLs are accepted");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw invalid("localhost addresses are not accepted");
  }
  return trimmed;
}

export function remoteFilenameFromUrl(url) {
  const parsed = new URL(url);
  const base = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
  if (!base || !SAFE_FILENAME.test(base) || base.length > 255) {
    throw invalid("url must point at a single file with a simple name (letters, digits, . _ -)");
  }
  return base;
}

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

/**
 * Download into <stagingRoot>/<sha256>/<filename>. The sha is of the exact
 * bytes and becomes the staging key, so what the user reviews is what gets
 * installed. Returns { path, sha256, bytes, filename }.
 */
export async function stageRemoteResource(url, stagingRoot, { fetchImpl = fetch } = {}) {
  const safeUrl = validateRemoteResourceUrl(url);
  const filename = remoteFilenameFromUrl(safeUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(safeUrl, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    throw Object.assign(new Error(`下载失败：${error instanceof Error ? error.message : String(error)}`), { code: "fetch_failed" });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw Object.assign(new Error(`下载失败：HTTP ${response.status}`), { code: "fetch_failed" });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw invalid("远程资源为空");
  if (buffer.byteLength > MAX_REMOTE_RESOURCE_BYTES) {
    throw Object.assign(new Error(`远程资源超过 ${Math.floor(MAX_REMOTE_RESOURCE_BYTES / 1024 / 1024)}MB 上限`), { code: "too_large" });
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const dir = join(stagingRoot, sha256);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, buffer, { encoding: "utf8", mode: 0o600 });
  // Round-trip check: the staged bytes must hash to the same sha we show the user.
  const verify = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (verify !== sha256) throw Object.assign(new Error("暂存文件校验失败"), { code: "integrity_error" });
  return { path, sha256, bytes: buffer.byteLength, filename };
}
