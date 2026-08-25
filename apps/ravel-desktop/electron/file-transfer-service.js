import { createHash } from "node:crypto";
import { copyFileSync as copyFile, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, extname } from "node:path";
import { resolveForCreate, resolveExisting, isInside } from "./path-security.js";

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_TOKEN_CACHE = 128;
const tokenCache = new Map();

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function hashFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function tokenFor(path, info, hash) { return `${path}:${info.size}:${info.mtimeMs}:${hash}`; }
function targetInfo(root, relativePath) {
  const created = resolveForCreate(root, relativePath);
  if (!existsSync(created.path)) return { ...created, exists: false, relativePath: created.relative };
  const existing = resolveExisting(root, relativePath);
  const info = statSync(existing.path);
  const hash = hashFile(existing.path);
  const token = tokenFor(existing.path, info, hash);
  if (tokenCache.has(token)) tokenCache.delete(token);
  tokenCache.set(token, { path: existing.path, size: info.size, mtimeMs: info.mtimeMs, hash });
  while (tokenCache.size > MAX_TOKEN_CACHE) {
    const oldest = tokenCache.keys().next().value;
    tokenCache.delete(oldest);
  }
  return { ...created, exists: true, relativePath: existing.relative, size: info.size, mtimeMs: info.mtimeMs, hash, token };
}

export function inspectTarget(root, relativePath) {
  const result = targetInfo(root, relativePath);
  return { path: result.relativePath, exists: result.exists, size: result.size ?? 0, mtimeMs: result.mtimeMs ?? null, hash: result.hash ?? null, token: result.token ?? null };
}

export function chooseKeepBothPath(root, relativePath) {
  const ext = extname(relativePath);
  const base = relativePath.slice(0, relativePath.length - ext.length);
  for (let index = 1; index <= 1000; index += 1) {
    const candidate = `${base} (${index})${ext}`;
    if (!targetInfo(root, candidate).exists) return candidate;
  }
  fail("upload_conflict", "无法生成不覆盖的文件名");
}

export function uploadFile(root, sourcePath, relativePath, { conflict = "cancel", expectedToken } = {}) {
  const source = statSync(sourcePath);
  if (!source.isFile()) fail("invalid_upload_source", "源路径不是文件");
  if (source.size > MAX_UPLOAD_BYTES) fail("upload_too_large", "文件超过上传大小限制");
  let target = targetInfo(root, relativePath);
  if (target.exists) {
    if (expectedToken && expectedToken !== target.token) fail("upload_conflict", "目标文件在上传前已变化");
    if (conflict === "cancel") return { conflict: true, target: inspectTarget(root, relativePath) };
    if (conflict === "keep-both") {
      relativePath = chooseKeepBothPath(root, relativePath);
      target = targetInfo(root, relativePath);
    } else if (conflict !== "overwrite") fail("invalid_args", "未知冲突策略");
  }
  const created = resolveForCreate(root, relativePath);
  if (!isInside(created.root, created.parent)) fail("path_escape", "目标目录越界");
  mkdirSync(dirname(created.path), { recursive: true });
  const temp = `${created.path}.upload-${process.pid}-${Date.now()}`;
  try {
    copyFile(sourcePath, temp);
    renameSync(temp, created.path);
    const written = resolveExisting(root, created.relative);
    if (!isInside(created.root, written.path)) fail("path_escape", "写入后路径越界");
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
  const result = statSync(created.path);
  return { conflict: false, path: created.relative, size: result.size, hash: hashFile(created.path) };
}
