import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { appRendererUrl, isAllowedAppUrl, resolveAppAsset } from "../electron/app-protocol.js";

async function fixture(t) {
  const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? ".", "ravel-app-protocol-"));
  await mkdir(join(root, "dist", "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "ok");
  await writeFile(join(root, "dist", "assets", "index.js"), "ok");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("app protocol resolves contained renderer assets and blocks traversal", async (t) => {
  const root = await fixture(t);
  assert.equal(resolveAppAsset("app://bundle/index.html", root), join(root, "index.html"));
  assert.equal(resolveAppAsset("app://bundle/dist/assets/index.js", root), join(root, "dist", "assets", "index.js"));
  for (const url of [
    "file:///index.html",
    "https://bundle/index.html",
    "app://other/index.html",
    "app://bundle/../package.json",
    "app://bundle/%2e%2e/package.json",
    "app://bundle/%2e%2e%2fdist/assets/index.js",
    "app://bundle/%2e%2e%5cdist%5cassets%5cindex.js",
    "app://bundle/C:/outside.txt",
    "app://bundle/index.html?x=1",
  ]) assert.throws(() => resolveAppAsset(url, root));
});

test("app protocol rejects missing files, directories, and symlink escapes", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "dist", "dir"));
  assert.throws(() => resolveAppAsset("app://bundle/missing.js", root));
  assert.throws(() => resolveAppAsset("app://bundle/dist/dir", root));
  const outside = join(root, "..", "ravel-app-protocol-outside.txt");
  await writeFile(outside, "outside");
  try {
    await symlink(outside, join(root, "dist", "escape.txt"));
    assert.throws(() => resolveAppAsset("app://bundle/dist/escape.txt", root));
  } finally {
    await rm(outside, { force: true });
  }
});

test("app renderer URL and navigation policy are strict", () => {
  assert.equal(appRendererUrl("index.html"), "app://bundle/index.html");
  assert.equal(isAllowedAppUrl("app://bundle/index.html"), true);
  assert.equal(isAllowedAppUrl("app://bundle/dist/assets/index.js"), false);
  assert.equal(isAllowedAppUrl("app://bundle/../index.html"), false);
  assert.equal(isAllowedAppUrl("app://other/index.html"), false);
  assert.equal(isAllowedAppUrl("javascript:alert(1)"), false);
});
