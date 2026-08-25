import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, readFilePage } from "../electron/workspace-service.js";

test("workspace reader rejects non-regular files", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../electron/workspace-service.js", import.meta.url), "utf8");
  assert.match(source, /lstatSync/);
  assert.match(source, /Path is not a regular file/);
});

test("workspace reader returns bounded media data URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-viewer-"));
  await writeFile(join(root, "pixel.png"), Buffer.from([137, 80, 78, 71]));
  const result = readFile(root, "pixel.png");
  assert.equal(result.binary, true);
  assert.equal(result.mimeType, "image/png");
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
});

test("workspace reader paginates large text by line", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-viewer-"));
  await writeFile(join(root, "large.txt"), Array.from({ length: 500 }, (_, index) => `line-${index}`).join("\n"));
  const first = readFilePage(root, "large.txt", 0, 100);
  assert.equal(first.offset, 0);
  assert.equal(first.totalLines, 500);
  assert.equal(first.nextOffset, 100);
  assert.match(first.content, /line-99/);
  const second = readFilePage(root, "large.txt", first.nextOffset, 100);
  assert.match(second.content, /^line-100/);
});

test("workspace reader rejects oversized paginated files before reading all content", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-viewer-"));
  await writeFile(join(root, "oversized.txt"), Buffer.alloc(8 * 1024 * 1024 + 1, 97));
  assert.throws(() => readFilePage(root, "oversized.txt"), (error) => error?.code === "file_too_large");
});

test("FileViewer exposes tabs, media, and pagination surfaces", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/renderer/components/files/FileViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /tabs/);
  assert.match(source, /dataUrl/);
  assert.match(source, /readFilePage/);
  assert.match(source, /加载更多行/);
});
