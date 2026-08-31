import test from "node:test";
import assert from "node:assert/strict";
import { readFile as readFileAsync } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";
import { buildSelectionPrompt, selectionPromptBytes, expandEvidence, jsonlEntryReader } from "../electron/histos-selection.js";

function sessionFixture() {
  const root = mkdtempSync(join(tmpdir(), "ravel-p6-"));
  writeFileSync(join(root, "session-p6.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "session-p6", cwd: root }),
    JSON.stringify({ type: "message", id: "m-1", parentId: null, message: { role: "user", content: "inspect the auth module deeply" } }),
    JSON.stringify({ type: "message", id: "m-2", parentId: "m-1", message: { role: "assistant", content: "Let me look at the token flow." } }),
  ].join("\n") + "\n");
  return root;
}

test("buildSelectionPrompt produces an L0+L1 prompt whose byte size is small and verifiable", () => {
  const nodes = [
    { nodeId: "n-1", nodeRevisionId: "r-1", kind: "operation", title: "run: inspect" },
    { nodeId: "n-2", nodeRevisionId: "r-2", kind: "tool", title: "bash" },
  ];
  const edges = [{ kind: "depends_on", srcNodeId: "n-1", dstNodeId: "n-2" }];
  const prompt = buildSelectionPrompt({ nodes, edges, title: "auth flow" });
  const bytes = selectionPromptBytes(prompt);
  assert.ok(bytes > 0);
  assert.ok(bytes < 2048, `L0+L1 skeleton must be near-zero cost, got ${bytes} bytes`);
  assert.match(prompt, /## L0 骨架/);
  assert.match(prompt, /## L1 凝练/);
  assert.match(prompt, /bash/);
  assert.match(prompt, /原文（L2）不在此 prompt 中/);
  // L1 is the distilled layer: nodes without a summary/distill are not
  // re-listed (that would duplicate L0), and a summarized node carries its
  // distillation text as real information gain.
  const withSummary = buildSelectionPrompt({
    nodes: [
      { nodeId: "n-1", nodeRevisionId: "r-1", kind: "operation", title: "run: inspect", summary: "inspected the diff" },
      { nodeId: "n-2", nodeRevisionId: "r-2", kind: "tool", title: "bash" },
    ],
    edges: [],
  });
  assert.match(withSummary, /inspected the diff/, "L1 must carry the distilled summary");
  const l1Section = withSummary.split("## L1 凝练")[1]?.split("## 关系边")[0] ?? "";
  assert.ok(!l1Section.includes("· bash"), "L1 must not re-list nodes without a summary");
  // Empty selection still yields a valid prompt.
  const empty = buildSelectionPrompt({ nodes: [], edges: [] });
  assert.match(empty, /\(空选区\)/);
});

test("expandEvidence extracts span-level original text with a fail-closed budget", () => {
  const root = sessionFixture();
  try {
    const reader = jsonlEntryReader(root);
    const full = expandEvidence({ sessionId: "session-p6", entryId: "m-1", budget: 10_000 }, reader);
    assert.equal(full.ok, true);
    assert.equal(full.text, "inspect the auth module deeply");
    // Span selector slices by utf-8 bytes.
    const span = expandEvidence({ sessionId: "session-p6", entryId: "m-1", selector: { kind: "span", start: 0, length: 8 }, budget: 10_000 }, reader);
    assert.equal(span.ok, true);
    assert.equal(span.text, "inspect ");
    // Budget exceeded -> fail-closed, never silently truncated.
    const over = expandEvidence({ sessionId: "session-p6", entryId: "m-1", budget: 4 }, reader);
    assert.equal(over.ok, false);
    assert.equal(over.code, "budget_exceeded");
    // Unknown entry -> explicit not_found.
    const missing = expandEvidence({ sessionId: "session-p6", entryId: "nope", budget: 100 }, reader);
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "not_found");
    // Unsupported selector kind is rejected (fail-closed, not thrown).
    const badSelector = expandEvidence({ sessionId: "session-p6", entryId: "m-1", selector: { kind: "hunk" }, budget: 100 }, reader);
    assert.equal(badSelector.ok, false);
    assert.equal(badSelector.code, "invalid_selector");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("engine buildSelectionPrompt and expandEvidence wire to the graph and JSONL", async () => {
  const root = sessionFixture();
  const directory = mkdtempSync(join(tmpdir(), "ravel-p6-engine-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
    sessionFiles: [join(root, "session-p6.jsonl")],
    sessionsRoot: root,
  });
  try {
    const built = engine.buildSelectionPrompt({ nodeRevisionIds: [], edgeRevisionIds: [] });
    assert.equal(built.ok, true);
    assert.ok(built.bytes > 0);
    const expanded = engine.expandEvidence({ sessionId: "session-p6", entryId: "m-2", budget: 10_000 });
    assert.equal(expanded.ok, true);
    assert.match(expanded.text, /token flow/);
    const capped = engine.expandEvidence({ sessionId: "session-p6", entryId: "m-2", budget: 3 });
    assert.equal(capped.code, "budget_exceeded");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("histos_expand is registered as an agent tool in agent-bridge", async () => {
  const { readFile } = await import("node:fs/promises");
  const bridge = await readFile(new URL("../electron/agent-bridge.js", import.meta.url), "utf8");
  assert.match(bridge, /"histos_expand"/);
  const worker = await readFile(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /const histosExpandTool =/);
  assert.match(worker, /customTools: \[histosExpandTool\]/);
});


// --- Task 25/26: skill edit drafts + compaction anchors ---

import { recordCompactionAnchors } from "../electron/session-facts.js";

function anchorManager() {
  const entries = [];
  return {
    entries,
    getLeafId: () => null,
    getEntries: () => entries,
    appendCustomEntry(customType, data) {
      const entry = { type: "custom", customType, data, id: "entry-" + (entries.length + 1) };
      entries.push(entry);
      return entry.id;
    },
  };
}

test("compaction_anchors persists summary + navigable entry anchors through the single writer", () => {
  const manager = anchorManager();
  recordCompactionAnchors(manager, { summary: "Compacted 3 entries.", anchors: ["e-1", "e-2", "e-3"] });
  const [fact] = manager.entries.map((entry) => entry.data);
  assert.equal(fact.type, "compaction_anchors");
  assert.deepEqual(fact.anchors, ["e-1", "e-2", "e-3"]);
  assert.throws(() => recordCompactionAnchors(manager, { summary: "", anchors: ["e-1"] }), /summary/);
  assert.throws(() => recordCompactionAnchors(manager, { summary: "x", anchors: [] }), /anchors/);
});

test("worker.mjs registers proposeSkillEdit/approveSkillEdit and compaction anchors wiring", async () => {
  const worker = await readFileAsync(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /proposeSkillEdit: async/);
  assert.match(worker, /approveSkillEdit: async/);
  assert.match(worker, /tmp-\$\{process\.pid\}/);
  assert.match(worker, /recordCompactionAnchors/);
});

test("worker histos_expand falls back to the durable JSONL when the entry left memory", async () => {
  const worker = await readFileAsync(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  // The reader must fall back to the JSONL on disk (compacted / cross-session
  // entries are not in memory), which is what keeps the compaction anchor
  // promise: expand can pull original text back after compaction.
  assert.match(worker, /sessionManagerEntryReader\(sessionManager, join\(AGENT_DIR, "sessions"\)\)/);
  assert.match(worker, /jsonlEntryReader\(sessionsRoot\)/);
  assert.match(worker, /In-memory only applies to the current session/);
});

test("approveSkillEdit is bound to a proposed draft (human review gate enforced)", async () => {
  const worker = await readFileAsync(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /pendingSkillEdits\.set\(draftId, \{ filePath, nextHash \}\)/);
  assert.match(worker, /unknown or expired draft/);
  assert.match(worker, /draft\.nextHash !== contentHashOf\(newContent\)/);
});
