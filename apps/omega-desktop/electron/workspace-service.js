/**
 * Workspace file access — main-process only, path-safe.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveExisting } from "./path-security.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "release", "target",
  ".next", ".nuxt", ".cache", ".turbo", "__pycache__", ".venv", "venv",
]);
const MAX_READ_BYTES = 512 * 1024;
const MAX_INDEX_FILES = 4000;
const MAX_INDEX_DEPTH = 10;

function resolveUnder(root, relPath) {
  try {
    return resolveExisting(root, relPath).path;
  } catch (error) {
    // Preserve a stable workspace boundary error for the IPC layer.
    if (error?.code === "path_escape") throw new Error("Path escapes the workspace root");
    throw error;
  }
}

export function listDir(root, relPath) {
  const abs = resolveUnder(root, relPath || ".");
  const entries = [];
  for (const name of readdirSync(abs)) {
    if (name.startsWith(".") && name !== ".github") continue;
    let isDir = false;
    let size = 0;
    try {
      const info = statSync(join(abs, name), { throwIfNoEntry: false });
      if (!info) continue;
      isDir = info.isDirectory();
      size = isDir ? 0 : info.size;
      // Do not expose links as ordinary workspace entries. The resolved path
      // is checked again before any child is opened.
      resolveUnder(root, relPath ? `${relPath}/${name}` : name);
    } catch {
      continue;
    }
    entries.push({ name, isDir, size });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { path: relPath ?? "", entries };
}

export function readFile(root, relPath) {
  const abs = resolveUnder(root, relPath);
  const info = statSync(abs);
  if (info.isDirectory()) throw new Error("Path is a directory");
  const size = info.size;
  const buffer = readFileSync(abs, { encoding: null, flag: "r" });
  const head = buffer.subarray(0, 8192);
  if (head.includes(0)) return { path: relPath, size, binary: true };
  const content = buffer.toString("utf8", 0, Math.min(buffer.length, MAX_READ_BYTES));
  return { path: relPath, size, binary: false, content, truncated: size > MAX_READ_BYTES };
}

export function fileIndex(root, query) {
  const q = String(query ?? "").toLowerCase().replace(/\\/g, "/");
  const results = [];
  const queue = [{ rel: "", depth: 0 }];
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_INDEX_FILES && results.length < 400) {
    const { rel, depth } = queue.shift();
    if (depth >= MAX_INDEX_DEPTH) continue;
    let entries;
    try {
      const dir = resolveUnder(root, rel || ".");
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      try {
        const childPath = resolveUnder(root, childRel);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          queue.push({ rel: childRel, depth: depth + 1 });
        } else {
          scanned += 1;
          if (!q || childRel.toLowerCase().includes(q)) results.push(childRel);
        }
        void childPath;
      } catch {
        // Skip symlinks and entries that disappear during the walk.
      }
    }
  }
  results.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return results.slice(0, 50);
}
