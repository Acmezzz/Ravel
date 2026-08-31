/**
 * P6 graph conversations: selection prompt builder + evidence expansion.
 *
 * Progressive disclosure for selection conversations: L0 skeleton (selected
 * subgraph structure, near-zero cost, always injected), L1 distilled titles
 * (secondary default) and L2 original text (on demand, budget-guarded).
 *
 * Pure module: no Electron, no IO except the JSONL reader passed in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_EXPAND_BUDGET = 32_000;
export const MAX_EXPAND_BUDGET = 128_000;
const MAX_SELECTION_NODES = 512;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "invalid_args";
  return error;
}

/**
 * Build the L0+L1 selection prompt. L0 is the skeleton (kind + title +
 * relationship edges); L1 is the distilled layer — it carries the nodes'
 * `summary`/`distill` text (condenseGraph/distill products) and explicitly
 * omits nodes without one, so L1 is real information gain over L0, not a
 * re-listing. Both layers are cheap and their byte cost is the enforceable
 * part of the promise that a selection conversation starts with structure,
 * not raw text.
 */
export function buildSelectionPrompt(input = {}) {
  if (!input || typeof input !== "object") throw invalid("selection prompt input must be an object");
  const nodes = Array.isArray(input.nodes) ? input.nodes.slice(0, MAX_SELECTION_NODES) : [];
  const edges = Array.isArray(input.edges) ? input.edges.slice(0, MAX_SELECTION_NODES) : [];
  const title = typeof input.title === "string" && input.title.length > 0 ? input.title.slice(0, 200) : "选中子图";
  const skeleton = nodes
    .map((node) => `- [${node.kind ?? "node"}] ${node.title ?? node.nodeId ?? node.nodeRevisionId}`)
    .join("\n");
  const edgeLines = edges
    .map((edge) => {
      const src = edge.srcNodeId ?? edge.srcNodeRevisionId ?? "";
      const dst = edge.dstNodeId ?? edge.dstNodeRevisionId ?? "";
      const srcLabel = nodes.find((node) => (node.nodeId ?? node.nodeRevisionId) === src)?.title ?? src;
      const dstLabel = nodes.find((node) => (node.nodeId ?? node.nodeRevisionId) === dst)?.title ?? dst;
      return `- ${edge.kind ?? "edge"}: ${srcLabel} → ${dstLabel}`;
    })
    .join("\n");
  const distilled = nodes
    .map((node) => {
      const summary = typeof node.summary === "string" && node.summary.length > 0 ? node.summary : typeof node.distill === "string" && node.distill.length > 0 ? node.distill : null;
      if (summary === null) return null;
      const label = node.title ?? node.nodeId ?? node.nodeRevisionId ?? "?";
      const bounded = summary.length > 512 ? `${summary.slice(0, 512)}…` : summary;
      return `- ${label}: ${bounded}`;
    })
    .filter((line) => line !== null);
  const lines = [
    `选区：${title}（${nodes.length} 节点 / ${edges.length} 边）`,
    "",
    "## L0 骨架",
    skeleton || "(空选区)",
    "",
    "## L1 凝练",
    ...(distilled.length > 0 ? distilled : ["(本选区无凝练摘要；需要细节时经 histos_expand 拉取原文)"]),
    "",
    "## 关系边",
    edgeLines || "(无关系边)",
    "",
    "说明：以上为 L0 骨架 + L1 凝练，原文（L2）不在此 prompt 中。需要细节时经 histos_expand 按 FactAddress 拉取，超预算会 fail-closed。",
  ];
  return lines.join("\n");
}

/** Byte size of a selection prompt — the enforceable "skeleton is near-zero" promise. */
export function selectionPromptBytes(prompt) {
  return Buffer.byteLength(prompt, "utf8");
}

/**
 * Extract span-level original text for a FactAddress (L2).
 *
 * `reader({ sessionId, entryId })` returns the entry text or null; the
 * caller supplies it so this module stays IO-free. A span selector
 * (utf-8 byte offset + length) slices the entry text; without a selector
 * the whole entry text is returned. Budget is enforced fail-closed: an
 * extraction that would exceed the budget is rejected, never truncated
 * silently.
 */
export function expandEvidence(input = {}, reader) {
  if (!input || typeof input !== "object") throw invalid("expand input must be an object");
  const sessionId = typeof input.sessionId === "string" && input.sessionId ? input.sessionId : null;
  const entryId = typeof input.entryId === "string" && input.entryId ? input.entryId : null;
  if (!sessionId || !entryId) throw invalid("expand requires sessionId and entryId");
  const budget = input.budget === undefined ? DEFAULT_EXPAND_BUDGET : input.budget;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_EXPAND_BUDGET) throw invalid(`budget must be between 1 and ${MAX_EXPAND_BUDGET}`);
  if (typeof reader !== "function") throw invalid("expand requires a reader function");
  const text = reader({ sessionId, entryId });
  if (typeof text !== "string") return { ok: false, code: "not_found", message: `entry ${sessionId}/${entryId} not found` };
  const selector = input.selector;
  let extracted = text;
  if (selector && typeof selector === "object") {
    if (selector.kind === "span" && Number.isSafeInteger(selector.start) && Number.isSafeInteger(selector.length)) {
      const start = Math.max(0, selector.start);
      const length = Math.max(0, selector.length);
      extracted = Buffer.from(text, "utf8").subarray(start, start + length).toString("utf8");
    } else if (selector.kind !== "span") {
      return { ok: false, code: "invalid_selector", message: `unsupported selector kind ${selector.kind}` };
    }
  }
  const bytes = Buffer.byteLength(extracted, "utf8");
  if (bytes > budget) {
    return {
      ok: false,
      code: "budget_exceeded",
      message: `expansion ${bytes} bytes exceeds budget ${budget}; reduce the selection or raise the budget`,
      bytes,
      budget,
    };
  }
  return { ok: true, text: extracted, bytes, budget, sessionId, entryId };
}

/** Read one entry's message text from a session JSONL file. */
export function jsonlEntryReader(sessionsRoot) {
  if (typeof sessionsRoot !== "string" || sessionsRoot.length === 0) throw invalid("sessionsRoot is required");
  return ({ sessionId, entryId }) => {
    try {
      const file = join(sessionsRoot, `${sessionId}.jsonl`);
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.id !== entryId && entry.entryId !== entryId) continue;
        const content = entry.message?.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content.map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : "")).join("");
        }
        return null;
      }
      return null;
    } catch {
      return null;
    }
  };
}

