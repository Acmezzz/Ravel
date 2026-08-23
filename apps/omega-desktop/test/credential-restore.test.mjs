import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("credential vault values are restored only through Main to Worker init", async () => {
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  const host = await readFile(new URL("../electron/worker-host.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  assert.match(main, /credentialStore\.read/);
  assert.match(host, /runtimeCredentials/);
  assert.match(worker, /setRuntimeApiKey/);
  assert.doesNotMatch(main, /webContents\.send\([^\n]*apiKey/);
});
