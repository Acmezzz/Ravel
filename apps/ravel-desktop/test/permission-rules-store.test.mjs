import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_RULES,
  addRule,
  listRuleRows,
  loadRulesBundle,
  parseRulesConfig,
  readRulesFile,
  removeRuleAt,
  rulesetsForGuard,
  validateRule,
} from "../electron/permission-rules-store.js";

function tempStore() {
  return join(mkdtempSync(join(tmpdir(), "ravel-rules-")), "permission-rules.json");
}

test("validateRule normalizes and fails closed on invalid input", () => {
  const rule = validateRule({ permission: "bash", pattern: "git *", action: "allow" });
  assert.deepEqual(rule, { permission: "bash", pattern: "git *", action: "allow" });
  // Missing/unknown action, empty permission, oversized pattern are invalid.
  assert.throws(() => validateRule({ permission: "bash", action: "sometimes" }), (error) => error.code === "invalid_args");
  assert.throws(() => validateRule({ permission: "", action: "deny" }), (error) => error.code === "invalid_args");
  assert.throws(() => validateRule({ permission: "bash", pattern: "x".repeat(3000), action: "deny" }), (error) => error.code === "invalid_args");
});

test("parseRulesConfig keeps normalized rules and drops malformed entries", () => {
  assert.equal(parseRulesConfig(null), null);
  assert.throws(() => parseRulesConfig([1, 2]), (error) => error.code === "invalid_args");
  const parsed = parseRulesConfig({ permissionRules: [{ permission: "write", pattern: "src/*", action: "ask" }, { permission: "" }] });
  assert.deepEqual(parsed.permissionRules, [{ permission: "write", pattern: "src/*", action: "ask" }]);
});

test("add/remove round-trips through disk and dedupes identical rules", () => {
  const file = tempStore();
  try {
    addRule(file, { permission: "bash", pattern: "git status", action: "allow" });
    addRule(file, { permission: "bash", pattern: "git status", action: "allow" });
    addRule(file, { permission: "write", pattern: "*", action: "deny" });
    const stored = readRulesFile(file);
    assert.equal(stored.permissionRules.length, 2, "duplicate add is a no-op");
    removeRuleAt(file, 0);
    const after = readRulesFile(file);
    assert.deepEqual(after.permissionRules, [{ permission: "write", pattern: "*", action: "deny" }]);
    assert.throws(() => removeRuleAt(file, 5), (error) => error.code === "not_found");
  } finally {
    rmSync(join(file, ".."), { recursive: true, force: true });
  }
});

test("loadRulesBundle composes [user, project] guard rulesets and UI rows", () => {
  const userFile = tempStore();
  const projectFile = tempStore();
  try {
    addRule(userFile, { permission: "bash", pattern: "npm test", action: "allow" });
    addRule(projectFile, { permission: "write", pattern: "src/*", action: "ask" });
    const bundle = loadRulesBundle({ userFile, projectFile });
    assert.deepEqual(rulesetsForGuard(bundle), [
      [{ permission: "bash", pattern: "npm test", action: "allow" }],
      [{ permission: "write", pattern: "src/*", action: "ask" }],
    ]);
    assert.deepEqual(listRuleRows(bundle).map((row) => row.id), ["project:0", "user:0"]);
  } finally {
    rmSync(join(userFile, ".."), { recursive: true, force: true });
    rmSync(join(projectFile, ".."), { recursive: true, force: true });
  }
});

test("the store enforces a rule cap per file", () => {
  const file = tempStore();
  try {
    for (let i = 0; i < MAX_RULES; i += 1) {
      addRule(file, { permission: `tool-${i}`, pattern: "*", action: "deny" });
    }
    assert.throws(() => addRule(file, { permission: "overflow", pattern: "*", action: "deny" }), (error) => error.code === "invalid_args");
  } finally {
    rmSync(join(file, ".."), { recursive: true, force: true });
  }
});
