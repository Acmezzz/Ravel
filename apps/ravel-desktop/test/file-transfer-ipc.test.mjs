import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("file transfer IPC remains guarded across Main, preload, and contracts", async () => {
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  const preload = await readFile(new URL("../electron/preload.js", import.meta.url), "utf8");
  const registry = await readFile(new URL("../electron/ipc-registry.js", import.meta.url), "utf8");
  assert.match(main, /omega:chooseFileForWorkspace/);
  assert.match(main, /omega:uploadFile/);
  assert.match(main, /senderAllowed/);
  assert.match(preload, /chooseFileForWorkspace/);
  assert.match(preload, /selectionId/);
  assert.match(registry, /omega:uploadFile/);
});
