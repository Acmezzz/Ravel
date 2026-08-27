import test from "node:test";
import assert from "node:assert/strict";
import { appendCheckpointFacts, readFacts } from "../electron/session-facts.js";
import { contentHashOf } from "../electron/content-hash.js";
import { buildResourceBundle } from "../electron/resource-center.js";
import { readFile } from "node:fs/promises";

function fakeSessionManager() {
  const entries = [];
  let nextId = 0;
  return {
    entries,
    getLeafId: () => "leaf-1",
    getEntries: () => entries,
    appendCustomEntry(customType, data) {
      const entry = { type: "custom", customType, data, id: `entry-${++nextId}` };
      entries.push(entry);
      return entry.id;
    },
  };
}

test("checkpoint facts pair navigation intent with terminal outcome", () => {
  const manager = fakeSessionManager();
  const operationId = appendCheckpointFacts(manager, {
    checkpointId: "0123456789abcdef0123456789abcdef01234567",
    label: "manual snapshot",
  });
  const facts = readFacts(manager);
  assert.equal(operationId, facts[0].id);
  assert.deepEqual(facts.map((fact) => fact.type), ["operation_started", "operation_finished"]);
  assert.equal(facts[0].intent.kind, "navigation");
  assert.equal(facts[0].intent.targetId, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(facts[1].runId, operationId);
  assert.equal(facts[1].outcome, "completed");
});

test("skill hash changes when content changes and resource bundle exposes it", () => {
  const first = contentHashOf("# skill\nversion 1\n");
  const second = contentHashOf("# skill\nversion 2\n");
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  const bundle = buildResourceBundle({
    resolved: { extensions: [], prompts: [], themes: [], skills: [{ path: "C:/skills/demo/SKILL.md", enabled: true, metadata: {} }] },
    skills: [{ name: "demo", description: "demo", filePath: "C:/skills/demo/SKILL.md", contentHash: first }],
  });
  assert.equal(bundle.skills[0].contentHash, first);
});

test("R0 lists virtualize and streaming deltas bypass the Zustand message array", async () => {
  const messageList = await readFile(new URL("../src/renderer/components/chat/MessageList.tsx", import.meta.url), "utf8");
  const activityList = await readFile(new URL("../src/renderer/components/sessions/ActivityList.tsx", import.meta.url), "utf8");
  const searchPanel = await readFile(new URL("../src/renderer/components/files/SearchPanel.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  for (const source of [messageList, activityList, searchPanel]) assert.match(source, /useVirtualizer/);
  assert.match(app, /appendStreamText/);
  assert.match(app, /appendStreamThinking/);
  assert.doesNotMatch(app, /store\.appendDelta\(id, update\.delta\)/);
});
