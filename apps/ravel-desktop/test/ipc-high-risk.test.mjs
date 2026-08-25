import test from "node:test";
import assert from "node:assert/strict";
import { gitCommitRequest, gitStageRequest, customProviderRequest } from "../electron/ipc-schemas.js";

test("high-risk Git/provider IPC requests use shared bounded schemas", () => {
  assert.equal(gitCommitRequest({ message: "commit" }).message, "commit");
  assert.equal(gitCommitRequest({ message: "" }), null);
  assert.equal(gitStageRequest({ snapshotToken: "t", items: [{ path: "a.txt" }] }).items[0].path, "a.txt");
  assert.deepEqual(customProviderRequest({ id: "provider" }), { id: "provider" });
});
