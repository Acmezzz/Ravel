/**
 * Per-tool wildcard permission rules (adapted from opencode's permission
 * engine and Kilo Code's ConfigProtection, MIT).
 *
 * A rule is { permission, pattern, action } where action is allow|ask|deny.
 * `permission` is a tool name (or `bash` / `edit` style group), `pattern` is
 * a wildcard matched against the tool's primary pattern (the bash command, or
 * the normalized relative path for file tools). Evaluation order:
 *
 *   built-in safety floor > session overrides > project rules > user rules > defaults
 *
 * within a merged list the LAST match wins (findLast), so the caller composes
 * rulesets in increasing precedence and later layers can only be checked by
 * the floor. The safety floor can never be overridden: destructive commands
 * and sensitive paths are forced to at least `ask` (deny stays deny), which is
 * the same "non-bypassable safety override" idea omp/kilocode apply, and the
 * direct mirror of "a mode/rules can only narrow access" from next-cycle §3.3.
 *
 * This module is pure: rules -> decision. Persistence and the durable
 * approval facts live in main/permission-profiles.
 */
// Adapted from opencode packages/opencode/src/permission/index.ts and
// packages/core/src/util/wildcard.ts (MIT, Copyright (c) 2025 opencode).
import { homedir } from "node:os";

export const PERMISSION_RULE_ACTIONS = Object.freeze(["allow", "ask", "deny"]);

function normalizePath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/") : "";
}

/**
 * Wildcard match: `*` matches any run, `?` a single char. Windows is
 * case-insensitive for paths; a trailing ` *` also matches the bare prefix
 * (so `git *` matches both `git` and `git checkout main`).
 */
export function wildcardMatch(pattern, value) {
  const haystack = normalizePath(value);
  const needle = normalizePath(pattern);
  const ignoreCase = process.platform === "win32";
  if (needle === "*") return true;
  const body = needle
    .split("")
    .map((char) => (char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  const source = needle.endsWith(" *") ? `${body.slice(0, -3)}( .*)?` : body;
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "").test(haystack);
}

function expandHome(value) {
  const path = normalizePath(value);
  if (path === "~") return normalizePath(homedir());
  if (path.startsWith("~/")) return `${normalizePath(homedir())}/${path.slice(2)}`;
  if (path.includes("$HOME/")) return path.replace(/\$HOME\//g, `${normalizePath(homedir())}/`);
  return path;
}

/**
 * Normalize one author-supplied rule. `permission` is the tool (or group);
 * `pattern` defaults to "*" (all calls of that tool). Invalid rules are
 * dropped by the store loader, never evaluated.
 */
export function normalizeRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const permission = typeof rule.permission === "string" && rule.permission.length > 0 && rule.permission.length <= 128 ? rule.permission : null;
  const action = PERMISSION_RULE_ACTIONS.includes(rule.action) ? rule.action : null;
  const pattern = rule.pattern === undefined ? "*" : typeof rule.pattern === "string" && rule.pattern.length <= 2048 ? expandHome(rule.pattern) : null;
  if (!permission || !action || pattern === null) return null;
  return { permission, pattern, action };
}

export function normalizeRuleset(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map(normalizeRule).filter((rule) => rule !== null);
}

/**
 * Built-in safety floor: patterns that user configuration can NEVER lower
 * below `ask` (and where an explicit deny always stands). Destructive shell
 * shapes and sensitive files — keep this list conservative; it fires on the
 * bash command string and file patterns alike.
 */
const SAFETY_FLOOR_PATTERNS = Object.freeze([
  "rm -rf /*",
  "rm -rf ~*",
  "rm -rf $HOME*",
  "mkfs*",
  "dd if=*of=/dev/*",
  ":(){*};*",
  "git push --force*",
  "git push -f*",
  "*.env",
  "*.env.*",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa*",
  ".git/config",
  ".git/**",
  ".ravel/mcp.json",
  ".ravel/permissions.json",
  "mcp.json",
]);

/** Coerce an action to at least `ask` (deny is stronger than ask is stronger than allow). */
function escalate(action, floor) {
  if (action === "deny" || floor === "deny") return "deny";
  if (action === "ask" || floor === "ask") return "ask";
  return "allow";
}

export function safetyFloorActionFor(value) {
  for (const pattern of SAFETY_FLOOR_PATTERNS) {
    if (wildcardMatch(pattern, value)) return "ask";
  }
  return null;
}

/**
 * The primary pattern a call is matched against: the shell command for bash,
 * the workspace-relative (or absolute, when outside) path for file tools,
 * `*` for everything else. Paths are normalized to forward slashes so rules
 * are portable; case folding happens in the matcher on Windows.
 */
export function primaryPatternOf(toolName, input, cwd) {
  const args = input && typeof input === "object" ? input : {};
  if (toolName === "bash") return typeof args.command === "string" ? args.command.trim().slice(0, 8192) : "*";
  const raw = typeof args.path === "string" ? args.path : typeof args.filePath === "string" ? args.filePath : null;
  if (!raw) return "*";
  const value = normalizePath(raw);
  const root = normalizePath(cwd ?? "").replace(/\/+$/, "");
  if (root && value.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return value.slice(root.length + 1);
  return value;
}

/**
 * Evaluate one tool call. `pattern` is the primary pattern (command text, or
 * workspace-relative path). Returns { action, rule } where `rule` is the
 * winning rule descriptor `permission:pattern` for audit facts; action
 * defaults to `ask` when nothing matches (fail-closed toward a human).
 */
export function evaluatePermissionRules(rulesets, permission, pattern) {
  const flat = rulesets.flat();
  let matched = null;
  for (let index = flat.length - 1; index >= 0; index -= 1) {
    const rule = flat[index];
    if (!rule) continue;
    if (wildcardMatch(rule.permission, permission) && wildcardMatch(rule.pattern, pattern ?? "*")) {
      matched = rule;
      break;
    }
  }
  const base = matched ? matched.action : "ask";
  const floor = safetyFloorActionFor(pattern ?? "");
  const action = floor ? escalate(base, floor) : base;
  const ruleSource = matched ? `${matched.permission}:${matched.pattern}` : null;
  return { action, rule: matched, ruleSource, escalatedBySafetyFloor: Boolean(floor && (action !== base)) };
}
