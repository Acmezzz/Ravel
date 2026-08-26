import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOperationAllowed, createPermissionGuard, permissionProfileLabel, sanitizePermissionProfile } from "../electron/permission-profiles.js";

test("permission profiles sanitize and expose desktop labels", () => {
  assert.equal(sanitizePermissionProfile("read-only"), "read-only");
  assert.equal(sanitizePermissionProfile("unknown"), "workspace-only");
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

test("workspace-only rejects an existing symlink that escapes the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-permission-root-"));
  const outside = await mkdtemp(join(tmpdir(), "omega-permission-outside-"));
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(root, "linked"), "junction");
  const guard = createPermissionGuard({ profile: "workspace-only", cwd: root });
  await assert.rejects(() => guard({ toolCall: { name: "edit" }, args: { path: join(root, "linked", "secret.txt") } }), /超出授权/);
});

test("ask-before-command delegates the decision to the desktop UI", async () => {
  const decisions = [false, true];
  const guard = createPermissionGuard({ profile: "ask-before-command", cwd: "/workspace", confirm: async () => decisions.shift() });
  await assert.rejects(() => guard({ toolCall: { name: "bash" }, args: { command: "rm -rf tmp" } }), /拒绝/);
  await assert.doesNotReject(() => guard({ toolCall: { name: "bash" }, args: { command: "npm test" } }));
});

test("permission guard accepts AgentSession toolName/input events", async () => {
  const guard = createPermissionGuard({ profile: "read-only", cwd: "/workspace" });
  await assert.rejects(() => guard({ type: "tool_call", toolName: "bash", input: { command: "pwd" } }), /Read-only/);
});

test("unknown tools are fail-closed instead of silently allowed", async () => {
  // Restrictive profiles cannot prove an unregistered tool's side-effect scope.
  const workspaceGuard = createPermissionGuard({ profile: "workspace-only", cwd: "/workspace" });
  await assert.rejects(
    () => workspaceGuard({ toolCall: { name: "fetch_url" }, args: {} }),
    /fail-closed|未识别的工具/,
  );
  // Under ask-before-command the same tool goes through the durable approval
  // flow, and a denial still blocks it.
  const asks = [];
  const askGuard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/workspace",
    confirm: async () => false,
    facts: { runId: () => "op-1", appendAsked: (r) => asks.push(r), appendDecided: () => {} },
  });
  await assert.rejects(() => askGuard({ toolCall: { name: "fetch_url", id: "call-u1" }, args: {} }), /拒绝/);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].policyProfile, "ask-before-command");
  // Known read-only tools never trigger an approval prompt.
  const quietGuard = createPermissionGuard({ profile: "ask-before-command", cwd: "/workspace" });
  await assert.doesNotReject(() => quietGuard({ toolCall: { name: "grep" }, args: { pattern: "x" } }));
});

test("operation policy denies read-only and confirms ask-before-command", async () => {
  await assert.rejects(
    () => assertOperationAllowed({ profile: "read-only", cwd: "/workspace", operation: "git.commit", input: { message: "save" } }),
    /Read-only/,
  );
  await assert.rejects(
    () => assertOperationAllowed({ profile: "ask-before-command", cwd: "/workspace", operation: "git.commit", input: { message: "save" }, confirm: async () => false }),
    /拒绝/,
  );
  await assert.doesNotReject(
    () => assertOperationAllowed({ profile: "ask-before-command", cwd: "/workspace", operation: "git.commit", input: { message: "save" }, confirm: async () => true }),
  );
});
