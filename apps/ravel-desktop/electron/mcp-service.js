/**
 * MCP server definition management — Ravel-owned mcp.json files.
 *
 * Definitions are plain local files, so the fact layer stays untouched:
 *   user scope    ~/.ravel/mcp.json
 *   project scope <workspace>/.ravel/mcp.json (requires a trusted project)
 *
 * stdio only. Network transports (http/sse) are deliberately out of scope —
 * Ravel has no harness-side credential story to lean on, and a read-only list
 * of servers it can never run would be a fake panel.
 *
 * Pure transforms are exported separately from the file operations so tests
 * can exercise validation without touching disk.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MCP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
export const MAX_NAME = 64;
export const MAX_COMMAND = 2048;
export const MAX_ARGS = 64;
export const MAX_ARG = 2048;
const LOCK_STALE_MS = 10_000;

export function validateMcpName(name) {
  if (typeof name !== "string" || !name.trim()) throw invalid("name is required");
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME) throw invalid(`name must be at most ${MAX_NAME} characters`);
  if (!MCP_NAME_PATTERN.test(trimmed)) throw invalid("name may only contain letters, digits, _ . : -");
  return trimmed;
}

export function validateMcpCommand(command) {
  if (typeof command !== "string" || !command.trim()) throw invalid("command is required");
  const trimmed = command.trim();
  if (trimmed.length > MAX_COMMAND) throw invalid(`command must be at most ${MAX_COMMAND} characters`);
  if (trimmed.startsWith("-")) throw invalid("command must not start with '-'");
  // Control characters would corrupt argv or the JSONL-adjacent config file.
  if (/[\r\n\0\t]/.test(trimmed)) throw invalid("command must not contain control characters");
  return trimmed;
}

export function validateMcpArgs(args) {
  if (args === undefined || args === null) return [];
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw invalid(`args must be an array of at most ${MAX_ARGS} strings`);
  return args.map((arg) => {
    if (typeof arg !== "string") throw invalid("args must be strings");
    if (arg.length > MAX_ARG) throw invalid(`each arg must be at most ${MAX_ARG} characters`);
    if (/[\r\n\0]/.test(arg)) throw invalid("args must not contain control characters");
    return arg;
  });
}

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

/** Parse raw JSON into a normalized {mcpServers} shape; missing file → empty. */
export function parseMcpConfig(rawText) {
  if (!rawText || !rawText.trim()) return { mcpServers: {} };
  let value;
  try {
    value = JSON.parse(rawText);
  } catch {
    throw Object.assign(new Error("mcp.json is not valid JSON"), { code: "invalid_args" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("mcp.json must be an object"), { code: "invalid_args" });
  }
  const servers = value.mcpServers ?? {};
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw Object.assign(new Error("mcpServers must be an object"), { code: "invalid_args" });
  }
  return { ...value, mcpServers: servers };
}

/** Pure upsert; rejects duplicates only for renames that collide with another key. */
export function upsertMcpServer(config, { name, command, args = [], enabled = true }) {
  const nextServers = { ...config.mcpServers };
  nextServers[name] = { command, args, enabled: enabled !== false };
  return { ...config, mcpServers: nextServers };
}

export function setMcpServerEnabled(config, name, enabled) {
  const current = config.mcpServers[name];
  if (!current) throw Object.assign(new Error(`Unknown MCP server: ${name}`), { code: "not_found" });
  if (Boolean(current.enabled) === Boolean(enabled)) return config;
  return { ...config, mcpServers: { ...config.mcpServers, [name]: { ...current, enabled: enabled !== false } } };
}

export function removeMcpServer(config, name) {
  if (!config.mcpServers[name]) throw Object.assign(new Error(`Unknown MCP server: ${name}`), { code: "not_found" });
  const nextServers = { ...config.mcpServers };
  delete nextServers[name];
  return { ...config, mcpServers: nextServers };
}

/** Rows for the resource center UI, project entries shadowing user ones. */
export function listMcpRows(userConfig, projectConfig) {
  const rows = [];
  for (const [name, server] of Object.entries(projectConfig?.mcpServers ?? {})) {
    rows.push({ name, command: server.command, args: server.args ?? [], scope: "project", enabled: server.enabled !== false });
  }
  for (const [name, server] of Object.entries(userConfig?.mcpServers ?? {})) {
    if (projectConfig?.mcpServers?.[name]) continue; // project override wins; show one row
    rows.push({ name, command: server.command, args: server.args ?? [], scope: "user", enabled: server.enabled !== false });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function readConfigFile(file) {
  if (!file || !existsSync(file)) return null;
  return parseMcpConfig(readFileSync(file, "utf8"));
}

function serialize(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Directory lock around config writes: an owner file inside a `.lock` dir with
 * dead-pid and age-based stale recovery. Single-writer by construction (one
 * desktop app), so contention resolves in at most two passes.
 */
function claimLock(lockDir) {
  // mkdirSync(recursive) does not raise EEXIST, so contest on the owner file.
  if (existsSync(join(lockDir, "owner.json"))) return false;
  try {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
    return true;
  } catch {
    return false;
  }
}

function lockIsStale(ownerFile) {
  try {
    const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
    const alive =
      typeof owner.pid === "number" && owner.pid !== process.pid
        ? (() => {
            try {
              process.kill(owner.pid, 0);
              return true;
            } catch {
              return false;
            }
          })()
        : false;
      return !alive && typeof owner.createdAt === "number" ? Date.now() - owner.createdAt > LOCK_STALE_MS : !alive;
  } catch {
    return true;
  }
}

function acquireLock(lockDir) {
  if (claimLock(lockDir)) return;
  const ownerFile = join(lockDir, "owner.json");
  if (!lockIsStale(ownerFile)) {
    throw Object.assign(new Error("mcp.json 正在被其他写入方占用，请稍后重试"), { code: "busy" });
  }
  rmSync(lockDir, { recursive: true, force: true });
  if (!claimLock(lockDir)) {
    throw Object.assign(new Error("mcp.json 正在被其他写入方占用，请稍后重试"), { code: "busy" });
  }
}

function releaseLock(lockDir) {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Atomic temp+rename write under the lock; throws before touching the file on validation errors. */
function writeConfigFile(file, config) {
  mkdirSync(dirname(file), { recursive: true });
  const lockDir = `${file}.lock`;
  acquireLock(lockDir);
  try {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, serialize(config), { encoding: "utf8" });
    renameSync(tmp, file);
  } finally {
    releaseLock(lockDir);
  }
}

export function loadMcpBundle({ userFile, projectFile }) {
  return {
    user: readConfigFile(userFile) ?? { mcpServers: {} },
    project: readConfigFile(projectFile),
  };
}

export function mutateMcpFile(file, mutate) {
  const current = readConfigFile(file) ?? { mcpServers: {} };
  const next = mutate(current);
  writeConfigFile(file, next);
  return next;
}
