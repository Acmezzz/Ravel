/**
 * Shared JSON config-file primitives: tolerant read and atomic temp+rename
 * write under a directory lock (dead-pid and age based stale recovery).
 * Extracted from mcp-service.js so other Ravel-owned config stores
 * (permission rules) get identical single-writer semantics.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LOCK_STALE_MS = 10_000;

export function configLockBusyMessage(file) {
  return `${file} 正在被其他写入方占用，请稍后重试`;
}

function claimLock(lockDir) {
  // mkdirSync(recursive) does not raise EEXIST, so contest on the owner file.
  if (existsSync(join(lockDir, "owner.json"))) return false;
  try {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
    return true;
  } catch {
    return false;
  }
}

function lockIsStale(ownerFile) {
  try {
    const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
    const alive =
      typeof owner.pid === "number" && owner.pid !== process.pid
        ? (() => {
            try {
              process.kill(owner.pid, 0);
              return true;
            } catch {
              return false;
            }
          })()
        : false;
      return !alive && typeof owner.createdAt === "number" ? Date.now() - owner.createdAt > LOCK_STALE_MS : !alive;
  } catch {
    return true;
  }
}

function acquireLock(lockDir, file) {
  if (claimLock(lockDir)) return;
  const ownerFile = join(lockDir, "owner.json");
  if (!lockIsStale(ownerFile)) {
    throw Object.assign(new Error(configLockBusyMessage(file)), { code: "busy" });
  }
  rmSync(lockDir, { recursive: true, force: true });
  if (!claimLock(lockDir)) {
    throw Object.assign(new Error(configLockBusyMessage(file)), { code: "busy" });
  }
}

function releaseLock(lockDir) {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Read a JSON file; missing or empty file → null; invalid JSON throws invalid_args. */
export function readJsonFile(file) {
  if (!file || !existsSync(file)) return null;
  const rawText = readFileSync(file, "utf8");
  if (!rawText.trim()) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    throw Object.assign(new Error(`${file} is not valid JSON`), { code: "invalid_args" });
  }
}

/** Atomic temp+rename write under the lock; throws before touching the file on caller errors. */
export function writeJsonFileAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const lockDir = `${file}.lock`;
  acquireLock(lockDir, file);
  try {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    renameSync(tmp, file);
  } finally {
    releaseLock(lockDir);
  }
}

/** Read-modify-write under the lock; `mutate` throws before anything is written. */
export function mutateJsonFile(file, mutate, fallback) {
  const current = readJsonFile(file) ?? fallback;
  const next = mutate(current);
  writeJsonFileAtomic(file, next);
  return next;
}
