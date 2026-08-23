import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionGuard, permissionProfileLabel, sanitizePermissionProfile } from "../electron/permission-profiles.js";

test("permission profiles sanitize and expose desktop labels", () => {
  assert.equal(sanitizePermissionProfile("read-only"), "read-only");
  assert.equal(sanitizePermissionProfile("unknown"), "trusted");
  assert.match(permissionProfileLabel("workspace-only"), /Workspace-only/);
});

test("read-only blocks mutating tools but permits reads", async () => {
  const guard = createPermissionGuard({ profile: "read-only", cwd: "/workspace" });
  await assert.rejects(() => guard({ toolCall: { name: "write" }, args: { path: "/workspace/a.txt" } }), /Read-only/);
  await assert.doesNotReject(() => guard({ toolCall: { name: "read" }, args: { path: "/workspace/a.txt" } }));
});

test("workspace-only rejects bash and paths outside the workspace", async () => {
  const guard = createPermissionGuard({ profile: "workspace-only", cwd: "/workspace" });
  await assert.rejects(() => guard({ toolCall: { name: "bash" }, args: { command: "pwd" } }), /shell/);
  await assert.rejects(() => guard({ toolCall: { name: "edit" }, args: { path: "/other/a.txt" } }), /超出授权/);
  await assert.doesNotReject(() => guard({ toolCall: { name: "edit" }, args: { path: "src/a.txt" } }));
});

test("ask-before-command delegates the decision to the desktop UI", async () => {
  const decisions = [false, true];
  const guard = createPermissionGuard({ profile: "ask-before-command", cwd: "/workspace", confirm: async () => decisions.shift() });
  await assert.rejects(() => guard({ toolCall: { name: "bash" }, args: { command: "rm -rf tmp" } }), /拒绝/);
  await assert.doesNotReject(() => guard({ toolCall: { name: "bash" }, args: { command: "npm test" } }));
});
