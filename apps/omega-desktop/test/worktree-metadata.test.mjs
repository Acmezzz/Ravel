import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listWorktrees, parseWorktreeList } from "../electron/diff-service.js";

test("worktree parser keeps metadata and list computes local status counts", async () => {
  const parsed = parseWorktreeList("worktree /repo/main\nHEAD abcdef012345\nbranch refs/heads/main\n\n");
  assert.equal(parsed[0].head, "abcdef012345");
  const root = await mkdtemp(join(tmpdir(), "omega-worktree-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["-c", "user.email=omega@example.com", "-c", "user.name=Omega", "commit", "-qm", "initial"], { cwd: root });
  await writeFile(join(root, "README.md"), "changed");
  const result = listWorktrees(root);
  assert.equal(result.isGitRepo, true);
  assert.equal(result.worktrees[0].unstaged >= 1, true);
  assert.equal(typeof result.worktrees[0].headShort, "string");
});
