import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentRunRecord, createAgentLoopExecutor } from "../electron/histos-agent-loop-executor.js";

test("agent-loop adapter reuses the worker prompt session", async () => {
  const calls = [];
  const executor = createAgentLoopExecutor({
    getWorker: () => ({ state: "ready", call: async (...args) => { calls.push(args); return null; } }),
  });
  const result = await executor.execute({
    plan: { executor: "agent-loop", surface: "session", wired: true, units: [{ prompt: "ship it", tools: ["read"] }] },
  });
  assert.equal(result.executed, true);
  assert.deepEqual(calls, [["prompt", { text: "ship it", behavior: "followUp" }]]);
});

test("agent-loop adapter refuses busy and uncertain plans", async () => {
  const executor = createAgentLoopExecutor({ getWorker: () => ({ state: "ready" }), isBusy: () => true });
  await assert.rejects(() => executor.execute({ plan: { executor: "agent-loop", surface: "session", wired: true, units: [{ prompt: "go" }] } }), (error) => error.code === "session_busy");
  await assert.rejects(() => executor.execute({ plan: { executor: "agent-loop", surface: "session", wired: true, units: [] } }), (error) => error.code === "uncertain_execution");
});

test("agent-loop adapter preserves dry-run without touching worker", async () => {
  let called = false;
  const executor = createAgentLoopExecutor({ getWorker: () => { called = true; return null; } });
  const result = await executor.execute({ plan: { executor: "agent-loop", surface: "session", wired: true, units: [{ prompt: "inspect" }] }, dryRun: true });
  assert.deepEqual(result, { executed: false, dryRun: true, method: null });
  assert.equal(called, false);
});

test("run records preserve outcome status, identity, output and timing", () => {
  const plan = { plan: { specName: "build", specRevisionId: "a".repeat(64), strategy: "single", units: [{ key: "build", spec: "build", prompt: "ship" }] }, executionRequest: { unit: { key: "build", spec: "build", prompt: "ship" } } };
  const run = buildAgentRunRecord({ plan, execution: { result: { text: "done", sessionId: "s1" } }, input: "ship", startedAt: 10, endedAt: 20 });
  assert.deepEqual({ status: run.status, output: run.output, sessionId: run.sessionId, startedAt: run.startedAt, endedAt: run.endedAt, specRevisionId: run.specRevisionId }, { status: "success", output: "done", sessionId: "s1", startedAt: 10, endedAt: 20, specRevisionId: "a".repeat(64) });
  const failed = buildAgentRunRecord({ plan, error: Object.assign(new Error("busy"), { code: "session_busy" }), startedAt: 10, endedAt: 12 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "session_busy");
});
