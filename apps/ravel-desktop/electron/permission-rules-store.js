/**
 * Persistent permission-rule store (next-cycle B3 / borrowing A1b).
 *
 * Rules are plain Ravel-owned JSON files, mirroring mcp.json scoping:
 *   user scope    ~/.ravel/permission-rules.json
 *   project scope <workspace>/.ravel/permission-rules.json (trusted only)
 *
 * The file shape is `{ permissionRules: [...] }`; every stored rule passes
 * normalizeRule (closed action set, bounded lengths, ~ expansion). Writes go
 * through the shared atomic+lock primitives, so user deny/allow rules survive
 * restarts and reach every worker through the guard.
 *
 * Pure transforms are exported separately from file operations so tests can
 * exercise validation without touching disk.
 */
import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./config-file.js";
import { normalizeRuleset } from "./permission-rules.js";

export const MAX_RULES = 200;
export const RULES_FILE_NAME = "permission-rules.json";

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

/** Validate one author-supplied rule; throws invalid_args instead of dropping. */
export function validateRule(rule) {
  const normalized = normalizeRuleset([rule])[0];
  if (!normalized) throw invalid("rule needs a permission (tool name), an action (allow/ask/deny) and a pattern of at most 2048 characters");
  return normalized;
}

/** Parse raw JSON into a normalized {permissionRules} shape; missing file → null. */
export function parseRulesConfig(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("permission-rules.json must be an object");
  }
  const rules = normalizeRuleset(value.permissionRules ?? []);
  return { ...value, permissionRules: rules };
}

export function loadRulesBundle({ userFile, projectFile }) {
  return {
    user: parseRulesConfig(readJsonFile(userFile))?.permissionRules ?? [],
    project: projectFile ? parseRulesConfig(readJsonFile(projectFile))?.permissionRules ?? [] : [],
  };
}

/** Rulesets in increasing precedence for the guard: [user, project]. */
export function rulesetsForGuard(bundle) {
  return [bundle.user, bundle.project];
}

export function readRulesFile(file) {
  return parseRulesConfig(readJsonFile(file)) ?? { permissionRules: [] };
}

function assertWritable(rules) {
  if (rules.length >= MAX_RULES) throw invalid(`at most ${MAX_RULES} rules per file`);
}

/** Append a validated rule; returns the new full row list. */
export function addRule(file, rule) {
  const normalized = validateRule(rule);
  const current = readRulesFile(file);
  const exists = current.permissionRules.some((entry) =>
    entry.permission === normalized.permission && entry.pattern === normalized.pattern && entry.action === normalized.action);
  if (exists) return current;
  assertWritable(current.permissionRules);
  const next = { ...current, permissionRules: [...current.permissionRules, normalized] };
  writeJsonFileAtomic(file, next);
  return next;
}

/** Remove the rule at `index` (as listed by readRulesFile); returns the new rows. */
export function removeRuleAt(file, index) {
  const current = readRulesFile(file);
  if (!Number.isSafeInteger(index) || index < 0 || index >= current.permissionRules.length) {
    throw Object.assign(new Error(`Unknown rule index: ${index}`), { code: "not_found" });
  }
  const permissionRules = current.permissionRules.filter((_, i) => i !== index);
  const next = { ...current, permissionRules };
  writeJsonFileAtomic(file, next);
  return next;
}

/** Row shape for the settings UI: stable `scope:index` ids. */
export function listRuleRows(bundle) {
  return [
    ...bundle.project.map((rule, index) => ({ id: `project:${index}`, scope: "project", ...rule })),
    ...bundle.user.map((rule, index) => ({ id: `user:${index}`, scope: "user", ...rule })),
  ];
}

export function rulesFilePath(scope, cwd) {
  if (scope === "project") {
    if (!cwd) throw invalid("当前没有活动工作区，无法写入项目级权限规则");
    return join(cwd, ".ravel", RULES_FILE_NAME);
  }
  return null; // user path is resolved by main (homedir), never by the renderer
}
