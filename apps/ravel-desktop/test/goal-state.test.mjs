/**
 * GoalState + AutonomousGate contract tests (prime-agent `goals.ts` /
 * `autonomous.ts` shape).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createGoalState,
  recordGoalTurn,
  isGoalBudgetExceeded,
  isGoalTerminal,
  buildGoalStateEntry,
  parseGoalStateEntry,
  createAutonomousGateConfig,
  runAutonomousGate,
  GOAL_LIMITS,
} from "../electron/goal-state.js";

test("createGoalState seeds an active state with all counters at zero", () => {
  const state = createGoalState({ objective: "ship the fact graph", sessionId: "s1", startedAt: 1_000 });
  assert.equal(state.status, "active");
  assert.equal(state.rounds, 0);
  assert.equal(state.tokensUsed, 0);
  assert.equal(state.objective, "ship the fact graph");
  assert.equal(state.sessionId, "s1");
  assert.equal(state.roundCap, GOAL_LIMITS.GOAL_ROUND_CAP);
  assert.equal(state.elapsedCapMs, GOAL_LIMITS.GOAL_ELAPSED_CAP_MS);
});

test("recordGoalTurn flips the state to budget_limited once the cap is hit", () => {
  const state = createGoalState({ objective: "x", startedAt: Date.now() });
  for (let i = 0; i < GOAL_LIMITS.GOAL_ROUND_CAP; i += 1) recordGoalTurn(state, { tokensDelta: 0, timeDeltaMs: 0 });
  assert.equal(state.status, "budget_limited");
  assert.ok(isGoalBudgetExceeded(state));
  assert.ok(isGoalTerminal(state));
});

test("recordGoalTurn rejects negative deltas and counts time correctly", () => {
  const state = createGoalState({ objective: "x", startedAt: 0 });
  recordGoalTurn(state, { tokensDelta: 100, timeDeltaMs: 4_000, continuation: true });
  assert.equal(state.tokensUsed, 100);
  assert.equal(state.timeUsedSeconds, 4);
  assert.equal(state.continuationsUsed, 1);
});

test("buildGoalStateEntry round-trips through parseGoalStateEntry", () => {
  const state = createGoalState({ objective: "ship", sessionId: "s1", startedAt: 1 });
  const entry = buildGoalStateEntry(state, { entryId: "goal-1", lane: "main" });
  assert.equal(entry.type, "ravel_record");
  assert.equal(entry.customType, "thread_goal_state");
  assert.equal(entry.entryId, "goal-1");
  const parsed = parseGoalStateEntry(entry);
  assert.deepEqual(parsed, state);
});

test("parseGoalStateEntry returns null on unknown customType or status", () => {
  const state = createGoalState({ objective: "x" });
  const entry = buildGoalStateEntry(state, { entryId: "goal-1" });
  assert.equal(parseGoalStateEntry({ ...entry, customType: "other" }), null);
  assert.equal(parseGoalStateEntry({ ...entry, data: { ...state, status: "wrong" } }), null);
});

test("createAutonomousGateConfig validates commands and retries", () => {
  assert.throws(() => createAutonomousGateConfig({ commands: [] }), /non-empty/);
  const cfg = createAutonomousGateConfig({ commands: ["npm run check"], maxRetries: 3, backoffMs: 0 });
  assert.equal(cfg.commands.length, 1);
  assert.equal(cfg.maxRetries, 3);
});

test("runAutonomousGate returns passed on first success and surfaces failures with backoff", async () => {
  const cfg = createAutonomousGateConfig({ commands: ["true"], maxRetries: 2, backoffMs: 0 });
  const sleepCalls = [];
  const result = await runAutonomousGate(cfg, {
    exec: async () => ({ ok: true, code: 0 }),
    sleep: (ms) => { sleepCalls.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.result, "passed");
  assert.equal(result.attempts, 1);
  assert.equal(sleepCalls.length, 0);
});

test("runAutonomousGate retries with backoff and reports retry_exhausted", async () => {
  const cfg = createAutonomousGateConfig({ commands: ["false"], maxRetries: 2, backoffMs: 5 });
  const sleepCalls = [];
  const result = await runAutonomousGate(cfg, {
    exec: async () => ({ ok: false, code: 1 }),
    sleep: (ms) => { sleepCalls.push(ms); return Promise.resolve(); },
  });
  assert.equal(result.result, "retry_exhausted");
  assert.equal(result.attempts, 3);
  assert.equal(sleepCalls.length, 2);
  assert.equal(result.lastFailure.code, 1);
});
