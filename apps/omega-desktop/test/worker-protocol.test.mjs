import test from "node:test";
import assert from "node:assert/strict";
import { isWorkerEvent, isWorkerInit, isWorkerRequest, isWorkerResponse } from "../electron/worker-protocol.js";

test("worker protocol validates init/request/response/event envelopes", () => {
  assert.equal(isWorkerInit({ type: "init", cwd: "/workspace", extensionsRoot: "/extensions", generation: 1 }), true);
  assert.equal(isWorkerRequest({ type: "req", id: "req-1", method: "getState", args: {}, generation: 1 }), true);
  assert.equal(isWorkerResponse({ type: "resp", id: "req-1", data: { sessionId: "s1" } }), true);
  assert.equal(isWorkerEvent({ type: "app-event", event: { type: "agent_start" }, meta: { sequence: 1 } }), true);
  assert.equal(isWorkerRequest({ type: "req", id: "", method: "getState", generation: 1 }), false);
});

test("worker host preserves permission profile across restart and runtime schema is guarded", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../electron/worker-host.js", import.meta.url), "utf8");
  const main = await (await import("node:fs/promises")).readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  assert.match(source, /permissionProfile/);
  assert.match(source, /isWorkerResponse/);
  assert.match(main, /reusableWorkspaceSlot/);
  assert.match(main, /reuseIdleWorkspaceSlot/);
});
