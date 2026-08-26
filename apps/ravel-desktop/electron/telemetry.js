/**
 * Session telemetry projection — turns and cache economics computed from the
 * authoritative JSONL branch. Mirrors pi-coding-agent's cache-miss semantics
 * (compaction resets the cacheable prefix; sub-noise misses don't count) so
 * the dashboard numbers mean the same thing as the CLI's.
 */
import { randomUUID } from "node:crypto";

const NOISE_FLOOR_TOKENS = 1024;

function usageOf(message) {
  const usage = message.usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    input: Number(usage.input) || 0,
    output: Number(usage.output) || 0,
    cacheRead: Number(usage.cacheRead) || 0,
    cacheWrite: Number(usage.cacheWrite) || 0,
    reasoning: Number(usage.reasoning) || 0,
    cost: Number(usage.cost?.total) || 0,
  };
}

/**
 * Per-turn rows plus session totals. Rows are oldest first; `tokensPerSecond`
 * is output tokens over the gap since the previous turn's completion (an
 * estimate — providers do not expose request duration).
 */
export function computeTelemetry(entries) {
  const turns = [];
  let previous = null;
  let previousTimestamp = null;
  let reportedCache = false;
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
    prompt: 0,
    wasteTokens: 0,
    missCount: 0,
  };

  if (!Array.isArray(entries)) return { totals, turns };

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    // Compaction legitimately changes the context: the next prompt is new
    // content, not re-billed content.
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      previous = null;
      continue;
    }
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const usage = usageOf(entry.message);
    if (!usage) continue;
    const timestamp = typeof entry.message.timestamp === "number" ? entry.message.timestamp : Date.parse(entry.message.timestamp);
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;

    let missedTokens = 0;
    if (previous !== null && promptTokens > 0 && (usage.cacheRead + usage.cacheWrite > 0 || reportedCache)) {
      missedTokens = Math.max(0, Math.min(previous, promptTokens) - usage.cacheRead);
      if (missedTokens <= NOISE_FLOOR_TOKENS) missedTokens = 0;
    }

    const secondsPerTurn =
      previousTimestamp !== null && Number.isFinite(timestamp) && timestamp > previousTimestamp
        ? (timestamp - previousTimestamp) / 1000
        : null;
    turns.push({
      id: typeof entry.id === "string" ? entry.id : `turn-${randomUUID()}`,
      ts: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      model: `${entry.message.provider ?? "?"}/${entry.message.model ?? "?"}`,
      ...usage,
      promptTokens,
      cacheHitRate: promptTokens > 0 ? usage.cacheRead / promptTokens : null,
      missedTokens,
      tokensPerSecond: secondsPerTurn !== null && secondsPerTurn > 0 ? Math.round((usage.output / secondsPerTurn) * 10) / 10 : null,
    });

    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    totals.reasoning += usage.reasoning;
    totals.cost += usage.cost;
    totals.prompt += promptTokens;
    if (missedTokens > 0) {
      totals.wasteTokens += missedTokens;
      totals.missCount += 1;
    }
    if (promptTokens > 0) {
      previous = promptTokens;
      previousTimestamp = Number.isFinite(timestamp) ? timestamp : previousTimestamp;
      reportedCache = reportedCache || usage.cacheRead + usage.cacheWrite > 0;
    }
  }

  totals.hitRate = totals.prompt > 0 ? totals.cacheRead / totals.prompt : null;
  totals.cost = Math.round(totals.cost * 10000) / 10000;
  turns.reverse(); // newest first for dashboard display
  return { totals, turns };
}
