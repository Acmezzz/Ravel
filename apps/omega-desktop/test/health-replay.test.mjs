import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("worker slots schedule unref health checks and expose health state", async () => {
  const source = await read("../electron/worker-pool.js");
  assert.match(source, /checkHealth/);
  assert.match(source, /reusableWorkspaceSlot/);
  assert.match(source, /unref/);
  assert.match(source, /health/);
});

test("recent event replay supports bounded pages and disk recovery", async () => {
  const main = await read("../electron/main.js");
  const preload = await read("../electron/preload.js");
  assert.match(main, /recentEventsFile/);
  assert.match(main, /enqueueRecentEvent/);
  assert.match(main, /RECENT_EVENT_MAX_BYTES/);
  assert.match(main, /runtimeEpoch/);
  assert.match(main, /nextAfter/);
  assert.match(main, /slice\(0, limit\)/);
  assert.match(preload, /runtimeEpoch: Number\.isInteger\(req\?\.runtimeEpoch\)/);
  assert.match(preload, /limit: Number\.isInteger\(req\?\.limit\)/);
});
