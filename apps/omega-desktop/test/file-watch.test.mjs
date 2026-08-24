import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("FileViewer watch uses controlled Main IPC and refreshes the current path", async () => {
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  const preload = await readFile(new URL("../electron/preload.js", import.meta.url), "utf8");
  const viewer = await readFile(new URL("../src/renderer/components/files/FileViewer.tsx", import.meta.url), "utf8");
  assert.match(main, /startFileWatch/);
  assert.match(main, /file:changed/);
  assert.match(preload, /onFileChanged/);
  assert.match(viewer, /watchFile/);
  assert.match(viewer, /unwatchFile/);
  assert.match(viewer, /openViewer\((?:viewer\.path|requestPath)/);
});
