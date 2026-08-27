import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("packaged smoke launches an isolated app and requires runtime handshake", async () => {
  const source = await readFile(new URL("../scripts/electron-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /spawn\(executable/);
  assert.match(source, /OMEGA_AUTOTEST: "1"/);
  assert.match(source, /OMEGA_DOMPROBE: "1"/);
  assert.match(source, /--user-data-dir/);
  assert.match(source, /agent worker ready/);
  assert.match(source, /autotest done, quitting/);
  assert.match(source, /missing signals/);
  assert.match(source, /child\.kill\(\)/);
  assert.match(source, /child\.once\("exit"/);
  assert.match(source, /RAVEL_PTY_SMOKE/);
  assert.match(source, /pty smoke: spawn ok/);
  assert.doesNotMatch(source, /taskkill/i);
  assert.match(source, /resources.*(?:ravel|omega)-runtime|(?:ravel|omega)-runtime/);
});

test("packaged PTY unpacks ConPTY worker scripts and autotest exits via process.exit", async () => {
  const builder = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../electron/pty-worker.mjs", import.meta.url), "utf8");
  assert.match(builder, /node_modules\/node-pty\/\*\*/);
  assert.doesNotMatch(builder, /node_modules\/node-pty\/\*\*\/\*\.node/);
  assert.match(main, /autotest done, quitting/);
  assert.match(main, /process\.reallyExit\(0\)/);
  assert.match(main, /Electron aliases process\.exit to app\.exit/);
  assert.match(main, /must not await shutdown/);
  assert.match(worker, /session\.terminal\.onExit/);
  assert.match(worker, /setImmediate\(\(\) => process\.exit\(0\)\)/);
});
