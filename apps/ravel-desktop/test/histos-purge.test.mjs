import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";
import { recordPurgeFact, readFacts } from "../electron/session-facts.js";

const QUERY = { sourceSet: {}, lens: "structural", granularity: "entry" };

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
  const directory = mkdtempSync(join(tmpdir(), "histos-purge-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
  });
  if (engine.initializationError) throw engine.initializationError;
  return { directory, engine };
}

const SESSION_FACTS = [
  { type: "operation_started", id: "op-1", lane: "main", intent: { kind: "run" }, timestamp: 1_000 },
  { type: "operation_finished", runId: "op-1", outcome: "completed", timestamp: 1_100 },
  { type: "operation_started", id: "op-2", lane: "main", intent: { kind: "run" }, timestamp: 1_200 },
  { type: "approval_asked", id: "ask-1", runId: "op-2", toolCallId: "tc-1", toolName: "bash", argsDigest: "sha256:abc", timestamp: 1_300 },
  { type: "approval_decided", id: "dec-1", runId: "op-2", toolCallId: "tc-1", askedId: "ask-1", outcome: "allowed-once", timestamp: 1_400 },
];

test("purge physically deletes triple rows, names the owning session and reports the purge fact payload", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applySessionFacts({ sessionId: "s1", facts: SESSION_FACTS });
    const facts = await engine.queryFacts({ predicate: "produces" });
    const victim = facts.triples.find((triple) => triple.predicate === "produces" && !triple.tag);
    assert.ok(victim, "expected a plain triple");

    const result = engine.purgeEntries("triple", [victim.id], "sensitive content");
    assert.equal(result.purgedCount, 1);
    assert.ok(result.sessions.includes("s1"), "owning session must be named");
    assert.match(result.hint, /删除该会话/);
    assert.deepEqual(result.purgeFact, { targetKind: "triple", targetIds: [victim.id], reason: "sensitive content" });

    // The row is physically gone from the table, not just filtered.
    const database = engine.assertOpen();
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM fact_triples WHERE id = ?").get(victim.id).count, 0);
    assert.equal((await engine.queryFacts({ predicate: "produces" })).triples.some((triple) => triple.id === victim.id), false);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("purge deletes an artifact row and its file from disk", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applySessionFacts({ sessionId: "s1", facts: SESSION_FACTS });
    const graph = engine.getGraph(QUERY);
    const node = graph.nodes.find((item) => item.kind === "operation");
    assert.ok(node, "expected a node to select");
    const frozen = await engine.freezeContext({ ...QUERY, selection: [node.nodeRevisionId] });
    assert.ok(frozen.sha256, "freezeContext must return an artifact sha");
    const artifactPath = join(directory, "artifacts", `${frozen.sha256}.json`);
    assert.ok(existsSync(artifactPath), "artifact file should exist before purge");

    const result = engine.purgeEntries("artifact", [frozen.sha256]);
    assert.equal(result.purgedCount, 1);
    assert.equal(engine.assertOpen().prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sha256 = ?").get(frozen.sha256).count, 0);
    assert.equal(existsSync(artifactPath), false, "artifact file must be physically deleted");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approval accounting refuses to purge (fail-closed) and session_index routes to deleteSession", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applySessionFacts({ sessionId: "s1", facts: SESSION_FACTS });
    const graph = engine.getGraph(QUERY);
    const approvalNode = graph.nodes.find((node) => node.kind === "approval");
    assert.ok(approvalNode);
    assert.throws(() => engine.purgeEntries("node", [approvalNode.nodeRevisionId]), /approval accounting/);

    const facts = await engine.queryFacts({ predicate: "approves" });
    assert.ok(facts.triples.length > 0);
    assert.throws(() => engine.purgeEntries("triple", [facts.triples[0].id]), /approval accounting/);

    assert.throws(() => engine.purgeEntries("session_index", ["s1"]), /omega:deleteSession/);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recordPurgeFact lands a purge_record in the JSONL through the single writer", () => {
  const manager = fakeSessionManager();
  recordPurgeFact(manager, { targetKind: "triple", targetIds: ["t-abc"], reason: "user request" });
  const facts = readFacts(manager);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].type, "purge_record");
  assert.equal(facts[0].targetKind, "triple");
  assert.deepEqual(facts[0].targetIds, ["t-abc"]);
  assert.equal(facts[0].reason, "user request");
  assert.throws(() => recordPurgeFact(manager, { targetKind: "approval", targetIds: ["x"] }), /targetKind/);
  assert.throws(() => recordPurgeFact(manager, { targetKind: "triple", targetIds: [] }), /targetIds/);
});
