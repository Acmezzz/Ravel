import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createActivityTracker } from "../electron/activity-service.js";
import { deriveActivityFromFacts } from "../electron/session-facts.js";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("activity tracker derives waiting > running > failed > done", () => {
  const tracker = createActivityTracker();
  assert.equal(tracker.applyEvent("s1", { type: "agent_start" }), true);
  let row = tracker.rows().find((item) => item.sessionId === "s1");
  assert.equal(row.status, "running");

  // A pending approval ask outranks the open run.
  tracker.applyAsk("s1", "ask-1", 60_000);
  row = tracker.rows().find((item) => item.sessionId === "s1");
  assert.equal(row.status, "waiting");
  assert.equal(row.pendingApprovals, 1);

  // Settling the ask returns the row to the still-open run.
  assert.equal(tracker.applyDecide("ask-1"), true);
  row = tracker.rows().find((item) => item.sessionId === "s1");
  assert.equal(row.status, "running");
  assert.equal(row.pendingApprovals, 0);

  tracker.applyEvent("s1", { type: "agent_settled" });
  row = tracker.rows().find((item) => item.sessionId === "s1");
  assert.equal(row.status, "done");
  assert.equal(row.lastOutcome, "completed");
});

test("activity tracker records errors and worker death as failed", () => {
  const tracker = createActivityTracker();
  tracker.applyEvent("s1", { type: "agent_start" });
  tracker.applyEvent("s1", { type: "error", message: "boom" });
  let row = tracker.rows().find((item) => item.sessionId === "s1");
  assert.equal(row.status, "failed");
  assert.equal(row.lastError, "boom");

  tracker.forget("s1");
  assert.equal(tracker.has("s1"), false);

  tracker.applyEvent("s2", { type: "agent_start" });
  tracker.applyTransport("s2", "dead");
  row = tracker.rows().find((item) => item.sessionId === "s2");
  assert.equal(row.status, "failed");
  assert.match(row.lastError, /worker/);
});

test("successful retry keeps the run open; failed retry fails it", () => {
  const tracker = createActivityTracker();
  tracker.applyEvent("s1", { type: "agent_start" });
  assert.equal(tracker.applyEvent("s1", { type: "auto_retry_end", status: "done" }), false);
  assert.equal(tracker.rows().find((r) => r.sessionId === "s1").status, "running");

  tracker.applyEvent("s2", { type: "agent_start" });
  tracker.applyEvent("s2", { type: "auto_retry_end", status: "error", finalError: "rate limited" });
  const row = tracker.rows().find((r) => r.sessionId === "s2");
  assert.equal(row.status, "failed");
  assert.equal(row.lastError, "rate limited");
});

test("blocking UI asks time out like the worker modal mirror", async () => {
  let settled = [];
  let current = 0;
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (fn, ms) => {
    timers.push({ fn, at: current + ms });
    return { unref() {} };
  };
  try {
    const tracker = createActivityTracker({
      now: () => current,
      onSettleTimeout: (sessionId, askId, outcome) => settled.push([sessionId, askId, outcome]),
    });
    tracker.applyAsk("s1", "ask-1", 60_000);
    assert.equal(tracker.rows().find((r) => r.sessionId === "s1").status, "waiting");
    current += 61_000;
    for (const timer of [...timers]) {
      if (timer.at <= current && !timer.done) {
        timer.done = true;
        timer.fn();
      }
    }
    assert.equal(tracker.rows().find((r) => r.sessionId === "s1").status, "done");
    assert.deepEqual(settled, [["s1", "ask-1", "timeout"]]);
    // Deciding after the timeout is a no-op.
    assert.equal(tracker.applyDecide("ask-1"), false);
    void realSetTimeout;
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("deriveActivityFromFacts mirrors live semantics from durable facts", () => {
  const startedAt = 1_000;
  const finishedAt = 2_000;
  const facts = [
    { type: "operation_started", id: "op-1", lane: "main", intent: { kind: "run", originalPrompt: [], initialMessages: [] }, timestamp: startedAt },
    { type: "operation_finished", id: "finish-op-1", lane: "main", runId: "op-1", outcome: "completed", timestamp: finishedAt },
    { type: "approval_asked", id: "ask-1", lane: "main", runId: "op-1", toolCallId: "tc-1", toolName: "bash", argsDigest: "sha256:x", timestamp: startedAt + 100 },
    { type: "approval_decided", id: "d-1", lane: "main", runId: "op-1", toolCallId: "tc-1", askedId: "ask-1", outcome: "allowed-once", timestamp: startedAt + 200 },
  ];
  const done = deriveActivityFromFacts(facts);
  assert.equal(done.status, "done");
  assert.equal(done.lastOutcome, "completed");

  // Undecided ask wins over everything else.
  const waiting = deriveActivityFromFacts([...facts.slice(0, -1)]);
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.pendingApprovals, 1);

  // Open run without finish is running.
  const running = deriveActivityFromFacts([facts[0]]);
  assert.equal(running.status, "running");

  // Failed terminal outcome.
  const failed = deriveActivityFromFacts([
    facts[0],
    { type: "operation_finished", id: "f2", lane: "main", runId: "op-1", outcome: "failed", error: { code: "x", message: "nope" }, timestamp: finishedAt },
  ]);
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "nope");

  assert.equal(deriveActivityFromFacts([]), null);
  assert.equal(deriveActivityFromFacts(null), null);
});

test("renderer projection module keeps cleared signatures out of facts", async () => {
  const lib = await read("../src/renderer/lib/activity-projection.ts");
  assert.match(lib, /CLEARED_KEY = "ravel\.activity\.cleared"/);
  assert.match(lib, /export function attentionCount/);
  assert.match(lib, /export function filterRows/);
  assert.match(lib, /export function activitySignature/);
  assert.doesNotMatch(lib, /appendFact|session-facts/);
});
