import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class PathSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PathSecurityError";
    this.code = code;
  }
}

function normalized(value) {
  const text = resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

export function isInside(root, candidate) {
  const rootValue = normalized(root);
  const candidateValue = normalized(candidate);
  return candidateValue === rootValue || candidateValue.startsWith(`${rootValue}${sep}`) || candidateValue.startsWith(`${rootValue}/`);
}

export function realRoot(root) {
  if (typeof root !== "string" || !root.trim()) {
    throw new PathSecurityError("invalid_root", "Workspace root is required");
  }
  try {
    const resolved = realpathSync.native(resolve(root));
    if (!lstatSync(resolved).isDirectory()) throw new Error("not a directory");
    return resolved;
  } catch {
    throw new PathSecurityError("invalid_root", "Workspace root is unavailable");
  }
}

function relativePath(relPath) {
  if (typeof relPath !== "string") {
    throw new PathSecurityError("invalid_path", "Relative path is required");
  }
  const value = relPath.replace(/\\/g, "/");
  if (!value || value === ".") return ".";
  if (isAbsolute(value) || value.startsWith("/") || /^[a-zA-Z]:\//.test(value)) {
    throw new PathSecurityError("path_escape", "Absolute paths are not allowed");
  }
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) {
    throw new PathSecurityError("path_escape", "Parent path segments are not allowed");
  }
  return parts.join("/") || ".";
}

export function resolveExisting(root, relPath) {
  const safeRoot = realRoot(root);
  const safeRel = relativePath(relPath);
  const lexical = resolve(safeRoot, safeRel);
  if (!isInside(safeRoot, lexical)) throw new PathSecurityError("path_escape", "Path escapes the workspace root");
  let actual;
  try {
    actual = realpathSync.native(lexical);
  } catch {
    throw new PathSecurityError("not_found", "Path does not exist");
  }
  if (!isInside(safeRoot, actual)) throw new PathSecurityError("path_escape", "Resolved path escapes the workspace root");
  return { root: safeRoot, path: actual, relative: relative(safeRoot, actual).replace(/\\/g, "/") };
}

export function resolveForCreate(root, relPath) {
  const safeRoot = realRoot(root);
  const safeRel = relativePath(relPath);
  const lexical = resolve(safeRoot, safeRel);
  if (!isInside(safeRoot, lexical)) throw new PathSecurityError("path_escape", "Path escapes the workspace root");
  let cursor = lexical;
  while (!existsSync(cursor) && cursor !== safeRoot) cursor = dirname(cursor);
  let actual;
  try {
    actual = realpathSync.native(cursor);
  } catch {
    throw new PathSecurityError("invalid_path", "Parent path is unavailable");
  }
  if (!isInside(safeRoot, actual)) throw new PathSecurityError("path_escape", "Resolved parent escapes the workspace root");
  return { root: safeRoot, path: lexical, parent: actual, relative: safeRel === "." ? "" : safeRel };
}
