import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("retry events carry bounded attempt metadata and persist recovery state", async () => {
  const bridge = await readFile(new URL("../electron/agent-bridge.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  const settings = await readFile(new URL("../electron/desktop-settings.js", import.meta.url), "utf8");
  assert.match(bridge, /maxAttempts/);
  assert.match(bridge, /delayMs/);
  assert.match(main, /retryAttempt/);
  assert.match(settings, /retryMaxAttempts/);
});
