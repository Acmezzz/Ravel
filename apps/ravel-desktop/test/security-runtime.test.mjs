import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveExisting, resolveForCreate, PathSecurityError } from "../electron/path-security.js";
import { listDir } from "../electron/workspace-service.js";
import { computeSnapshot, revertFiles, parseWorktreeList } from "../electron/diff-service.js";
import { createWorkspaceRegistry } from "../electron/workspace-registry.js";
import { readSessionSummaries } from "../electron/session-reader.js";

test("path security rejects traversal and symlink escapes in a real workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "omega-path-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "ok.txt"), "ok");
  assert.equal(resolveExisting(root, "src/ok.txt").relative, "src/ok.txt");
  assert.throws(() => resolveExisting(root, "../outside.txt"), (error) => error instanceof PathSecurityError && error.code === "path_escape");
  assert.throws(() => resolveForCreate(root, "../new.txt"), (error) => error instanceof PathSecurityError && error.code === "path_escape");

  const outside = mkdtempSync(join(tmpdir(), "omega-outside-"));
  writeFileSync(join(outside, "secret.txt"), "secret");
  try {
    symlinkSync(outside, join(root, "linked"), "junction");
  } catch (error) {
    assert.ok(error?.code === "EPERM" || error?.code === "EACCES", `unexpected symlink setup failure: ${error?.code ?? error}`);
    return;
  }
  assert.throws(() => resolveExisting(root, "linked/secret.txt"), (error) => error instanceof PathSecurityError && error.code === "path_escape");
  assert.deepEqual(listDir(root, ".").entries.map((entry) => entry.name), ["src"]);
});

test("workspace registry canonicalizes roots and rejects unauthorized directories", () => {
  const root = mkdtempSync(join(tmpdir(), "omega-authorized-"));
  const other = mkdtempSync(join(tmpdir(), "omega-unauthorized-"));
  const registryFile = join(root, "state", "workspaces.json");
  const registry = createWorkspaceRegistry(registryFile);
  assert.equal(registry.has(root), false);
  assert.throws(() => registry.resolveAuthorized(other), /not authorized/);
  const canonical = registry.add(root);
  assert.equal(registry.has(root), true);
  assert.equal(registry.resolveAuthorized(root), canonical);
  assert.deepEqual(registry.list().map((workspace) => workspace.realRoot), [canonical]);
  const reloaded = createWorkspaceRegistry(registryFile);
  assert.equal(reloaded.resolveAuthorized(root), canonical);
  assert.equal(registry.remove(root), true);
  assert.equal(registry.has(root), false);
  const missing = mkdtempSync(join(tmpdir(), "omega-missing-"));
  const gone = createWorkspaceRegistry(join(missing, "workspaces.json"));
  const vanished = mkdtempSync(join(tmpdir(), "omega-vanished-"));
  gone.add(vanished);
  rmSync(vanished, { recursive: true, force: true });
  assert.deepEqual(gone.prune(), []);
});

test("disk-first session reader reads JSONL summaries without starting a runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "omega-jsonl-"));
  const workspace = mkdtempSync(join(tmpdir(), "omega-jsonl-workspace-"));
  writeFileSync(join(root, "2026_session.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: workspace }),
    "not-json",
    JSON.stringify({ type: "session_info", id: "info-1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", name: "工作会话" }),
    JSON.stringify({ type: "message", id: "message-1", parentId: null, timestamp: "2026-01-01T00:00:02.000Z", message: { role: "user", content: "你好 Omega" } }),
  ].join("\n") + "\n");
  writeFileSync(join(root, "invalid.jsonl"), "{\"type\":\"not-session\"}\n");
  const page = await readSessionSummaries(root, { allowedWorkspaces: [workspace] });
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0], {
    id: "session-1",
    title: "工作会话",
    workspace,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    status: "active",
    messageCount: 1,
  });
  assert.deepEqual((await readSessionSummaries(root, { allowedWorkspaces: [mkdtempSync(join(tmpdir(), "omega-other-"))] })).items, []);
  assert.deepEqual(page.treeIndex, {});
  assert.equal(page.nextOffset, null);
});

test("disk-first session reader paginates summaries and indexes parent/child sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "omega-jsonl-page-"));
  const workspace = mkdtempSync(join(tmpdir(), "omega-jsonl-page-workspace-"));
  for (let index = 0; index < 5; index += 1) {
    const header = {
      type: "session",
      version: 3,
      id: `session-${index}`,
      timestamp: `2026-01-0${index + 1}T00:00:00.000Z`,
      cwd: workspace,
      ...(index === 1 ? { parentSession: "session-0.jsonl" } : {}),
    };
    writeFileSync(join(root, `session-${index}.jsonl`), [
      JSON.stringify(header),
      JSON.stringify({
        type: "message",
        id: `message-${index}`,
        parentId: null,
        timestamp: `2026-01-0${index + 1}T00:00:0${index}.000Z`,
        message: { role: "user", content: `msg ${index}` },
      }),
    ].join("\n") + "\n");
  }
  const page1 = await readSessionSummaries(root, { allowedWorkspaces: [workspace], offset: 0, limit: 2 });
  assert.equal(page1.total, 5);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.nextOffset, 2);
  assert.deepEqual(page1.items.map((item) => item.id), ["session-4", "session-3"]);
  assert.deepEqual(page1.treeIndex["session-0"], ["session-1"]);
  const page2 = await readSessionSummaries(root, { allowedWorkspaces: [workspace], offset: 2, limit: 2 });
  assert.equal(page2.items.length, 2);
  assert.equal(page2.nextOffset, 4);
  const page3 = await readSessionSummaries(root, { allowedWorkspaces: [workspace], offset: 4, limit: 2 });
  assert.equal(page3.items.length, 1);
  assert.equal(page3.nextOffset, null);
  const missing = await readSessionSummaries(join(root, "missing"), { allowedWorkspaces: [workspace] });
  assert.deepEqual(missing, { items: [], total: 0, nextOffset: null, treeIndex: {} });
});

test("git snapshot bounds untracked previews", () => {
  const root = mkdtempSync(join(tmpdir(), "omega-git-untracked-limit-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "oversized.txt"), Buffer.alloc(512 * 1024 + 1, 97));
  const snapshot = computeSnapshot(root);
  assert.equal(snapshot.unstaged.length, 1);
  assert.deepEqual(snapshot.unstaged[0].hunks, []);
});

test("git snapshot enforces an aggregate untracked preview budget", () => {
  const root = mkdtempSync(join(tmpdir(), "omega-git-untracked-budget-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const content = Buffer.alloc(512 * 1024, 97);
  for (let index = 1; index <= 9; index += 1) {
    writeFileSync(join(root, `${String(index).padStart(2, "0")}.txt`), content);
  }
  const snapshot = computeSnapshot(root);
  assert.equal(snapshot.unstaged.length, 9);
  assert.equal(snapshot.unstaged.slice(0, 8).every((file) => file.hunks.length > 0), true);
  assert.deepEqual(snapshot.unstaged[8].hunks, []);
});

test("git snapshot token rejects changes made after the snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "omega-git-stale-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "omega@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Omega Test"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "two\n");
  const snapshot = computeSnapshot(root);
  writeFileSync(join(root, "tracked.txt"), "three\n");
  assert.throws(() => revertFiles(["tracked.txt"], root, snapshot.snapshotToken), (error) => error?.code === "stale_diff_snapshot");
});

test("git snapshot token rejects a path not present in the approved snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "omega-git-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "omega@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Omega Test"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "two\n");
  const snapshot = computeSnapshot(root);
  assert.match(snapshot.snapshotToken, /^[0-9a-f-]{36}$/);
  const result = revertFiles(["../outside.txt"], root, snapshot.snapshotToken);
  assert.equal(result.applied, false);
  assert.equal(result.revertedFiles.length, 0);
  assert.match(result.errors[0], /approved snapshot/);
});

test("worktree porcelain parser keeps branch names and flags", () => {
  const worktrees = parseWorktreeList([
    "worktree /repo",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /repo-feat",
    "HEAD def",
    "detached",
    "locked reason",
    "prunable",
  ].join("\n"));
  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[0].branch, "main");
  assert.equal(worktrees[1].detached, true);
  assert.equal(worktrees[1].locked, true);
  assert.equal(worktrees[1].prunable, true);
});

test("busy close plans abort then flush/dispose/kill", async () => {
  const { closeDecisionFromIndex, plannedCloseSteps, runWorkerTeardown, CLOSE_DIALOG_BUTTONS } = await import("../electron/close-lifecycle.js");
  assert.deepEqual(CLOSE_DIALOG_BUTTONS, ["等待完成", "停止并退出", "取消"]);
  assert.equal(closeDecisionFromIndex(0), "wait");
  assert.equal(closeDecisionFromIndex(1), "stop");
  assert.equal(closeDecisionFromIndex(2), "cancel");
  assert.deepEqual(plannedCloseSteps("stop", { busy: true }), ["abort", "flush", "dispose", "kill"]);
  assert.deepEqual(plannedCloseSteps("wait", { busy: true }), ["flush", "dispose", "kill"]);
  assert.deepEqual(plannedCloseSteps("cancel", { busy: true }), []);
  const seen = [];
  const steps = await runWorkerTeardown({
    abort: async () => { seen.push("abort"); },
    flush: async () => { seen.push("flush"); },
    dispose: async () => { seen.push("dispose"); },
    kill: async () => { seen.push("kill"); },
  }, { abortFirst: true });
  assert.deepEqual(steps, ["abort", "flush", "dispose", "kill"]);
  assert.deepEqual(seen, ["abort", "flush", "dispose", "kill"]);
});

test("worker teardown continues after an earlier step fails", async () => {
  const { runWorkerTeardown } = await import("../electron/close-lifecycle.js");
  const seen = [];
  await assert.rejects(
    () => runWorkerTeardown({
      flush: async () => { seen.push("flush"); throw new Error("flush failed"); },
      dispose: async () => { seen.push("dispose"); },
      kill: async () => { seen.push("kill"); },
    }),
    /flush failed/,
  );
  assert.deepEqual(seen, ["flush", "dispose", "kill"]);
});
