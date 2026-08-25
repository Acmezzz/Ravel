import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("binary and DOCX files can open through a guarded default-app IPC", async () => {
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  const preload = await readFile(new URL("../electron/preload.js", import.meta.url), "utf8");
  const viewer = await readFile(new URL("../src/renderer/components/files/FileViewer.tsx", import.meta.url), "utf8");
  assert.match(main, /omega:openFileDefault/);
  assert.match(main, /shell\.openPath/);
  assert.match(preload, /openFileDefault/);
  assert.match(viewer, /系统默认应用打开/);
});
