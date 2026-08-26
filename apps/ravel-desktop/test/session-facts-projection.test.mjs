import test from "node:test";
import assert from "node:assert/strict";
import { FACT_CUSTOM_TYPE, appendFact } from "../electron/session-facts.js";
import { sanitizeTranscript } from "../electron/agent-bridge.js";

function fakeSessionManager(branch) {
  return { getBranch: () => branch };
}

function entry(type, id, extra = {}) {
  return { type, id, timestamp: "2026-08-26T00:00:00.000Z", ...extra };
}

const assistantWithToolCall = entry("message", "entry-assistant", {
  message: {
    role: "assistant",
    id: "assistant-1",
    content: [{ type: "toolCall", id: "call-1", name: "edit", arguments: { path: "/w/a.ts", edits: [{ oldText: "let x = 1;", newText: "const x = 1;" }] } }],
    timestamp: 2,
  },
});

test("sanitizeTranscript projects operations, approvals, markers onto cards", () => {
  const sm = fakeSessionManager([
    entry("message", "entry-user-1", { message: { role: "user", id: "user-1", content: [{ type: "text", text: "do it" }], timestamp: 0 } }),
    entry("message", "entry-compaction-anchor", { message: { role: "assistant", id: "assistant-old", content: [{ type: "text", text: "old" }], timestamp: 1 } }),
    entry("compaction", "entry-compaction", { summary: "s", firstKeptEntryId: "x", tokensBefore: 10 }),
    entry("custom", "entry-op-start", { customType: FACT_CUSTOM_TYPE, data: { type: "operation_started", id: "op-1", lane: "main", sourceLeafId: null, intent: { kind: "run", originalPrompt: [], initialMessages: [] }, timestamp: Date.parse("2026-08-26T01:00:00.000Z") } }),
    assistantWithToolCall,
    entry("message", "entry-tool-result", { message: { role: "toolResult", toolCallId: "call-1", toolName: "edit", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 } }),
    entry("custom", "entry-ask", { customType: FACT_CUSTOM_TYPE, data: { type: "approval_asked", id: "ask-1", lane: "main", runId: "op-1", toolCallId: "call-1", toolName: "edit", argsDigest: "sha256:x", timestamp: 4 } }),
    entry("custom", "entry-decide", { customType: FACT_CUSTOM_TYPE, data: { type: "approval_decided", id: "decide-1", lane: "main", runId: "op-1", toolCallId: "call-1", askedId: "ask-1", outcome: "rejected", timestamp: 5 } }),
    entry("custom", "entry-op-finish", { customType: FACT_CUSTOM_TYPE, data: { type: "operation_finished", id: "finish-op-1", lane: "main", runId: "op-1", outcome: "completed", timestamp: 6 } }),
    // Unrelated extension entries must be ignored.
    entry("custom", "entry-noise", { customType: "other_extension", data: { type: "approval_asked", id: "noise" } }),
  ]);

  const result = sanitizeTranscript({ sessionManager: sm });

  // Compaction marker anchors to the last message before it.
  assert.deepEqual(result.markers, [
    { kind: "compaction", entryId: "entry-compaction", afterEntryId: "entry-compaction-anchor", ts: "2026-08-26T00:00:00.000Z" },
  ]);

  const operation = result.operations.find((item) => item.id === "op-1");
  assert.ok(operation);
  assert.equal(operation.status, "completed");
  assert.equal(operation.finishedAt, new Date(6).toISOString());

  assert.deepEqual(
    result.approvals.map((approval) => [approval.askedId, approval.outcome]),
    [["ask-1", "rejected"]],
  );

  const card = result.toolCards.find((item) => item.toolCallId === "call-1");
  assert.ok(card);
  assert.equal(card.approval, "rejected");

  // Original transcript entries survive untouched (A11).
  assert.deepEqual(
    result.messages.map((message) => message.entryId),
    ["entry-user-1", "entry-compaction-anchor", "entry-assistant"],
  );
});

test("sanitizeTranscript keeps an open operation and undecided approval as such", () => {
  const sm = fakeSessionManager([
    entry("message", "entry-u", { message: { role: "user", id: "u", content: [{ type: "text", text: "hi" }], timestamp: 0 } }),
    entry("custom", "e1", { customType: FACT_CUSTOM_TYPE, data: { type: "operation_started", id: "op-open", lane: "main", sourceLeafId: null, intent: { kind: "run", originalPrompt: [], initialMessages: [] }, timestamp: 9 } }),
    entry("custom", "e2", { customType: FACT_CUSTOM_TYPE, data: { type: "approval_asked", id: "ask-open", lane: "main", runId: "op-open", toolCallId: "call-x", toolName: "bash", argsDigest: "d", timestamp: 10 } }),
  ]);

  const result = sanitizeTranscript({ sessionManager: sm });
  assert.equal(result.operations[0].status, "open");
  assert.equal(result.approvals[0].outcome, null);
  assert.deepEqual(result.markers, []);
});

test("appendFact rejects invalid records instead of persisting them", () => {
  const branch = [];
  const sm = {
    getBranch: () => branch,
    appendCustomEntry(customType, data) {
      if (!data || typeof data !== "object") throw new Error("bad");
      branch.push(entry("custom", `e-${branch.length}`, { customType, data }));
      return `e-${branch.length - 1}`;
    },
  };
  assert.throws(() =>
    appendFact(sm, { type: "operation_started", id: "", lane: "main", sourceLeafId: null, intent: { kind: "run", originalPrompt: [], initialMessages: [] }, timestamp: 1 }),
  );
  assert.throws(() =>
    appendFact(sm, { type: "operation_started", id: "op-x", lane: "main", sourceLeafId: null, intent: { kind: "navigation", targetId: null }, timestamp: 1 }),
  );
  assert.equal(branch.length, 0);
});
