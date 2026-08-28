import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionGuard } from "../electron/permission-profiles.js";
import {
  PLAN_MODE_TOOLS,
  getModeProfile,
  listModeProfiles,
  modeAllowsTool,
  sanitizeModeProfile,
} from "../electron/mode-profiles.js";

test("ModeProfile registry freezes the plan contract and marks goal unwired", () => {
  const plan = getModeProfile("plan");
  assert.equal(plan.wired, true);
  assert.equal(plan.writeAccess, "read-only");
  assert.deepEqual(plan.tools, [...PLAN_MODE_TOOLS]);
  assert.equal(plan.completion, "human-review");
  assert.equal(plan.histosProfile, "plan.explore");
  assert.equal(plan.forcedPermissionProfile, "read-only");

  const goal = getModeProfile("goal");
  assert.equal(goal.wired, false, "goal must be an explicit placeholder this cycle");
  assert.equal(goal.histosProfile, null);

  const list = listModeProfiles();
  assert.deepEqual(list.map((profile) => profile.id), ["default", "plan", "goal"]);
  // Frozen profiles must not be mutable through the list.
  assert.notEqual(list[1].tools, plan.tools);
});

test("sanitizeModeProfile accepts known ids and fails closed on unknown ones", () => {
  assert.equal(sanitizeModeProfile("plan"), "plan");
  assert.equal(sanitizeModeProfile("default"), "default");
  assert.throws(() => sanitizeModeProfile("autonomous"), (error) => error.code === "invalid_args");
  assert.throws(() => sanitizeModeProfile(42), (error) => error.code === "invalid_args");
});

test("plan mode allowlist gates tools; default and unwired goal do not restrict", () => {
  for (const tool of ["read", "grep", "find", "ls"]) {
    assert.equal(modeAllowsTool("plan", tool), true, `plan must allow ${tool}`);
  }
  for (const tool of ["bash", "edit", "write", "mcp__x__y", "totally-unknown"]) {
    assert.equal(modeAllowsTool("plan", tool), false, `plan must deny ${tool}`);
  }
  assert.equal(modeAllowsTool("default", "edit"), true);
  assert.equal(modeAllowsTool("goal", "edit"), true, "unwired goal must degrade to default behavior, not fake evidence gating");
});

test("plan mode guard narrows the user profile: trusted user still cannot edit through the agent", async () => {
  const guard = createPermissionGuard({
    // The effective profile the worker passes: mode forces read-only even
    // when the user's own profile is trusted.
    profile: "read-only",
    cwd: "/ws",
    allowTool: (toolName) => modeAllowsTool("plan", toolName),
  });
  await assert.rejects(
    () => guard({ toolCall: { name: "edit", id: "t1" }, args: { path: "a.txt" } }),
    (error) => error.code === "permission_denied",
  );
  await assert.rejects(
    () => guard({ toolCall: { name: "bash", id: "t2" }, args: { command: "ls" } }),
    (error) => error.code === "permission_denied",
  );
  await guard({ toolCall: { name: "read", id: "t3" }, args: { path: "a.txt" } });
});

test("mode allowlist denies before any profile confirm could grant access", async () => {
  let confirmCalled = 0;
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/ws",
    allowTool: (toolName) => modeAllowsTool("plan", toolName),
    confirm: async () => {
      confirmCalled += 1;
      return true;
    },
    facts: {
      runId: () => "run",
      appendAsked: () => {},
      appendDecided: () => {},
    },
  });
  await assert.rejects(
    () => guard({ toolCall: { name: "write", id: "t4" }, args: { path: "b.txt" } }),
    (error) => error.code === "permission_denied",
  );
  assert.equal(confirmCalled, 0, "a mode-denied tool must not reach the approval UI");
});
