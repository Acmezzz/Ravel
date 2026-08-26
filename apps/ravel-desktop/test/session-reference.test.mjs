import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionReferenceFacts,
  buildSessionReferenceBlock,
  deriveActivityFromFacts,
  resolveSourceEntryId,
  stripSessionReferenceBlock,
} from "../electron/session-facts.js";
import { sanitizeTranscript } from "../electron/agent-bridge.js";

const TITLE = "重构认证模块";

function fakeSessionManager() {
  const entries = [];
  let nextId = 0;
  return {
    entries,
    getEntries: () => entries,
    appendCustomEntry(customType, data) {
      const entry = { type: "custom", customType, data, id: `entry-${++nextId}` };
      entries.push(entry);
      return entry.id;
    },
  };
}

test("reference block builds delimited model-facing metadata and strips cleanly", () => {
  const block = buildSessionReferenceBlock([{ targetSessionId: "sess-uuid-1", targetTitle: TITLE }]);
  assert.match(block, /===== BEGIN RAVEL SESSION REFERENCES =====/);
  assert.match(block, new RegExp(`- "@${TITLE}": session sess-uuid-1`));
  assert.match(block, /===== END RAVEL SESSION REFERENCES =====$/m);

  const prompt = `帮我对照 @${TITLE} 的做法\n${block}`;
  const stripped = stripSessionReferenceBlock(prompt);
  assert.equal(stripped.text, `帮我对照 @${TITLE} 的做法`);
  assert.equal(stripped.block.trim(), block.trim());
  assert.match(stripped.block, /- "@重构认证模块": session sess-uuid-1/);
  assert.equal(stripSessionReferenceBlock("没有块的普通文本").block, "");
});

test("resolveSourceEntryId prefers the leaf-chained user entry, falls back to text match", () => {
  const entries = [
    { id: "e1", type: "message", parentId: null, message: { role: "user", content: [{ type: "text", text: "旧消息" }] } },
    { id: "e2", type: "message", parentId: "e1", message: { role: "assistant", content: [] } },
    { id: "e3", type: "message", parentId: "e2", message: { role: "user", content: [{ type: "text", text: "新的提问" }] } },
  ];
  assert.equal(resolveSourceEntryId(entries, { leafBefore: "e2", promptText: "新的提问" }), "e3");
  assert.equal(resolveSourceEntryId(entries, { leafBefore: null, promptText: "旧消息" }), "e1");
  // No match → null; the caller retries or gives up without writing a fact.
  assert.equal(resolveSourceEntryId(entries, { leafBefore: null, promptText: "不存在的文本" }), null);
});

test("appendSessionReferenceFacts is idempotent per clientMessageId+target", () => {
  const manager = fakeSessionManager();
  const references = [
    { sourceEntryId: "e3", targetSessionId: "sess-a", targetTitle: "A" },
    { sourceEntryId: "e3", targetSessionId: "sess-b", targetTitle: "B" },
  ];
  const first = appendSessionReferenceFacts(manager, { clientMessageId: "cm-1", references });
  assert.equal(first.length, 2);
  const second = appendSessionReferenceFacts(manager, { clientMessageId: "cm-1", references });
  assert.equal(second.length, 0);
  const otherPrompt = appendSessionReferenceFacts(manager, { clientMessageId: "cm-2", references: [references[0]] });
  assert.equal(otherPrompt.length, 1);
  const facts = manager.entries.map((entry) => entry.data);
  assert.ok(facts.every((fact) => fact.type === "session_reference"));
  assert.equal(deriveActivityFromFacts(facts), null); // references alone are not activity
});

test("sanitizeTranscript strips the routing block and projects reference edges", () => {
  const block = buildSessionReferenceBlock([{ targetSessionId: "sess-uuid-9", targetTitle: TITLE }]);
  const session = {
    sessionManager: {
      getBranch: () => [
        {
          id: "u1",
          type: "message",
          message: { role: "user", content: [{ type: "text", text: `参考 @${TITLE} 的结论\n${block}` }] },
        },
        { id: "a1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "收到" }] } },
        {
          id: "c1",
          type: "custom",
          customType: "ravel_record",
          data: {
            type: "session_reference",
            id: "ref-1",
            lane: "main",
            seq: 3,
            timestamp: Date.now(),
            sourceEntryId: "u1",
            clientMessageId: "cm-9",
            targetSessionId: "sess-uuid-9",
            targetTitle: TITLE,
          },
        },
      ],
    },
  };
  const result = sanitizeTranscript(session);
  assert.equal(result.messages[0].text, `参考 @${TITLE} 的结论`);
  assert.doesNotMatch(result.messages[0].text, /RAVEL SESSION REFERENCES/);
  assert.deepEqual(result.references, [
    { sourceEntryId: "u1", clientMessageId: "cm-9", targetSessionId: "sess-uuid-9", targetTitle: TITLE },
  ]);
});
