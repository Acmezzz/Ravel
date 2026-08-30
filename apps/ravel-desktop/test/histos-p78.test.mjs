import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";
import { parseCapabilityFlow } from "../electron/histos-capability-flow.js";

const QUERY = { sourceSet: {}, lens: "structural", granularity: "entry" };

const SKILL_CONTENT = `---
name: greet
description: Greets the caller
trigger: on user greeting
---

1. Read the user's name.
2. Build the greeting.
3. Return it.

output: greeting text
`;

function createEngine() {
  const directory = mkdtempSync(join(tmpdir(), "histos-p78-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
  });
  if (engine.initializationError) throw engine.initializationError;
  return { directory, engine };
}

test("parseCapabilityFlow extracts trigger/steps/outputs deterministically", () => {
  const parsed = parseCapabilityFlow({ kind: "skill", name: "greet", content: SKILL_CONTENT });
  assert.equal(parsed.artifact.name, "greet");
  assert.equal(parsed.artifact.description, "Greets the caller");
  assert.deepEqual(parsed.artifact.triggers, ["on user greeting"]);
  assert.equal(parsed.artifact.steps.length, 3);
  assert.deepEqual(parsed.artifact.outputs, ["greeting text"]);
  assert.match(parsed.nodeRevisionId, /^[0-9a-f]{64}$/);
  // Content change -> new revision id (deterministic).
  const changed = parseCapabilityFlow({ kind: "skill", name: "greet", content: `${SKILL_CONTENT}<!-- v2 -->` });
  assert.notEqual(changed.nodeRevisionId, parsed.nodeRevisionId);
  assert.throws(() => parseCapabilityFlow({ kind: "bogus", name: "x", content: "y" }), /kind/);
});

test("applyCapabilityFlows appends revisions on content change and surfaces capability nodes", async () => {
  const { directory, engine } = createEngine();
  try {
    const first = await engine.applyCapabilityFlows({ flows: [{ kind: "skill", name: "greet", content: SKILL_CONTENT }] });
    assert.equal(first.nodeCount, 1);
    const node = engine.getGraph(QUERY).nodes.find((item) => item.nodeId === "capability:skill:greet");
    assert.ok(node, "capability node must appear on the canvas");
    assert.equal(node.metadata?.capability?.triggers[0], "on user greeting");
    // Content change appends a revision.
    await engine.applyCapabilityFlows({ flows: [{ kind: "skill", name: "greet", content: `${SKILL_CONTENT}<!-- v2 -->` }] });
    const versions = engine.getGraph(QUERY).nodes.filter((item) => item.nodeId === "capability:skill:greet");
    assert.equal(versions.length, 2, "content change must append a revision");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("applyProjectKnowledge versionizes AGENTS.md-style files with scope and summary", async () => {
  const { directory, engine } = createEngine();
  try {
    const first = await engine.applyProjectKnowledge({ files: [{ path: "AGENTS.md", content: "# Rules\n\nBe concise.\n", scope: "project" }] });
    assert.equal(first.nodeCount, 1);
    const node = engine.getGraph(QUERY).nodes.find((item) => item.nodeId === "knowledge:project:AGENTS.md");
    assert.ok(node, "knowledge node must appear");
    assert.equal(node.metadata?.scope, "project");
    assert.match(node.metadata?.summary, /Rules/);
    // Edit -> new revision, old version stays queryable.
    await engine.applyProjectKnowledge({ files: [{ path: "AGENTS.md", content: "# Rules\n\nBe concise AND direct.\n", scope: "project" }] });
    const versions = engine.getGraph(QUERY).nodes.filter((item) => item.nodeId === "knowledge:project:AGENTS.md");
    assert.equal(versions.length, 2);
    // All knowledge nodes are archivable through the P0 semantics.
    engine.archiveEntries("node", [node.nodeRevisionId], "outdated rule");
    assert.equal(engine.getGraph(QUERY).nodes.filter((item) => item.nodeId === "knowledge:project:AGENTS.md").length, 1);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("handoff artifact freezes as a ContextSet and refuses while busy", async () => {
  const { directory, engine } = createEngine();
  try {
    const handoff = await engine.createHandoff({ sessionId: "s1", summary: "Handoff summary", anchors: ["e-1", "e-2"] });
    assert.equal(handoff.ok, true);
    assert.match(handoff.sha256, /^[0-9a-f]{64}$/);
    assert.equal(handoff.freezeableAsContextSet, true);
    // The artifact is on disk and listed by the library.
    assert.ok(engine.listArtifacts().some((item) => item.sha256 === handoff.sha256), "artifact library lists the handoff");
    // Busy (compaction running) is refused fail-closed.
    const busy = await engine.createHandoff({ sessionId: "s1", busy: true });
    assert.equal(busy.ok, false);
    assert.equal(busy.code, "handoff_busy");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
