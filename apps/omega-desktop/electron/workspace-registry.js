import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { realRoot } from "./path-security.js";

function key(root) {
  const value = resolve(root);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function workspaceId(root) {
  return `workspace-${Buffer.from(key(root)).toString("base64url").slice(0, 32)}`;
}

function toWorkspace(root) {
  return { workspaceId: workspaceId(root), realRoot: root, displayPath: root };
}

function readRoots(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => typeof value === "string" ? value : value?.realRoot).filter((value) => typeof value === "string");
  } catch {
    return [];
  }
}

function writeRoots(file, roots) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(roots.map(toWorkspace), null, "\t")}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

export function createWorkspaceRegistry(file) {
  const roots = new Map();
  let droppedOnLoad = false;
  for (const value of readRoots(file)) {
    try {
      const root = realRoot(value);
      roots.set(key(root), root);
    } catch {
      // Drop projects that no longer exist or are no longer directories.
      droppedOnLoad = true;
    }
  }
  if (droppedOnLoad) writeRoots(file, [...roots.values()]);

  function persist() {
    writeRoots(file, [...roots.values()]);
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
      persist();
      return root;
    },
    remove(value) {
      let changed = false;
      try {
        const root = realRoot(value);
        changed = roots.delete(key(root));
      } catch {
        changed = roots.delete(key(resolve(value)));
      }
      if (changed) persist();
      return changed;
    },
    prune() {
      let changed = false;
      for (const [entryKey, root] of [...roots.entries()]) {
        try {
          const next = realRoot(root);
          if (next !== root) {
            roots.delete(entryKey);
            roots.set(key(next), next);
            changed = true;
          }
        } catch {
          roots.delete(entryKey);
          changed = true;
        }
      }
      if (changed) persist();
      return [...roots.values()].map(toWorkspace);
    },
    list() {
      return [...roots.values()].map(toWorkspace);
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
