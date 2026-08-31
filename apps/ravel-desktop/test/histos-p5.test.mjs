import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";
import { appendGoalStateFact, recordDiagnosticObserved, recordUsageObserved, readFacts } from "../electron/session-facts.js";
import { projectFactBatchToTriples } from "../electron/histos-fact-derivation.js";
import { createGoalState, recordGoalTurn, isGoalBudgetExceeded } from "../electron/goal-state.js";

function fakeSessionManager() {
  const entries = [];
  let nextId = 0;
  return {
    entries,
    getLeafId: () => null,
    getEntries: () => entries,
    appendCustomEntry(customType, data) {
      const entry = { type: "custom", customType, data, id: `entry-${++nextId}` };
      entries.push(entry);
      return entry.id;
    },
  };
}

function createEngine() {
  const directory = mkdtempSync(join(tmpdir(), "histos-p5-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
  });
  if (engine.initializationError) throw engine.initializationError;
  return { directory, engine };
}

test("applyDiagnostics dedupes by absPath (newest per file wins) and writes diagnostic triples", async () => {
  const { directory, engine } = createEngine();
  try {
    const first = await engine.applyDiagnostics({
      diagnostics: [
        { file: "C:/repo/src/a.ts", severity: "warning", message: "unused variable", ts: 1_000 },
        { file: "C:/repo/src/b.ts", severity: "error", message: "type mismatch", ts: 1_001 },
      ],
    });
    assert.equal(first.ok, true);
    assert.equal(first.count, 2);
    const second = await engine.applyDiagnostics({
      diagnostics: [{ file: "C:/repo/src/a.ts", severity: "error", message: "fixed now", ts: 2_000 }],
    });
    assert.equal(second.ok, true);
    const facts = await engine.queryFacts({ predicate: "custom_diagnostic_observed" });
    const forA = facts.triples.filter((triple) => triple.subject === "file:C:_repo_src_a.ts");
    const forB = facts.triples.filter((triple) => triple.subject === "file:C:_repo_src_b.ts");
    assert.equal(forA.length, 1, "absPath dedupe keeps only the newest per file");
    assert.equal(forA[0].object, "error:fixed now");
    assert.equal(forB.length, 1);
    // Invalid diagnostics fail closed.
    await assert.rejects(() => engine.applyDiagnostics({ diagnostics: [{ file: "", severity: "error", message: "x" }] }), /file/);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fact_triples FTS5 search hits keywords in subjects/objects", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applyDiagnostics({ diagnostics: [{ file: "C:/repo/src/api.ts", severity: "error", message: "timeout calling search service", ts: 1_000 }] });
    const hit = await engine.ftsSearch({ term: "timeout", limit: 10 });
    assert.equal(hit.ok, true);
    assert.ok(hit.triples.length >= 1, "keyword must hit the FTS index");
    const miss = await engine.ftsSearch({ term: "definitely-not-indexed" });
    assert.equal(miss.triples.length, 0);
    // Punctuation cannot smuggle FTS syntax.
    const quoted = await engine.ftsSearch({ term: 'NOT " error' });
    assert.equal(quoted.ok, true);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("FTS5 index survives clear and rowid reuse without phantom hits", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applyDiagnostics({ diagnostics: [{ file: "C:/repo/src/api.ts", severity: "error", message: "zebraquark unique marker", ts: 1_000 }] });
    assert.ok((await engine.ftsSearch({ term: "zebraquark" })).triples.length >= 1);
    // clear() must wipe the FTS mirror too, or the external-content table
    // keeps the old tokens and a rowid reuse JOINs MATCH to a wrong row.
    await engine.clearFacts();
    assert.equal((await engine.ftsSearch({ term: "zebraquark" })).triples.length, 0, "cleared index must not return old tokens");
    await engine.applyDiagnostics({ diagnostics: [{ file: "C:/repo/src/api.ts", severity: "error", message: "brand new payload", ts: 2_000 }] });
    const fresh = await engine.ftsSearch({ term: "payload" });
    assert.ok(fresh.triples.length >= 1, "new rows must be searchable");
    assert.ok(fresh.triples.every((triple) => triple.object.includes("brand new payload")), "no phantom rows from reused rowids");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ftsSearch hides archived and purged triples", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applyDiagnostics({ diagnostics: [{ file: "C:/repo/src/secret.ts", severity: "error", message: "classified archive marker", ts: 1_000 }] });
    const hit = await engine.ftsSearch({ term: "classified" });
    assert.ok(hit.triples.length >= 1);
    const target = hit.triples[0];
    engine.archiveEntries("triple", [target.id], "archive it");
    assert.equal((await engine.ftsSearch({ term: "classified" })).triples.length, 0, "archived triple must stay invisible to FTS");
    engine.restoreEntries([engine.assertOpen().prepare("SELECT id FROM tombstones WHERE target_kind = 'triple' AND target_id = ?").get(target.id).id]);
    assert.ok((await engine.ftsSearch({ term: "classified" })).triples.length >= 1, "restored triple becomes searchable again");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("goal_state and usage_observed facts land through the single writer with explicit-missing semantics", () => {
  const manager = fakeSessionManager();
  const goal = createGoalState({ objective: "ship the feature", sessionId: "s1" });
  appendGoalStateFact(manager, goal);
  recordGoalTurn(goal, { timeDeltaMs: 5_000, continuation: true });
  appendGoalStateFact(manager, goal);
  recordUsageObserved(manager, { model: "claude-sonnet-4-5", tokens: 1200 });
  recordUsageObserved(manager, { model: "deepseek-v3", elapsedMs: 3_000 });

  const facts = readFacts(manager);
  assert.deepEqual(facts.map((fact) => fact.type), ["goal_state", "goal_state", "usage_observed", "usage_observed"]);
  assert.equal(facts[1].rounds, 1);
  assert.equal(facts[2].tokens, 1200);
  assert.equal("elapsedMs" in facts[2], false, "missing usage fields stay missing");
  assert.equal("costUsd" in facts[2], false);
  assert.equal(facts[3].elapsedMs, 3000);
  assert.equal("tokens" in facts[3], false);
  // Budget gate from the contract stops the goal at the round cap.
  const capped = createGoalState({ objective: "x", sessionId: "s1" });
  for (let i = 0; i < 30; i += 1) recordGoalTurn(capped, { continuation: true });
  assert.equal(isGoalBudgetExceeded(capped), true);
});

test("goal_state and usage_observed derive to custom predicate triples", () => {
  const now = 1_000_000;
  const triples = projectFactBatchToTriples(
    [
      { type: "goal_state", id: "g1", objective: "ship", status: "active", rounds: 2, timestamp: now },
      { type: "usage_observed", id: "u1", model: "deepseek-v3", tokens: 42, elapsedMs: 500, timestamp: now + 1 },
    ],
    { sessionId: "s1" },
  );
  assert.ok(triples.some((triple) => triple.predicate === "custom_goal_state" && triple.object === "active:rounds:2"));
  assert.ok(triples.some((triple) => triple.predicate === "custom_usage_observed" && triple.object === "tokens:42 elapsedMs:500"));
  for (const triple of triples) {
    assert.ok(triple.predicate.startsWith("custom_"), `predicate ${triple.predicate} must be custom_*`);
  }
});

test("recordDiagnosticObserved rejects unknown severities and empty files", () => {
  const manager = fakeSessionManager();
  assert.throws(() => recordDiagnosticObserved(manager, { file: "a.ts", severity: "fatal", message: "x" }), /severity/);
  assert.throws(() => recordDiagnosticObserved(manager, { file: "", severity: "error", message: "x" }), /file/);
  assert.equal(readFacts(manager).length, 0);
});
