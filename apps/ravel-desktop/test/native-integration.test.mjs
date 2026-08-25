import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("native window integration has single-instance and safe bounds recovery", async () => {
  const main = await read("../electron/main.js");
  const settings = await read("../electron/desktop-settings.js");
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /second-instance/);
  assert.match(main, /getNormalBounds/);
  assert.match(main, /getAllDisplays/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /unresponsive/);
  assert.match(settings, /windowBounds/);
});

test("startup request supports workspace, session, and omega deep links", async () => {
  const main = await read("../electron/main.js");
  assert.match(main, /--workspace/);
  assert.match(main, /--session/);
  assert.match(main, /omega:\/\//);
  assert.match(main, /startupRequest\.sessionId/);
});
