import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeSearchQuery, searchWorkspace, SEARCH_MAX_RESULTS } from "../electron/search-service.js";

async function exec(command, args, cwd) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

test("search queries are sanitized before reaching an engine", () => {
  assert.equal(sanitizeSearchQuery("  hello world  "), "hello world");
  assert.equal(sanitizeSearchQuery(""), null);
  assert.equal(sanitizeSearchQuery("   "), null);
  assert.equal(sanitizeSearchQuery(42), null);
  assert.equal(sanitizeSearchQuery("x".repeat(300)).length, 256);
});

test("searchWorkspace finds matches with ripgrep and falls back to git grep", async () => {
  const root = await mkdtemp(join(tmpdir(), "ravel-search-"));
  await writeFile(join(root, "app.ts"), "const alpha = 1;\nconst beta = alpha + 1;\n");
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "sub", "lib.ts"), "// alpha reference\nexport {};\n");

  let engineAvailable = true;
  try {
    await exec("rg", ["--version"], root);
  } catch {
    engineAvailable = false;
  }

  const viaRg = await searchWorkspace(root, "alpha");
  if (engineAvailable) {
    assert.equal(viaRg.engine, "rg");
    // app.ts lines 1-2 plus the comment in sub/lib.ts.
    assert.equal(viaRg.results.length, 3);
    assert.deepEqual(
      viaRg.results.map((match) => match.line).sort(),
      [1, 1, 2],
    );
    assert.ok(viaRg.results[0].text.includes("alpha"));
  }

  // git grep only sees tracked files; stage them to exercise the fallback.
  if (!engineAvailable) {
    await exec("git", ["init"], root);
    await exec("git", ["add", "-A"], root);
    const viaGitGrep = await searchWorkspace(root, "alpha");
    assert.equal(viaGitGrep.engine, "git-grep");
    assert.equal(viaGitGrep.results.length >= 1, true);
  }

  const miss = await searchWorkspace(root, "definitely-not-present-xyz");
  assert.deepEqual(miss.results, []);
  assert.equal(miss.truncated, false);
});

test("result caps are enforced by the service constant", () => {
  assert.equal(SEARCH_MAX_RESULTS, 200);
});
