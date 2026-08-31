/**
 * P7 capability operation flows: parse skill / extension / MCP content into a
 * structured "trigger -> steps -> outputs" artifact.
 *
 * Deterministic parser (no LLM): reads SKILL.md-style frontmatter plus
 * Markdown headings/code fences and MCP server configs. The content hash is
 * the revision identity, so any content change yields a new revision — the
 * same contract as the repo/web sources.
 *
 * Pure module: no Electron, no network.
 */
import { createHash } from "node:crypto";

export const FLOW_SCHEMA_VERSION = 1;
const MAX_STEPS = 32;
const MAX_TRIGGERS = 8;
const MAX_OUTPUTS = 8;

function bounded(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function extractSteps(content) {
  const steps = [];
  // Markdown ordered/unordered list items and code-fence blocks become steps.
  const lines = content.split("\n");
  let inFence = false;
  for (const line of lines) {
    const fence = /^\s*```/.exec(line);
    if (fence) {
      inFence = !inFence;
      if (inFence) steps.push({ kind: "code", text: "执行代码块" });
      continue;
    }
    const list = /^\s*[-*]\s+(.+)$/.exec(line);
    if (list && !/^\s*[-*]\s*$/.test(line)) steps.push({ kind: "step", text: bounded(list[1].trim(), 512) });
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) steps.push({ kind: "step", text: bounded(numbered[1].trim(), 512) });
  }
  return steps.slice(0, MAX_STEPS);
}

function extractTriggers(content) {
  const triggers = [];
  for (const line of content.split("\n")) {
    const match = /^\s*(?:trigger|触发|when|当)[:：]\s*(.+)$/i.exec(line.trim());
    if (match) triggers.push(bounded(match[1].trim(), 256));
    if (triggers.length >= MAX_TRIGGERS) break;
  }
  if (triggers.length === 0) triggers.push("manual");
  return triggers;
}

function extractOutputs(content) {
  const outputs = [];
  for (const line of content.split("\n")) {
    const match = /^\s*(?:output|产出|result|生成)[:：]\s*(.+)$/i.exec(line.trim());
    if (match) outputs.push(bounded(match[1].trim(), 256));
    if (outputs.length >= MAX_OUTPUTS) break;
  }
  if (outputs.length === 0) outputs.push("完成");
  return outputs;
}

function parseFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return meta;
}

function contentHashOf(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Parse one capability's raw content into the structured flow artifact.
 * `kind` is skill | extension | mcp. The node revision id is content
 * addressed, so a changed file produces a new revision automatically.
 */
export function parseCapabilityFlow({ kind, name, content }) {
  if (typeof kind !== "string" || !["skill", "extension", "mcp"].includes(kind)) {
    throw Object.assign(new TypeError(`kind must be skill, extension or mcp`), { code: "invalid_args" });
  }
  if (typeof name !== "string" || name.length === 0 || name.length > 256) {
    throw Object.assign(new TypeError("name must be a non-empty string of at most 256 characters"), { code: "invalid_args" });
  }
  if (typeof content !== "string" || content.length === 0) {
    throw Object.assign(new TypeError("content must be a non-empty string"), { code: "invalid_args" });
  }
  const meta = parseFrontmatter(content);
  const description = meta.description ?? meta.name ?? name;
  const contentSha256 = contentHashOf(content);
  const artifact = {
    schemaVersion: FLOW_SCHEMA_VERSION,
    kind,
    name,
    description: bounded(description, 1024),
    contentSha256,
    triggers: extractTriggers(content),
    steps: extractSteps(content),
    outputs: extractOutputs(content),
    meta: Object.fromEntries(Object.entries(meta).filter(([key]) => key !== "description" && key !== "name")),
  };
  const nodeId = `capability:${kind}:${name}`;
  const nodeRevisionId = createHash("sha256").update(`capability-flow:${nodeId}:${contentSha256}`, "utf8").digest("hex");
  return { artifact, nodeId, nodeRevisionId };
}
