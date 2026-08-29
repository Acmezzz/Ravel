import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HistosEngine } from "../electron/histos-engine.js";
import { agentRunGraph, agentSpecNodeIds, agentSpecRevisionId } from "../electron/histos-agent-spec.js";

// Each engine owns a private temp workspace torn down with the test, so a
// failing assertion can never leak a locked SQLite handle into the next one.
async function tempEngine(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ravel-histos-agent-${label}-`));
  const engine = new HistosEngine({
    workspaceId: `workspace-${label}`,
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
  });
  t.after(async () => {
    engine.close();
    await rm(root, { recursive: true, force: true });
  });
  const query = (sql) => {
    const db = new DatabaseSync(join(root, "index.sqlite"));
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };
  return { engine, root, query };
}

const SPEC_A = { name: "reviewer", description: "Reviews a diff for defects" };
const SPEC_B = { name: "reviewer", description: "Reviews a diff for defects and style" };

function makeRun({ specRevisionId, text = "first result", endedAt = 1_700_000_000_000 } = {}) {
  return {
    specName: "reviewer",
    specRevisionId,
    strategy: "single",
    input: "check the patch",
    ok: true,
    completedCount: 1,
    unitCount: 1,
    units: [{ key: "reviewer", sessionId: "session-1", text, endedAt }],
  };
}

test("applyAgentActivity persists a spec revision with its address", async (t) => {
  const { engine, query } = await tempEngine(t, "spec");
  const result = engine.applyAgentActivity({ specs: [SPEC_A] });
  assert.equal(result.nodeCount, 1);

  const nodes = query("SELECT node_id, node_revision_id, kind, title FROM node_revisions WHERE node_id = 'agent-spec:reviewer'");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, "agent_spec");
  assert.equal(nodes[0].node_id, "agent-spec:reviewer");
  assert.equal(nodes[0].node_revision_id, agentSpecNodeIds(SPEC_A).nodeRevisionId);
  assert.match(nodes[0].title, /^reviewer: Reviews a diff/);

  const addresses = query("SELECT source_type, object_id, revision_id FROM addresses WHERE source_type = 'agent_spec' AND object_id = 'reviewer'");
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].source_type, "agent_spec");
  assert.equal(addresses[0].object_id, "reviewer");
  assert.equal(addresses[0].revision_id, agentSpecRevisionId(SPEC_A));

  const evidence = query("SELECT revision_id, role FROM evidence WHERE revision_id = '" + nodes[0].node_revision_id + "'");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].revision_id, nodes[0].node_revision_id);
  assert.equal(evidence[0].role, "produces");
});

test("applying the same spec twice is a no-op", async (t) => {
  const { engine, query } = await tempEngine(t, "spec-idempotent");
  engine.applyAgentActivity({ specs: [SPEC_A] });
  engine.applyAgentActivity({ specs: [SPEC_A] });
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE node_id = 'agent-spec:reviewer'")[0].n, 1);
  assert.equal(query("SELECT COUNT(*) AS n FROM revision_parents WHERE child_id IN (SELECT node_revision_id FROM node_revisions WHERE node_id = 'agent-spec:reviewer')")[0].n, 0);
});

test("editing a spec appends a revision chained to the previous one", async (t) => {
  const { engine, query } = await tempEngine(t, "spec-chain");
  engine.applyAgentActivity({ specs: [SPEC_A] });
  engine.applyAgentActivity({ specs: [SPEC_B] });

  const nodes = query("SELECT node_id, node_revision_id FROM node_revisions WHERE node_id = 'agent-spec:reviewer' ORDER BY created_at");
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].node_id, "agent-spec:reviewer");
  assert.equal(nodes[1].node_id, "agent-spec:reviewer");
  assert.notEqual(nodes[0].node_revision_id, nodes[1].node_revision_id);

  // Deterministic ids let us check the chain direction without relying on
  // wall-clock ordering: B's revision remembers A's revision as its parent.
  const parents = query("SELECT child_id, parent_id FROM revision_parents WHERE child_id IN (SELECT node_revision_id FROM node_revisions WHERE node_id = 'agent-spec:reviewer')");
  assert.equal(parents.length, 1);
  assert.equal(parents[0].child_id, agentSpecNodeIds(SPEC_B).nodeRevisionId);
  assert.equal(parents[0].parent_id, agentSpecNodeIds(SPEC_A).nodeRevisionId);
});

test("runs chain over time and point back at the spec that drove them", async (t) => {
  const { engine, query } = await tempEngine(t, "run-chain");
  const specRevisionId = agentSpecRevisionId(SPEC_A);
  engine.applyAgentActivity({ specs: [SPEC_A] });

  const runOne = makeRun({ specRevisionId });
  const runTwo = makeRun({ specRevisionId, text: "second result", endedAt: 1_700_000_001_000 });
  engine.applyAgentActivity({ runs: [runOne] });
  engine.applyAgentActivity({ runs: [runTwo] });

  const expectedOne = agentRunGraph(runOne).nodes[0];
  const expectedTwo = agentRunGraph(runTwo).nodes[0];

  const runNodes = query("SELECT node_id, node_revision_id, kind FROM node_revisions WHERE kind = 'agent_run'");
  assert.equal(runNodes.length, 2);
  // Same spec, two executions…
  assert.deepEqual([...new Set(runNodes.map((row) => row.node_id))], ["agent-run:reviewer"]);
  // …chained newest → oldest.
  const parents = query("SELECT child_id, parent_id FROM revision_parents");
  assert.equal(parents.length, 1);
  assert.equal(parents[0].child_id, expectedTwo.nodeRevisionId);
  assert.equal(parents[0].parent_id, expectedOne.nodeRevisionId);

  // Spatial traceability: each run links to the spec node with a run_of edge.
  const edges = query("SELECT src_node_id, dst_node_id, kind FROM edge_revisions");
  assert.equal(edges.length, 2);
  for (const edge of edges) {
    assert.equal(edge.src_node_id, "agent-run:reviewer");
    assert.equal(edge.dst_node_id, "agent-spec:reviewer");
    assert.equal(edge.kind, "run_of");
  }

  // Evidence on a run: it produced its own record and is supported by the spec.
  const allEvidence = query(
    "SELECT e.revision_id AS revision_id, e.role AS role, a.source_type AS source_type FROM evidence e JOIN addresses a ON a.address_id = e.address_id",
  );
  const runEvidence = allEvidence.filter((row) => row.revision_id === expectedTwo.nodeRevisionId);
  assert.deepEqual(
    runEvidence.map((row) => `${row.source_type}:${row.role}`).sort(),
    ["agent_run:produces", "agent_spec:supports"],
  );
});

test("a malformed spec fails closed before anything is written", async (t) => {
  const { engine, query } = await tempEngine(t, "fail-closed");
  assert.throws(() => engine.applyAgentActivity({ specs: [{ description: "no name" }] }), /name/);
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE kind = 'agent_spec' AND node_id NOT IN ('agent-spec:plan', 'agent-spec:goal', 'agent-spec:build')")[0].n, 0);
});

test("empty activity is rejected", async (t) => {
  const { engine } = await tempEngine(t, "empty");
  assert.throws(() => engine.applyAgentActivity({}), /requires specs or runs/);
  assert.throws(() => engine.applyAgentActivity({ specs: [], runs: [] }), /requires specs or runs/);
});
