import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { appendContextAttachedFact, appendFact, argsDigestOf, closeStaleApprovals, closeStaleOperations, pendingApprovalAsks, pendingOperations, readFacts, unfinishedFinishFor, unavailableDecisionFor } from "../electron/session-facts.js";
import { createPermissionGuard } from "../electron/permission-profiles.js";

function fakeSessionManager() {
  const entries = [];
  let nextId = 0;
  return {
    entries,
    appended: [],
    failAppends: false,
    getLeafId: () => null,
    getEntries: () => entries,
    appendCustomEntry(customType, data) {
      if (this.failAppends) throw new Error("disk full");
      const entry = { type: "custom", customType, data, id: `entry-${++nextId}` };
      entries.push(entry);
      this.appended.push(data);
      return entry.id;
    },
  };
}

function askedFact(overrides = {}) {
  return {
    type: "approval_asked",
    id: overrides.id ?? "ask-1",
    lane: "main",
    runId: overrides.runId ?? "op-1",
    toolCallId: overrides.toolCallId ?? "call-1",
    toolName: overrides.toolName ?? "bash",
    argsDigest: overrides.argsDigest ?? "sha256:abc",
    timestamp: 1,
  };
}

/** Guard wired to a fake session manager; records every durable append. */
function guardHarness({ answer }) {
  const sessionManager = fakeSessionManager();
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/workspace",
    confirm: async () => answer,
    facts: {
      runId: () => "op-1",
      appendAsked: (asked) => appendFact(sessionManager, asked),
      appendDecided: (decided) => appendFact(sessionManager, decided),
    },
  });
  return { guard, sessionManager };
}

const bashEvent = { toolCall: { name: "bash", id: "call-1" }, args: { command: "npm test" } };

test("argsDigestOf is stable across key order and differs by content", () => {
  const first = argsDigestOf({ command: "npm test", path: "/w/a" });
  const second = argsDigestOf({ path: "/w/a", command: "npm test" });
  assert.equal(first, second);
  assert.notEqual(first, argsDigestOf({ command: "npm run build", path: "/w/a" }));
});

test("appendFact validates the shared record shape before writing", () => {
  const sm = fakeSessionManager();
  assert.throws(() =>
    appendFact(sm, { type: "approval_decided", id: "d1", lane: "main", runId: "r", toolCallId: "c", askedId: "a", outcome: "maybe" }),
  );
  assert.equal(sm.appended.length, 0);
  assert.throws(() => appendFact(sm, { type: "nonsense", id: "x", lane: "main" }));
  assert.equal(sm.appended.length, 0);
  // Explainability fields are validated when present and rejected when malformed...
  assert.throws(() => appendFact(sm, { ...askedFact(), policyProfile: "" }));
  assert.throws(() =>
    appendFact(sm, { type: "approval_decided", id: "d2", lane: "main", runId: "r", toolCallId: "c", askedId: "a", outcome: "rejected", reasonCode: "because" }),
  );
  assert.equal(sm.appended.length, 0);
  // ...and legacy records without them remain writable/readable.
  assert.doesNotThrow(() => appendFact(sm, askedFact()));
  assert.doesNotThrow(() =>
    appendFact(sm, { type: "approval_decided", id: "d3", lane: "main", runId: "r", toolCallId: "c", askedId: "a", outcome: "rejected" }),
  );
  assert.equal(sm.appended.length, 2);
});

test("context_attached facts require a content-addressed context artifact", () => {
  const sm = fakeSessionManager();
  const contextSha = "a".repeat(64);
  assert.doesNotThrow(() => appendContextAttachedFact(sm, { targetSessionId: "target-session", contextSha }));
  assert.deepEqual(readFacts(sm).map((fact) => fact.type), ["context_attached"]);
  assert.equal(readFacts(sm)[0].contextSha, contextSha);
  assert.throws(() => appendContextAttachedFact(sm, { targetSessionId: "target-session", contextSha: "bad" }));
  assert.throws(() => appendContextAttachedFact(sm, { targetSessionId: "", contextSha }));
  assert.equal(sm.appended.length, 1);
});

test("readFacts returns persisted approval and operation records oldest first", () => {
  const sm = fakeSessionManager();
  appendFact(sm, {
    type: "operation_started",
    id: "op-1",
    lane: "main",
    sourceLeafId: null,
    intent: { kind: "run", originalPrompt: [], initialMessages: [] },
    timestamp: 1,
  });
  appendFact(sm, askedFact());
  appendFact(sm, { type: "approval_decided", id: "decide-1", lane: "main", runId: "op-1", toolCallId: "call-1", askedId: "ask-1", outcome: "rejected", timestamp: 2 });
  sm.entries.push({ type: "custom", customType: "unrelated", data: { type: "approval_asked", id: "noise" }, id: "entry-x" });

  assert.deepEqual(
    readFacts(sm).map((fact) => fact.type),
    ["operation_started", "approval_asked", "approval_decided"],
  );
});

test("pending asks are detected and closed as unavailable on recovery", () => {
  const sm = fakeSessionManager();
  appendFact(sm, askedFact({ id: "ask-1" }));
  appendFact(sm, askedFact({ id: "ask-2" }));
  appendFact(sm, { type: "approval_decided", id: "decide-2", lane: "main", runId: "op-1", toolCallId: "call-1", askedId: "ask-2", outcome: "rejected", timestamp: 2 });

  const pending = pendingApprovalAsks(readFacts(sm));
  assert.deepEqual(pending.map((ask) => ask.id), ["ask-1"]);
  const decision = unavailableDecisionFor(pending[0]);
  assert.match(decision.id, /.+/);
  assert.equal(decision.outcome, "unavailable");
  assert.equal(decision.askedId, "ask-1");

  assert.equal(closeStaleApprovals(sm), 1);
  const decidedIds = readFacts(sm).filter((fact) => fact.type === "approval_decided").map((fact) => fact.askedId);
  assert.deepEqual(decidedIds.sort(), ["ask-1", "ask-2"]);
  // Second pass is a no-op: no ask stays undecided.
  assert.equal(closeStaleApprovals(sm), 0);
});

test("allowed-once persists both facts and lets the tool through", async () => {
  const { guard, sessionManager } = guardHarness({ answer: true });
  await assert.doesNotReject(() => guard(bashEvent));
  assert.deepEqual(
    sessionManager.appended.map((fact) => fact.type),
    ["approval_asked", "approval_decided"],
  );
  assert.equal(sessionManager.appended[1].outcome, "allowed-once");
  assert.equal(sessionManager.appended[1].toolCallId, "call-1");
  assert.equal(sessionManager.appended[1].runId, "op-1");
  // Decision explainability: the ask records the effective policy profile and
  // the decision records why it happened.
  assert.equal(sessionManager.appended[0].policyProfile, "ask-before-command");
  assert.equal(sessionManager.appended[1].reasonCode, "user-allowed");
});

test("explicit deny persists rejected and blocks execution", async () => {
  const { guard, sessionManager } = guardHarness({ answer: false });
  await assert.rejects(() => guard(bashEvent), /拒绝/);
  assert.deepEqual(
    sessionManager.appended.map((fact) => fact.type),
    ["approval_asked", "approval_decided"],
  );
  assert.equal(sessionManager.appended[1].outcome, "rejected");
  assert.equal(sessionManager.appended[1].reasonCode, "user-denied");
});

test("UI cancel and timeout persist cancelled / unavailable without allowing", async () => {
  for (const [answer, outcome, reasonCode, message] of [
    [{ cancelled: true }, "cancelled", "ui-cancelled", /取消/],
    [{ timedOut: true }, "unavailable", "timeout", /fail-closed|无法获得审批/],
  ]) {
    const { guard, sessionManager } = guardHarness({ answer });
    await assert.rejects(() => guard(bashEvent), message);
    assert.equal(sessionManager.appended.at(-1).outcome, outcome);
    assert.equal(sessionManager.appended.at(-1).reasonCode, reasonCode);
  }
});

test("the durable decision carries the interactive UI request id when one was issued", async () => {
  const sessionManager = fakeSessionManager();
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/workspace",
    confirm: async (_title, _message, onIssued) => {
      onIssued?.("ui-req-7");
      return true;
    },
    facts: {
      runId: () => "op-1",
      appendAsked: (asked) => appendFact(sessionManager, asked),
      appendDecided: (decided) => appendFact(sessionManager, decided),
    },
  });
  await assert.doesNotReject(() => guard(bashEvent));
  assert.equal(sessionManager.appended.at(-1).uiRequestId, "ui-req-7");
});

test("confirm throwing counts as unavailable, never as allow", async () => {
  const sessionManager = fakeSessionManager();
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/workspace",
    confirm: async () => {
      throw new Error("ui exploded");
    },
    facts: {
      runId: () => "op-1",
      appendAsked: (asked) => appendFact(sessionManager, asked),
      appendDecided: (decided) => appendFact(sessionManager, decided),
    },
  });
  await assert.rejects(() => guard(bashEvent));
  assert.equal(sessionManager.appended.at(-1).outcome, "unavailable");
});

test("ask append failure denies without recording anything", async () => {
  const sessionManager = fakeSessionManager();
  sessionManager.failAppends = true;
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/workspace",
    confirm: async () => true,
    facts: {
      runId: () => "op-1",
      appendAsked: (asked) => appendFact(sessionManager, asked),
      appendDecided: (decided) => appendFact(sessionManager, decided),
    },
  });
  await assert.rejects(() => guard(bashEvent), /审批事实写入失败/);
});

test("decided append failure never returns an unrecorded allow", async () => {
  const sessionManager = fakeSessionManager();
  let failNextDecide = false;
  const guard = createPermissionGuard({
    profile: "ask-before-command",
    cwd: "/workspace",
    confirm: async () => true,
    facts: {
      runId: () => "op-1",
      appendAsked: (asked) => appendFact(sessionManager, asked),
      appendDecided: (decided) => {
        if (decided.outcome === "allowed-once") throw new Error("disk full");
        return appendFact(sessionManager, decided);
      },
    },
  });
  await assert.rejects(() => guard(bashEvent), /未能落盘/);
  assert.equal(failNextDecide, false);
  // The ask exists but no allow leaked into an execution.
  const decided = readFacts(sessionManager).filter((fact) => fact.type === "approval_decided");
  assert.equal(decided.length, 0);
});

function operationStartedFact(id, overrides = {}) {
  return {
    type: "operation_started",
    id,
    lane: "main",
    sourceLeafId: null,
    intent: overrides.intent ?? { kind: "run", originalPrompt: [], initialMessages: [] },
    timestamp: 1,
  };
}

test("open operations left by a dead worker are terminalized as failed on recovery", () => {
  const sm = fakeSessionManager();
  appendFact(sm, operationStartedFact("op-1"));
  appendFact(sm, operationStartedFact("op-compaction", { intent: { kind: "compaction", resultEntryId: "entry-c1" } }));
  appendFact(sm, operationStartedFact("op-done"));
  appendFact(sm, { type: "operation_finished", id: "finish-op-done", lane: "main", runId: "op-done", outcome: "completed", timestamp: 2 });

  assert.deepEqual(pendingOperations(readFacts(sm)).map((fact) => fact.id), ["op-1", "op-compaction"]);
  const finish = unfinishedFinishFor(pendingOperations(readFacts(sm))[0]);
  assert.equal(finish.outcome, "failed");
  assert.equal(finish.error?.code, "worker_recovered_unfinished");
  assert.equal(finish.runId, "op-1");

  assert.equal(closeStaleOperations(sm), 2);
  const finishedIds = readFacts(sm).filter((fact) => fact.type === "operation_finished").map((fact) => fact.runId);
  assert.deepEqual(finishedIds.sort(), ["op-1", "op-compaction", "op-done"]);
  // Idempotent: a second recovery pass finds nothing open.
  assert.equal(closeStaleOperations(sm), 0);
});

test("session-facts.js is the only writer of durable facts (static single-writer assertion)", async () => {
  const offenders = [];
  const electronDir = new URL("../electron/", import.meta.url);
  for (const entry of await readdir(electronDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|mjs)$/.test(entry.name) || entry.name === "session-facts.js") continue;
    const source = await readFile(new URL(`../electron/${entry.name}`, import.meta.url), "utf8");
    if (/appendCustomEntry\s*\(/.test(source)) offenders.push(entry.name);
  }
  assert.deepEqual(offenders, []);
});
