import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { remoteFilenameFromUrl, stageRemoteResource, validateRemoteResourceUrl } from "../electron/remote-resource-service.js";

test("remote url validation accepts https files and rejects the rest", () => {
  assert.equal(validateRemoteResourceUrl("https://example.com/skills/a.md"), "https://example.com/skills/a.md");
  assert.throws(() => validateRemoteResourceUrl("http://example.com/a.md"), /https/);
  assert.throws(() => validateRemoteResourceUrl("https://localhost/a.md"), /localhost/);
  assert.throws(() => validateRemoteResourceUrl("https://127.0.0.1/a.md"), /localhost/);
  assert.throws(() => validateRemoteResourceUrl("ftp://example.com/a.md"), /https/);
  assert.throws(() => validateRemoteResourceUrl("not a url"), /absolute/);
  assert.throws(() => remoteFilenameFromUrl("https://example.com/"), /single file/);
  assert.throws(() => remoteFilenameFromUrl("https://example.com/a b.md"), /simple name/);
  assert.equal(remoteFilenameFromUrl("https://example.com/x/SKILL.md"), "SKILL.md");
});

test("stageRemoteResource downloads, hashes, and stages under the sha with a round-trip check", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ravel-stage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const content = "---\nname: greet\n---\nhello";
  const bytes = new TextEncoder().encode(content);
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer });
  const staged = await stageRemoteResource("https://example.com/skills/greet.md", root, { fetchImpl });
  const expectedSha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(staged.sha256, expectedSha);
  assert.equal(staged.filename, "greet.md");
  assert.ok(staged.path.includes(expectedSha));
  assert.equal(await readFile(staged.path, "utf8"), content);
});

test("stageRemoteResource rejects HTTP failures, empty and oversized bodies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ravel-stage-bad-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    () => stageRemoteResource("https://example.com/a.md", root, { fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) }),
    (error) => error.code === "fetch_failed",
  );
  await assert.rejects(
    () => stageRemoteResource("https://example.com/a.md", root, { fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }) }),
    /为空/,
  );
  const big = new ArrayBuffer(9 * 1024 * 1024);
  await assert.rejects(
    () => stageRemoteResource("https://example.com/a.md", root, { fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => big }) }),
    (error) => error.code === "too_large",
  );
});
