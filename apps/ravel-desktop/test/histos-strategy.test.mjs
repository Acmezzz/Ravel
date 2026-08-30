import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";
import { createStrategyDraft, validateStrategyDraft } from "../electron/histos-strategy.js";

const QUERY = { sourceSet: {}, lens: "structural", granularity: "entry" };

function validDraft(overrides = {}) {
  return {
    kind: "workflow",
    name: "review-diff",
    description: "Reviews a staged diff",
    executor: "flow-engine",
    tools: ["read", "grep"],
    steps: [{ key: "step-1", spec: "inspect the diff", dependsOn: [] }],
    ...overrides,
  };
}

function createEngine() {
  const directory = mkdtempSync(join(tmpdir(), "histos-strategy-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
  });
  if (engine.initializationError) throw engine.initializationError;
  return { directory, engine };
}

test("createStrategyDraft validates schema, permission, executor wiring and budget (fail-closed)", () => {
  const good = createStrategyDraft(validDraft());
  assert.equal(good.checks.ok, true);
  assert.match(good.draft.id, /^draft-/);

  // Schema: missing steps.
  const noSteps = createStrategyDraft(validDraft({ steps: [] }));
  assert.equal(noSteps.checks.ok, false);
  assert.equal(noSteps.checks.code, "schema_invalid");

  // Permission: a tool outside the subagent allowlist is rejected.
  const wideTools = createStrategyDraft(validDraft({ tools: ["read", "rm"] }));
  assert.equal(wideTools.checks.ok, false);
  assert.equal(wideTools.checks.code, "permission_denied");

  // Executor wiring: skill-inject / orchestrator stay disabled (R17).
  for (const executor of ["skill-inject", "orchestrator"]) {
    const unwired = createStrategyDraft(validDraft({ executor }));
    assert.equal(unwired.checks.ok, false);
    assert.equal(unwired.checks.code, "executor_unwired");
  }

  // Budget: a draft whose estimate exceeds the cap is rejected.
  const expensive = createStrategyDraft(validDraft({ strategy: "chain", steps: Array.from({ length: 16 }, (_, i) => ({ key: `s-${i}`, spec: "work", dependsOn: i === 0 ? [] : [`s-${i - 1}`] })), maxBudget: 1_000 }));
  assert.equal(expensive.checks.ok, false);
  assert.equal(expensive.checks.code, "budget_exceeded");

  // Unknown kind is an invalid-args throw, not a silent pass.
  assert.throws(() => createStrategyDraft(validDraft({ kind: "bogus" })), /kind must be one of/);
});

test("approved drafts become agent_spec nodes that invokeNode can plan; unapproved drafts have no run entry", async () => {
  const { directory, engine } = createEngine();
  try {
    const { draft, checks } = createStrategyDraft(validDraft());
    assert.equal(checks.ok, true);

    // Unapproved: nothing on the canvas yet and invokeNode cannot find it.
    const beforeInvoke = engine.invokeNode({ nodeId: "agent-spec:review-diff", prompt: "go" });
    assert.equal(beforeInvoke.ok, false);
    assert.equal(beforeInvoke.code, "not_found");
    assert.equal(engine.getGraph(QUERY).nodes.some((node) => node.nodeId === "agent-spec:review-diff"), false);

    // Approval persists the spec as a durable agent_spec node.
    const approved = engine.approveStrategyDraft({ draftId: draft.id, draft });
    assert.equal(approved.ok, true);
    assert.equal(approved.nodeId, "agent-spec:review-diff");
    assert.match(approved.specRevisionId, /^[0-9a-f]{64}$/);
    const onCanvas = engine.getGraph(QUERY).nodes.find((node) => node.nodeId === "agent-spec:review-diff");
    assert.ok(onCanvas, "approved draft must appear on the agent_spec canvas");
    assert.equal(onCanvas.kind, "agent_spec");

    // Now invokable: invokeNode plans against the approved revision.
    const planned = engine.invokeNode({ nodeId: "agent-spec:review-diff", prompt: "review the current diff" });
    assert.equal(planned.ok, true);
    assert.ok(planned.plan?.units && planned.plan.units.length > 0, "approved spec must produce an execution plan");
    assert.ok(planned.plan.units[0].prompt, "each plan unit carries a runnable prompt");

    // Re-approving the same strategy is rejected (already persisted).
    assert.throws(() => engine.approveStrategyDraft({ draftId: draft.id, draft }), /already approved/);

    // A draft that fails validation can never be approved (fail-closed).
    const bad = createStrategyDraft(validDraft({ executor: "orchestrator" }));
    assert.throws(() => engine.approveStrategyDraft({ draftId: bad.draft.id, draft: bad.draft }), /not wired/);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validateStrategyDraft is a pure function reusable outside the engine", () => {
  const draft = createStrategyDraft(validDraft()).draft;
  assert.equal(validateStrategyDraft(draft).ok, true);
  assert.equal(validateStrategyDraft({ ...draft, executor: "skill-inject" }).ok, false);
});
