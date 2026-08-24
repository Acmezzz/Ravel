import test from "node:test";
import assert from "node:assert/strict";
import { fileRequest, replayRequest, sessionNameRequest, sessionRequest, workspaceRequest } from "../electron/ipc-schemas.js";

test("shared IPC schemas normalize bounded common requests", () => {
  assert.deepEqual(sessionRequest({ sessionId: "s1" }), { sessionId: "s1" });
  assert.equal(sessionRequest({ sessionId: "" }), null);
  assert.deepEqual(workspaceRequest({ workspace: "/workspace" }), { workspace: "/workspace" });
  assert.deepEqual(fileRequest({ path: "src/a.ts" }), { path: "src/a.ts" });
  assert.deepEqual(replayRequest({ after: 5, limit: 999 }), { sessionId: undefined, after: 5, limit: 300 });
  assert.deepEqual(sessionNameRequest({ name: "  Alpha  " }), { name: "Alpha" });
  assert.deepEqual(sessionNameRequest({ name: "Alpha", sessionId: "s1" }), { name: "Alpha", sessionId: "s1" });
  assert.equal(sessionNameRequest({ name: "   " }), null);
  assert.deepEqual(sessionNameRequest({ name: "Alpha", sessionId: "" }), { name: "Alpha" });
  assert.equal(sessionNameRequest({ name: "Alpha", sessionId: "x".repeat(200) }), null);
});
