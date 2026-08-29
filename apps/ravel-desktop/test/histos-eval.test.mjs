import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HistosEngine } from "../electron/histos-engine.js";
import { evalResultAddress, evalResultGraph, evalResultRevisionId, normalizeEvalResult } from "../electron/histos-eval.js";

async function tempEngine(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ravel-histos-eval-${label}-`));
  const engine = new HistosEngine({ workspaceId: `workspace-${label}`, databasePath: join(root, "index.sqlite"), artifactsDir: join(root, "artifacts") });
  t.after(async () => { engine.close(); await rm(root, { recursive: true, force: true }); });
  const query = (sql) => { const db = new DatabaseSync(join(root, "index.sqlite")); try { return db.prepare(sql).all(); } finally { db.close(); } };
  return { engine, query };
}

const base = {
  evalSet: "provider-cost",
  groupKey: "[\"case-1\",1]",
  testName: "summarize",
  file: "evals/provider.eval.ts",
  harness: "candidate",
  baseline: "baseline",
  candidates: ["candidate"],
  repetition: 1,
  outcome: "scored",
  score: 1,
  totalTokens: 120,
  totalMs: 340,
  estimatedCostUsd: 0.002,
};

test("normalizes eval results without inventing missing telemetry", () => {
  const result = normalizeEvalResult({ ...base, outcome: "unscored", score: undefined, totalTokens: undefined });
  assert.equal(result.outcome, "unscored");
  assert.equal("score" in result, false);
  assert.equal("totalTokens" in result, false);
});

test("eval result revisions and addresses are stable", () => {
  const reordered = { ...base, candidates: [...base.candidates], estimatedCostUsd: 0.002 };
  assert.equal(evalResultRevisionId(base), evalResultRevisionId(reordered));
  const address = evalResultAddress(base);
  assert.equal(address.sourceType, "eval_result");
  assert.match(address.revisionId, /^[0-9a-f]{64}$/);
});

test("projects an explicit graph node with evidence and telemetry", () => {
  const graph = evalResultGraph(base);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.evidence.length, 1);
  assert.equal(graph.evidence[0].role, "produces");
  assert.deepEqual(graph.nodes[0].metadata, {
    outcome: "scored",
    score: 1,
    totalTokens: 120,
    totalMs: 340,
    estimatedCostUsd: 0.002,
  });
});

test("persists eval results as graph artifacts with evidence and telemetry", async (t) => {
  const { engine, query } = await tempEngine(t, "persist");
  const result = await engine.applyEvalResults({ results: [base] });
  assert.equal(result.nodeCount, 1);
  assert.equal(result.edgeCount, 0);
  assert.equal(result.artifactCount, 1);
  const node = query("SELECT node_id, node_revision_id, kind, artifact_sha, anchor_json FROM node_revisions WHERE kind = 'eval_result'")[0];
  assert.equal(node.kind, "eval_result");
  assert.match(node.artifact_sha, /^[0-9a-f]{64}$/);
  assert.deepEqual({ ...JSON.parse(node.anchor_json).__histosMetadata }, { outcome: "scored", score: 1, totalTokens: 120, totalMs: 340, estimatedCostUsd: 0.002 });
  const evidence = query("SELECT a.source_type, e.role FROM evidence e JOIN addresses a ON a.address_id = e.address_id WHERE e.revision_id = '" + node.node_revision_id + "'");
  assert.equal(evidence.length, 1);
  assert.equal(String(evidence[0].source_type), "eval_result");
  assert.equal(String(evidence[0].role), "produces");
  assert.equal(query("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'graph_revision'")[0].n, 1);
});

test("eval result persistence is idempotent and chains changed observations", async (t) => {
  const { engine, query } = await tempEngine(t, "chain");
  await engine.applyEvalResults({ results: [base] });
  await engine.applyEvalResults({ results: [base] });
  await engine.applyEvalResults({ results: [{ ...base, score: 0.5 }] });
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE kind = 'eval_result'")[0].n, 2);
  assert.equal(query("SELECT COUNT(*) AS n FROM revision_parents")[0].n, 1);
});

test("malformed eval result batches fail closed", async (t) => {
  const { engine, query } = await tempEngine(t, "fail-closed");
  await assert.rejects(() => engine.applyEvalResults({ results: [base, { ...base, outcome: "scored", score: undefined }] }), (error) => error.code === "invalid_args");
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE kind = 'eval_result'")[0].n, 0);
  assert.equal(query("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'graph_revision'")[0].n, 0);
});

test("rejects malformed or contradictory observations", () => {
  assert.throws(() => normalizeEvalResult({ ...base, outcome: "scored", score: undefined }), /requires a score/);
  assert.throws(() => normalizeEvalResult({ ...base, outcome: "errored", score: 0 }), /only scored/);
  assert.throws(() => normalizeEvalResult({ ...base, candidates: ["candidate", "candidate"] }), /unique/);
  assert.throws(() => normalizeEvalResult({ ...base, totalMs: -1 }), /non-negative/);
});
