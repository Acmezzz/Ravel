/**
 * MCP server definition management — Ravel-owned mcp.json files.
 *
 * Definitions are plain local files, so the fact layer stays untouched:
 *   user scope    ~/.ravel/mcp.json
 *   project scope <workspace>/.ravel/mcp.json (requires a trusted project)
 *
 * Transports: stdio ({command, args}) and streamable-HTTP ({url, headers?}).
 * Header values may reference the credential vault as "$cred:<id>"; the
 * reference itself is stored, the secret never touches disk. Tools from every
 * transport register through pi's approval pipeline unchanged.
 *
 * Pure transforms are exported separately from the file operations so tests
 * can exercise validation without touching disk.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeJsonFileAtomic } from "./config-file.js";

export const MCP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
export const MAX_NAME = 64;
export const MAX_COMMAND = 2048;
export const MAX_ARGS = 64;
export const MAX_ARG = 2048;
export const MAX_URL = 2048;
export const MAX_HEADERS = 16;
export const MAX_HEADER = 4096;

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

export function validateMcpUrl(url) {
  if (typeof url !== "string" || !url.trim()) throw invalid("url is required for a network MCP server");
  const trimmed = url.trim();
  if (trimmed.length > MAX_URL) throw invalid(`url must be at most ${MAX_URL} characters`);
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid("url must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw invalid("url must use http or https");
  return trimmed;
}

export function validateMcpHeaders(headers) {
  if (headers === undefined || headers === null) return {};
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw invalid("headers must be an object");
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) throw invalid(`headers must have at most ${MAX_HEADERS} entries`);
  const out = {};
  for (const [key, value] of entries) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]+$/.test(key) || key.length > 128) throw invalid("header names must be tokens");
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_HEADER || /[\r\n\0]/.test(value)) {
      throw invalid("header values must be non-empty strings without control characters");
    }
    out[key] = value;
  }
  return out;
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
export function upsertMcpServer(config, { name, command, args = [], url, headers = {}, enabled = true }) {
  const nextServers = { ...config.mcpServers };
  if (url !== undefined) {
    nextServers[name] = { url: validateMcpUrl(url), headers: validateMcpHeaders(headers), enabled: enabled !== false };
  } else {
    nextServers[name] = { command: validateMcpCommand(command), args: validateMcpArgs(args), enabled: enabled !== false };
  }
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
  const rowOf = (name, server, scope) => ({
    name,
    scope,
    enabled: server.enabled !== false,
    transport: server.url ? "http" : "stdio",
    ...(server.url ? { url: server.url } : { command: server.command, args: server.args ?? [] }),
    hasAuth: server.url ? Object.values(server.headers ?? {}).some((value) => typeof value === "string" && value.startsWith("$cred:")) : false,
  });
  for (const [name, server] of Object.entries(projectConfig?.mcpServers ?? {})) {
    rows.push(rowOf(name, server, "project"));
  }
  for (const [name, server] of Object.entries(userConfig?.mcpServers ?? {})) {
    if (projectConfig?.mcpServers?.[name]) continue; // project override wins; show one row
    rows.push(rowOf(name, server, "user"));
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function readConfigFile(file) {
  if (!file || !existsSync(file)) return null;
  return parseMcpConfig(readFileSync(file, "utf8"));
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
  writeJsonFileAtomic(file, next);
  return next;
}
