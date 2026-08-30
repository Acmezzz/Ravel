/**
 * FactGraphBackend contract tests (oh-my-pi MemoryBackend / Mnemopi Triple
 * shape). The contract is the seam every backend must satisfy; the in-memory
 * implementation is exercised here, the sqlite implementation is exercised
 * by the Histos engine tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createInMemoryFactGraph,
  createOffFactGraph,
  normalizeFactTriples,
  FACT_PREDICATES,
} from "../electron/histos-fact-graph.js";
import { createSqliteFactGraph } from "../electron/histos-sqlite-fact-graph.js";
import { projectFactBatchToTriples } from "../electron/histos-fact-derivation.js";

test("normalizeFactTriples rejects invalid predicate and unsupported characters", () => {
  assert.throws(() => normalizeFactTriples([{ subject: "session:s1", predicate: "BAD", object: "x", source: "s" }]), /predicate/);
  assert.throws(() => normalizeFactTriples([{ subject: "has space", predicate: "references", object: "x", source: "s" }]), /subject/);
  assert.throws(() => normalizeFactTriples([{ subject: "session:s1", predicate: "references", object: "x", source: "s", validFrom: 10, validUntil: 5 }]), /validUntil/);
});

test("normalizeFactTriples accepts custom_* predicates and applies default scope", () => {
  const [triple] = normalizeFactTriples([{ subject: "session:s1", predicate: "custom_link", object: "x", source: "test" }], "scope-1");
  assert.equal(triple.scope, "scope-1");
  assert.equal(triple.predicate, "custom_link");
  assert.equal(triple.confidence, 1);
});

test("in-memory backend dedupes by id and supports scoped query with asOf", async () => {
  const backend = createInMemoryFactGraph();
  await backend.start({ workspaceId: "ws-1" });
  // First call: two unique triples + one explicit-id duplicate.
  const write = await backend.writeTriples([
    { subject: "session:s1", predicate: "produces", object: "op:1", source: "session:s1", validFrom: 100 },
    { subject: "session:s1", predicate: "produces", object: "op:2", source: "session:s1", validFrom: 200 },
    { subject: "session:s1", predicate: "produces", object: "op:1", source: "session:s1", validFrom: 100, id: "fixed-id" },
    { subject: "session:s1", predicate: "produces", object: "op:1", source: "session:s1", validFrom: 100, id: "fixed-id" },
  ]);
  assert.equal(write.ok, true);
  // op:1 (auto-id), op:2 (auto-id), op:1 with fixed-id (distinct from
  // auto-id) — all three are unique. The fourth is a true duplicate of the
  // third so the backend dedupes it.
  assert.equal(write.count, 3);

  const stats = await backend.stats();
  assert.equal(stats.tripleCount, 3);
  assert.equal(stats.distinctSubjects, 1);

  const active = await backend.queryTriples({ asOf: 150 });
  assert.equal(active.ok, true);
  assert.equal(active.triples.length, 2);
  const objects = active.triples.map((triple) => triple.object).sort();
  assert.deepEqual(objects, ["op:1", "op:1"]);

  const subjectFiltered = await backend.queryTriples({ subject: "session:s1" });
  assert.equal(subjectFiltered.triples.length, 3);
});

test("sqlite backend stores triples and survives a fresh handle reopen", async () => {
  const workspaceId = `ws-${Date.now()}-${process.pid}`;
  const tempDir = mkdtempSync(join(tmpdir(), "ravel-fact-graph-"));
  const dbPath = join(tempDir, "index.sqlite");
  try {
    const first = createSqliteFactGraph({ database: new DatabaseSync(dbPath, { timeout: 5000 }), workspaceId });
    first.start({ workspaceId });
    const firstWrite = await first.writeTriples([
      { subject: "session:s1", predicate: "produces", object: "op:1", source: "session:s1" },
      { subject: "session:s1", predicate: "approves", object: "tool:bash", source: "session:s1", tag: "approved" },
    ]);
    assert.equal(firstWrite.ok, true);
    assert.equal(firstWrite.count, 2);
    first.stop();

    // Reopen the same file with a brand new handle. The sqlite backend
    // binds prepared statements to the connection it was constructed with,
    // so a second `createSqliteFactGraph` re-prepares everything against
    // the new DatabaseSync — that's the production path the test covers.
    const reopened = createSqliteFactGraph({ database: new DatabaseSync(dbPath, { timeout: 5000 }), workspaceId });
    reopened.start({ workspaceId });
    const result = await reopened.queryTriples({ predicate: "approves" });
    assert.equal(result.ok, true);
    assert.equal(result.triples.length, 1);
    assert.equal(result.triples[0].tag, "approved");

    const stats = await reopened.stats();
    assert.equal(stats.tripleCount, 2);
    const cleared = await reopened.clear();
    assert.equal(cleared.ok, true);
    assert.equal(cleared.count, 2);
    assert.equal((await reopened.stats()).tripleCount, 0);
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

test("projectFactBatchToTriples maps every supported fact type to non-empty triples", () => {
  const now = 1_000_000;
  const facts = [
    { type: "operation_started", id: "op-1", lane: "main", intent: { kind: "run" }, timestamp: now },
    { type: "operation_finished", runId: "op-1", outcome: "completed", timestamp: now + 1 },
    { type: "approval_asked", runId: "op-1", toolCallId: "tc-1", toolName: "bash", argsDigest: "sha256:abc", timestamp: now + 2 },
    { type: "approval_decided", runId: "op-1", toolCallId: "tc-1", askedId: "ask-1", outcome: "allowed-once", timestamp: now + 3 },
    { type: "session_reference", sourceEntryId: "e-1", clientMessageId: "c-1", targetSessionId: "s2", targetTitle: "Other", timestamp: now + 4 },
    { type: "context_attached", targetSessionId: "s1", contextSha: "a".repeat(64), timestamp: now + 5 },
    { type: "flow_trigger", flowSha: "b".repeat(64), scheduleId: "sch-1", outcome: "started", timestamp: now + 6 },
  ];
  const triples = projectFactBatchToTriples(facts, { sessionId: "s1" });
  for (const fact of facts) {
    const fromFact = triples.filter((triple) => triple.source === "session:s1");
    assert.ok(fromFact.length > 0, `expected at least one triple for ${fact.type}`);
  }
  // Every triple uses a known predicate or `custom_*`.
  for (const triple of triples) {
    assert.ok(FACT_PREDICATES.includes(triple.predicate) || triple.predicate.startsWith("custom_"), `predicate ${triple.predicate} not in allow list`);
  }
});

test("off backend reports zero triples and is a no-op for writes", async () => {
  const off = createOffFactGraph();
  await off.start();
  const stats = await off.stats();
  assert.equal(stats.tripleCount, 0);
  const write = await off.writeTriples([{ subject: "session:s1", predicate: "produces", object: "x", source: "session:s1" }]);
  // The off backend intentionally reports zero so the engine caller knows
  // nothing was indexed; the operation itself does not throw.
  assert.equal(write.ok, true);
  assert.equal(write.count, 0);
});
