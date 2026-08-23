import test from "node:test";
import assert from "node:assert/strict";
import { fileRequest, replayRequest, sessionRequest, sessionRpcRequest, workspaceRequest } from "../electron/ipc-schemas.js";

test("shared IPC schemas normalize bounded common requests", () => {
  assert.deepEqual(sessionRequest({ sessionId: "s1" }), { sessionId: "s1" });
  assert.equal(sessionRequest({ sessionId: "" }), null);
  assert.deepEqual(workspaceRequest({ workspace: "/workspace" }), { workspace: "/workspace" });
  assert.deepEqual(fileRequest({ path: "src/a.ts" }), { path: "src/a.ts" });
  assert.deepEqual(replayRequest({ after: 5, limit: 999 }), { sessionId: undefined, after: 5, limit: 100 });
  assert.deepEqual(sessionRpcRequest({ sessionId: "s1", method: "getState", args: { x: 1 } }), { sessionId: "s1", method: "getState", args: { x: 1 } });
});
