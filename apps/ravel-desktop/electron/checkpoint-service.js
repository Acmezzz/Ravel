/**
 * Shadow-git checkpoints. Each snapshot is an INDEPENDENT commit object
 * stored under its own ref `refs/ravel/checkpoints/<id>` — no parent chains,
 * so old snapshots can be pruned by simply deleting their refs. Snapshots are
 * built through a temporary index; HEAD, the real index and the working tree
 * are never touched while snapshotting. Restore reverts the working tree to a
 * snapshot by reverse-applying its diff (plus removing files created after
 * it); a safety snapshot is taken first so a rewind is itself undoable.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const CHECKPOINT_REF_PREFIX = "refs/ravel/checkpoints/";
export const CHECKPOINT_CAP = 50;
const GIT_TIMEOUT_MS = 30_000;

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Ravel Checkpoint",
  GIT_AUTHOR_EMAIL: "checkpoint@ravel.local",
  GIT_COMMITTER_NAME: "Ravel Checkpoint",
  GIT_COMMITTER_EMAIL: "checkpoint@ravel.local",
};

function git(cwd, args, { env = {}, maxBuffer = 8_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer, windowsHide: true, env: { ...process.env, ...GIT_IDENTITY, ...env } },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message)));
        else resolve(typeof stdout === "string" ? stdout : stdout.toString());
      },
    );
  });
}

function firstLine(stdout) {
  return stdout.split("\n")[0]?.trim() ?? "";
}

function refFor(id) {
  return `${CHECKPOINT_REF_PREFIX}${id}`;
}

/** Snapshot the full working tree (including untracked files). Returns `{id,label}`. */
export async function createCheckpoint(cwd, label) {
  const indexFile = join(cwd, ".git", `ravel-index-${randomUUID()}`);
  try {
    await git(cwd, ["add", "-A", "."], { env: { GIT_INDEX_FILE: indexFile } });
    const tree = firstLine(await git(cwd, ["write-tree"], { env: { GIT_INDEX_FILE: indexFile } }));
    const safeLabel = String(label ?? "").slice(0, 200) || "checkpoint";
    const id = firstLine(await git(cwd, ["commit-tree", tree, "-m", safeLabel]));
    await git(cwd, ["update-ref", refFor(id), id]);
    // Some broken git builds exit 0 yet silently skip three-segment ref
    // creation; fail closed rather than return an unrecorded checkpoint id.
    try {
      const recorded = firstLine(await git(cwd, ["rev-parse", "--verify", refFor(id)]));
      if (recorded !== id) throw new Error("ref points elsewhere");
    } catch {
      throw new Error(`git update-ref did not persist ${refFor(id)}`);
    }
    await appendFile(join(cwd, ".git", "ravel-checkpoints.order"), `${id}\n`).catch(() => {});
    return { id, label: safeLabel };
  } finally {
    await rm(indexFile, { force: true }).catch(() => {});
  }
}

/** Newest-first checkpoint list, capped at CHECKPOINT_CAP entries. */
export async function listCheckpoints(cwd) {
  let out;
  try {
    out = await git(cwd, [
      "for-each-ref",
      `--format=%(objectname)%09%(creatordate:unix)%09%(contents:subject)`,
      CHECKPOINT_REF_PREFIX,
    ]);
  } catch {
    return [];
  }
  const byId = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const [id, ts, ...labelParts] = line.split("\t");
    byId.set(id, { id, ts: Number(ts) * 1000, label: labelParts.join("\t") });
  }

  // Creation order is tracked exactly in the sidecar file (commit timestamps
  // have second resolution and can tie); unknown ids fall back to date sort.
  const orderFile = join(cwd, ".git", "ravel-checkpoints.order");
  let orderedIds = [];
  try {
    orderedIds = (await readFile(orderFile, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    orderedIds = [];
  }
  const items = [];
  const seen = new Set();
  for (const id of [...orderedIds].reverse()) {
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    items.push(item);
  }
  const rest = [...byId.values()].filter((item) => !seen.has(item.id)).sort((a, b) => b.ts - a.ts);
  return [...items, ...rest].slice(0, CHECKPOINT_CAP);
}

async function checkpointExists(cwd, id) {
  try {
    await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${id}^{commit}`]);
    return /^[0-9a-f]{40}$/.test(id);
  } catch {
    return false;
  }
}

/**
 * Revert the working tree to a checkpoint. A safety snapshot of the current
 * state is taken first. Tracked modifications are reverted by reverse-
 * applying the target's diff; files that appeared after the snapshot (and are
 * not part of it) are deleted. Ignored files are never touched.
 */
export async function restoreCheckpoint(cwd, id) {
  if (!/^[0-9a-f]{40}$/.test(id)) {
    const error = new Error("Invalid checkpoint id");
    error.code = "invalid_args";
    throw error;
  }
  if (!(await checkpointExists(cwd, id))) {
    const error = new Error("Checkpoint not found");
    error.code = "not_found";
    throw error;
  }
  const safety = await createCheckpoint(cwd, "restore 安全快照（恢复前自动创建）");

  // Tracked changes (staged or not) between the snapshot and now.
  const patch = await git(cwd, ["diff", "--binary", id], { maxBuffer: 64_000_000 });
  if (patch.length > 0) {
    await new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        ["apply", "--reverse", "--whitespace=nowarn"],
        { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16_000_000 },
        (error, _stdout, stderr) => (error ? reject(new Error(String(stderr || error.message))) : resolve()),
      );
      child.stdin?.end(patch);
    });
  }

  // Files created after the snapshot: untracked now and absent from the
  // target tree. Ignored files (e.g. node_modules) are excluded.
  const targetFiles = new Set((await git(cwd, ["ls-tree", "-r", "--name-only", id])).split("\n").map((line) => line.trim()).filter(Boolean));
  const others = (await git(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").map((line) => line.trim()).filter(Boolean);
  for (const file of others) {
    if (!targetFiles.has(file)) {
      await rm(join(cwd, file), { force: true }).catch(() => {});
    }
  }

  const restored = await createCheckpoint(cwd, `restored ${id.slice(0, 8)}`);
  return { restored: restored.id, safety: safety.id };
}

/** Delete the oldest snapshot refs beyond the cap. Returns removed count. */
export async function pruneCheckpoints(cwd, cap = CHECKPOINT_CAP) {
  const list = await listCheckpoints(cwd);
  const stale = list.slice(cap);
  for (const item of stale) {
    await git(cwd, ["update-ref", "-d", refFor(item.id)]).catch(() => {});
  }
  if (stale.length > 0) {
    // Rewrite the sidecar order file without the pruned ids.
    const orderFile = join(cwd, ".git", "ravel-checkpoints.order");
    let orderedIds = [];
    try {
      orderedIds = (await readFile(orderFile, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean);
    } catch {
      orderedIds = [];
    }
    const staleIds = new Set(stale.map((item) => item.id));
    const kept = orderedIds.filter((id) => !staleIds.has(id));
    if (kept.length > 0 || orderedIds.length > 0) {
      await writeFile(orderFile, kept.length > 0 ? `${kept.join("\n")}\n` : "").catch(() => {});
    }
  }
  return stale.length;
}
