import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionGuard } from "../electron/permission-profiles.js";
import {
  evaluatePermissionRules,
  normalizeRuleset,
  primaryPatternOf,
  safetyFloorActionFor,
  wildcardMatch,
} from "../electron/permission-rules.js";

test("wildcardMatch covers *, ?, and trailing-prefix wildcards", () => {
  assert.equal(wildcardMatch("*", "anything"), true);
  assert.equal(wildcardMatch("git *", "git checkout main"), true);
  assert.equal(wildcardMatch("git *", "git"), true, "trailing ' *' also matches the bare prefix");
  assert.equal(wildcardMatch("git *", "github push"), false);
  assert.equal(wildcardMatch("src/?.ts", "src/a.ts"), true);
  assert.equal(wildcardMatch("src/*.ts", "src/deep/a.ts"), true);
  assert.equal(wildcardMatch("readme.md", "README.MD"), process.platform === "win32");
  assert.equal(wildcardMatch("a\\b\\c", "a/b/c"), true, "backslashes normalize to forward slashes");
});

test("rule evaluation is last-match-wins, default ask, and the safety floor cannot be overridden", () => {
  const rules = normalizeRuleset([
    { permission: "bash", pattern: "git *", action: "allow" },
    { permission: "bash", pattern: "git push --force*", action: "ask" },
  ]);
  assert.equal(evaluatePermissionRules([rules], "bash", "git status").action, "allow");
  assert.equal(evaluatePermissionRules([rules], "bash", "git status").ruleSource, "bash:git *");
  assert.equal(evaluatePermissionRules([rules], "bash", "git push --force main").action, "ask", "later narrower rule wins");
  assert.equal(evaluatePermissionRules([rules], "read", "anything").action, "ask", "no match defaults to ask");
  // A user-level allow on a sensitive path must never lower it below ask.
  const envAllow = normalizeRuleset([{ permission: "read", pattern: ".env", action: "allow" }]);
  assert.equal(evaluatePermissionRules([envAllow], "read", ".env").action, "ask");
  assert.equal(evaluatePermissionRules([envAllow], "read", ".env").escalatedBySafetyFloor, true);
  assert.equal(safetyFloorActionFor("rm -rf ~"), "ask");
  assert.equal(safetyFloorActionFor("npm test"), null);
});

test("primaryPatternOf extracts the bash command and relative paths", () => {
  assert.equal(primaryPatternOf("bash", { command: "  npm test  " }, "/ws"), "npm test");
  assert.equal(primaryPatternOf("edit", { path: "/ws/src/a.ts" }, "/ws"), "src/a.ts");
  assert.equal(primaryPatternOf("edit", { path: "src\\a.ts" }, "/ws"), "src/a.ts");
  assert.equal(primaryPatternOf("edit", { filePath: "/other/x" }, "/ws"), "/other/x");
  assert.equal(primaryPatternOf("grep", {}, "/ws"), "*");
});

test("guard: a rule deny blocks even under ask-before-command and writes rule-denied facts", async () => {
  const facts = [];
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/ws",
    rules: [[{ permission: "bash", pattern: "curl *", action: "deny" }]],
    confirm: async () => {
      throw new Error("confirm must not be consulted for a rule-denied call");
    },
    facts: {
      runId: () => "run-1",
      appendAsked: (asked) => facts.push(asked),
      appendDecided: (decided) => facts.push(decided),
    },
  });
  await assert.rejects(
    () => guard({ toolCall: { name: "bash", id: "t1" }, args: { command: "curl https://evil" } }),
    /已拒绝/,
  );
  assert.equal(facts.length, 2);
  assert.equal(facts[0].type, "approval_asked");
  assert.equal(facts[0].ruleSource, "bash:curl *");
  assert.equal(facts[1].type, "approval_decided");
  assert.equal(facts[1].outcome, "rejected");
  assert.equal(facts[1].reasonCode, "rule-denied");
  assert.equal(facts[1].askedId, facts[0].id);
});

test("guard: a rule allow skips the UI but stays a durable paired fact", async () => {
  const facts = [];
  let confirmCalls = 0;
  const snapshots = [];
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/ws",
    rules: [[{ permission: "bash", pattern: "npm *", action: "allow" }]],
    confirm: async () => {
      confirmCalls += 1;
      return true;
    },
    facts: {
      runId: () => "run-2",
      appendAsked: (asked) => facts.push(asked),
      appendDecided: (decided) => facts.push(decided),
    },
    snapshot: async ({ toolName }) => snapshots.push(toolName),
  });
  await guard({ toolCall: { name: "bash", id: "t2" }, args: { command: "npm test" } });
  assert.equal(confirmCalls, 0, "rule-allowed calls skip the interactive confirm");
  assert.equal(facts.length, 2);
  assert.equal(facts[1].reasonCode, "rule-allowed");
  assert.equal(facts[1].outcome, "allowed-once");
  assert.deepEqual(snapshots, ["bash"], "an approved mutation still takes its shadow snapshot");
});

test("guard: safety floor forces a rule allow back to the UI", async () => {
  let confirmAsked = 0;
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/ws",
    rules: [[{ permission: "bash", pattern: "git *", action: "allow" }]],
    confirm: async () => {
      confirmAsked += 1;
      return true;
    },
  });
  await guard({ toolCall: { name: "bash", id: "t3" }, args: { command: "git push --force origin main" } });
  assert.equal(confirmAsked, 1, "the built-in floor escalates destructive commands even when rules allow them");
});

test("guard: rule-allow fact write failure fails closed", async () => {
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/ws",
    rules: [[{ permission: "bash", pattern: "npm *", action: "allow" }]],
    facts: {
      runId: () => "run-3",
      appendAsked: () => {
        throw new Error("disk full");
      },
      appendDecided: () => {},
    },
  });
  await assert.rejects(
    () => guard({ toolCall: { name: "bash", id: "t4" }, args: { command: "npm test" } }),
    /fail-closed|未能落盘/,
  );
});

test("guard: allow rules never widen a restrictive profile — containment still wins", async () => {
  const guard = createPermissionGuard({
    profile: "workspace-only",
    cwd: "/ws",
    rules: [[{ permission: "edit", pattern: "*", action: "allow" }]],
  });
  await assert.rejects(
    () => guard({ toolCall: { name: "edit", id: "t5" }, args: { path: "/other/a.txt" } }),
    /超出授权/,
    "a wildcard allow rule must not bypass workspace containment",
  );
  await assert.doesNotReject(() => guard({ toolCall: { name: "edit", id: "t6" }, args: { path: "a.txt" } }), "normal workspace edit still flows");
});
