import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { realRoot } from "./path-security.js";

function key(root) {
  const value = resolve(root);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function readRoots(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeRoots(file, roots) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(roots, null, "\t")}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

export function createWorkspaceRegistry(file) {
  const roots = new Map();
  for (const value of readRoots(file)) {
    try {
      const root = realRoot(value);
      roots.set(key(root), root);
    } catch {
      // Drop projects that no longer exist or are no longer directories.
    }
  }

  return {
    has(value) {
      try {
        return roots.has(key(realRoot(value)));
      } catch {
        return false;
      }
    },
    add(value) {
      const root = realRoot(value);
      roots.set(key(root), root);
      writeRoots(file, [...roots.values()]);
      return root;
    },
    list() {
      return [...roots.values()];
    },
    resolveAuthorized(value) {
      const root = realRoot(value);
      if (!roots.has(key(root))) {
        const error = new Error("Workspace is not authorized; choose it from the project picker first");
        error.code = "workspace_not_authorized";
        throw error;
      }
      return roots.get(key(root));
    },
  };
}
