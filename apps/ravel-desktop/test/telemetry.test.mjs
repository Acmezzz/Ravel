import test from "node:test";
import assert from "node:assert/strict";
import { computeTelemetry } from "../electron/telemetry.js";

function assistantEntry(id, timestamp, usage, provider = "anthropic", model = "claude-test") {
  return {
    type: "message",
    id,
    message: { role: "assistant", id, timestamp, provider, model, usage },
  };
}

test("telemetry totals accumulate tokens, prompt and cost across turns", () => {
  const { totals, turns } = computeTelemetry([
    assistantEntry("a1", 1000, { input: 10, output: 20, cacheRead: 70, cacheWrite: 0, reasoning: 5, cost: { total: 0.01 } }),
    assistantEntry("a2", 5000, { input: 12, output: 30, cacheRead: 80, cacheWrite: 8, reasoning: 6, cost: { total: 0.02 } }),
  ]);
  assert.equal(totals.input, 22);
  assert.equal(totals.output, 50);
  assert.equal(totals.cacheRead, 150);
  assert.equal(totals.cacheWrite, 8);
  assert.equal(totals.prompt, 22 + 150 + 8);
  assert.equal(Math.abs(totals.hitRate - 150 / 180) < 1e-9, true);
  assert.equal(turns.length, 2);
});

test("cache misses follow pi semantics: noise floor, compaction reset, cold start", () => {
  // Turn 2's prompt is 15000 tokens; only 13500 came from cache. The previous
  // prompt was 20000, so min(20000, 15000) - 13500 = 1500 tokens were re-billed.
  const withMiss = computeTelemetry([
    assistantEntry("a1", 1000, { input: 5000, output: 10, cacheRead: 15000, cacheWrite: 0 }),
    assistantEntry("a2", 2000, { input: 1500, output: 10, cacheRead: 13500, cacheWrite: 0 }),
  ]);
  assert.equal(withMiss.turns.find((turn) => turn.id === "a2").missedTokens, 1500);
  assert.equal(withMiss.totals.wasteTokens, 1500);
  assert.equal(withMiss.totals.missCount, 1);

  // Sub-noise misses (<= 1024 tokens) are not counted.
  const tinyMiss = computeTelemetry([
    assistantEntry("a1", 1000, { input: 0, output: 1, cacheRead: 20000, cacheWrite: 0 }),
    assistantEntry("a2", 2000, { input: 0, output: 1, cacheRead: 19999, cacheWrite: 0 }),
  ]);
  assert.equal(tinyMiss.totals.wasteTokens, 0);

  // Compaction resets the chain: the next turn is a new prefix, not waste.
  const afterCompaction = computeTelemetry([
    assistantEntry("a1", 1000, { input: 50, output: 1, cacheRead: 150, cacheWrite: 0 }),
    { type: "compaction", id: "c1" },
    assistantEntry("a2", 3000, { input: 400, output: 1, cacheRead: 0, cacheWrite: 0 }),
  ]);
  assert.equal(afterCompaction.totals.wasteTokens, 0);

  // The very first turn never counts as a miss even with zero cache reads.
  const firstTurn = computeTelemetry([assistantEntry("a1", 1000, { input: 400, output: 1, cacheRead: 0, cacheWrite: 0 })]);
  assert.equal(firstTurn.totals.missCount, 0);
});

test("tokens per second derives from inter-turn gaps and turns come newest first", () => {
  const { turns } = computeTelemetry([
    assistantEntry("a1", 1000, { input: 10, output: 100, cacheRead: 0, cacheWrite: 0 }),
    assistantEntry("a2", 3000, { input: 10, output: 60, cacheRead: 0, cacheWrite: 0 }),
  ]);
  assert.equal(turns[0].id, "a2");
  assert.equal(turns[turns.length - 1].id, "a1");
  // a2 produced 60 tokens over a 2s gap.
  assert.equal(turns[0].tokensPerSecond, 30);
  // First turn has no predecessor gap.
  assert.equal(turns[1].tokensPerSecond, null);
});
