import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpoint, listCheckpoints, restoreCheckpoint, pruneCheckpoints } from "../electron/checkpoint-service.js";

async function exec(command, args, cwd) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error) => (error ? reject(error) : resolve()));
  });
}

async function initRepo() {
  const root = await mkdtemp(join(tmpdir(), "ravel-checkpoint-"));
  await exec("git", ["init", "-b", "main"], root);
  await exec("git", ["config", "user.email", "test@ravel.local"], root);
  await exec("git", ["config", "user.name", "test"], root);
  await writeFile(join(root, "tracked.txt"), "base\n");
  await exec("git", ["add", "-A"], root);
  await exec("git", ["commit", "-m", "base commit"], root);
  return root;
}

test("checkpoints chain on a dedicated ref and restore reverts the worktree exactly", async () => {
  const root = await initRepo();

  // Snapshot the pristine state, then make a mess: modify tracked, add new,
  // delete nothing yet.
  const first = await createCheckpoint(root, "clean state");
  assert.equal(first.label, "clean state");

  await writeFile(join(root, "tracked.txt"), "mutated by agent\n");
  await writeFile(join(root, "extra.txt"), "created after snapshot\n");

  let list = await listCheckpoints(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, first.id);

  // Restoring must revert the modification AND remove the post-snapshot file.
  const result = await restoreCheckpoint(root, first.id);
  assert.match(result.restored, /^[0-9a-f]{40}$/);
  assert.match(result.safety, /^[0-9a-f]{40}$/);
  assert.equal((await readFile(join(root, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n"), "base\n");
  await assert.rejects(() => stat(join(root, "extra.txt")));

  // The chain keeps growing: safety + restored snapshots exist after a rewind.
  list = await listCheckpoints(root);
  assert.equal(list.length, 3);
  // Newest first.
  assert.equal(list[0].id, result.restored);

  await rm(root, { recursive: true, force: true });
});

test("restore is itself undoable through the safety snapshot", async () => {
  const root = await initRepo();
  const clean = await createCheckpoint(root, "clean");
  await writeFile(join(root, "tracked.txt"), "changed\n");
  await restoreCheckpoint(root, clean.id);

  // Undo the restore: rewind to the safety snapshot taken before restoring.
  const afterRestore = await listCheckpoints(root);
  const safety = afterRestore.find((item) => item.label.startsWith("restore 安全快照"));
  await restoreCheckpoint(root, safety.id);
  assert.equal((await readFile(join(root, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n"), "changed\n");
  await rm(root, { recursive: true, force: true });
});

test("prune trims the chain down to the cap while keeping newest entries", async () => {
  const root = await initRepo();
  for (let index = 0; index < 7; index += 1) {
    await writeFile(join(root, `f${index}.txt`), String(index));
    await createCheckpoint(root, `cp-${index}`);
  }
  const removed = await pruneCheckpoints(root, 5);
  assert.equal(removed, 2);
  const list = await listCheckpoints(root);
  assert.equal(list.length, 5);
  assert.equal(list[0].label, "cp-6");
  await rm(root, { recursive: true, force: true });
});
