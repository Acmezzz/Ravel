import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectTarget, uploadFile } from "../electron/file-transfer-service.js";

test("file transfer detects conflicts and supports overwrite/keep-both", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-upload-root-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "omega-upload-source-"));
  const source = join(sourceRoot, "note.txt");
  await writeFile(source, "new content");
  await writeFile(join(root, "note.txt"), "old content");
  const target = inspectTarget(root, "note.txt");
  const conflict = uploadFile(root, source, "note.txt", { conflict: "cancel" });
  assert.equal(conflict.conflict, true);
  assert.equal(await readFile(join(root, "note.txt"), "utf8"), "old content");
  const kept = uploadFile(root, source, "note.txt", { conflict: "keep-both", expectedToken: target.token });
  assert.equal(kept.conflict, false);
  assert.equal(kept.path, "note (1).txt");
  const overwritten = uploadFile(root, source, "note.txt", { conflict: "overwrite", expectedToken: target.token });
  assert.equal(overwritten.conflict, false);
  assert.equal(await readFile(join(root, "note.txt"), "utf8"), "new content");
});

test("file transfer rejects path escape and stale target token", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-upload-root-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "omega-upload-source-"));
  const source = join(sourceRoot, "note.txt");
  await writeFile(source, "new content");
  assert.throws(() => uploadFile(root, source, "../escape.txt", { conflict: "overwrite" }), (error) => error.code === "path_escape");
  await writeFile(join(root, "note.txt"), "old");
  const target = inspectTarget(root, "note.txt");
  await writeFile(join(root, "note.txt"), "changed");
  assert.throws(() => uploadFile(root, source, "note.txt", { conflict: "overwrite", expectedToken: target.token }), (error) => error.code === "upload_conflict");
});
