import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXECUTOR_WIRING,
  memoKey,
  narrowTools,
  normalizeInvocationRequest,
  planInvocation,
  planInvocationFromRequest,
  topologicalWaves,
} from "../electron/histos-capability.js";
import { BUDGET_CAPS, normalizeAgentSpec } from "../electron/histos-agent-spec.js";

const SESSION_SPEC = {
  name: "build",
  description: "Full development mode",
  surface: "session",
  trust: "approved",
  tools: ["read", "edit", "bash"],
  budget: { maxSteps: 100 },
};

const WORKFLOW_SPEC = {
  name: "full-review",
  description: "Review a change from several angles",
  surface: "workflow",
  strategy: "parallel",
  steps: [
    { key: "explore", spec: "scout" },
    { key: "correct", spec: "reviewer", dependsOn: ["explore"] },
    { key: "secure", spec: "reviewer", dependsOn: ["explore"] },
    { key: "report", spec: "librarian", dependsOn: ["correct", "secure"] },
  ],
};

test("narrowing can only remove tools, never add them", () => {
  assert.deepEqual(narrowTools(["read", "bash"], ["read", "grep"]), { tools: ["read"], dropped: ["bash"] });
  // No parent means no constraint, but it also means nothing was granted.
  assert.deepEqual(narrowTools(["read"], null), { tools: ["read"], dropped: [] });
  assert.deepEqual(narrowTools(["bash"], ["read"]), { tools: [], dropped: ["bash"] });
});

test("dependency waves order a DAG and refuse cycles", () => {
  const waves = topologicalWaves([
    { key: "a" },
    { key: "b", dependsOn: ["a"] },
    { key: "c", dependsOn: ["a"] },
    { key: "d", dependsOn: ["b", "c"] },
  ]);
  assert.deepEqual(waves.map((wave) => wave.map((unit) => unit.key)), [["a"], ["b", "c"], ["d"]]);
  assert.equal(topologicalWaves([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }]), null);
  assert.equal(topologicalWaves([{ key: "a", dependsOn: ["ghost"] }]), null);
  assert.deepEqual(topologicalWaves([]), []);
});

test("memoKey is content addressed and sensitive to every input", () => {
  const base = { specRevisionId: "rev-1", input: "same", toolCatalog: "read" };
  assert.equal(memoKey(base), memoKey({ ...base }));
  assert.notEqual(memoKey(base), memoKey({ ...base, input: "different" }));
  assert.notEqual(memoKey(base), memoKey({ ...base, toolCatalog: "read,edit" }));
  assert.notEqual(memoKey(base), memoKey({ ...base, specRevisionId: "rev-2" }));
});

test("invocation requests are shape-checked without trusting the caller", () => {
  assert.equal(normalizeInvocationRequest(null), null);
  assert.equal(normalizeInvocationRequest({}), null);
  assert.equal(normalizeInvocationRequest({ nodeId: "agent-spec:plan", revisionId: "nope" }), null);
  assert.deepEqual(normalizeInvocationRequest({ nodeId: "agent-spec:plan" }), { nodeId: "agent-spec:plan" });
  const withRev = normalizeInvocationRequest({ nodeId: "agent-spec:plan", revisionId: "a".repeat(64), prompt: "hi", dryRun: true });
  assert.equal(withRev.revisionId, "a".repeat(64));
  assert.equal(withRev.prompt, "hi");
  assert.equal(withRev.dryRun, true);
  // Oversized payloads are refused rather than silently truncated into a lie.
  assert.equal(normalizeInvocationRequest({ nodeId: "x", args: { pad: "y".repeat(50_000) } }), null);
});

test("an approved session spec plans and reports itself as wired", () => {
  const result = planInvocation({ spec: SESSION_SPEC, input: { prompt: "ship it" } });
  assert.equal(result.ok, true);
  assert.equal(result.plan.executor, "agent-loop");
  assert.equal(result.plan.wired, true);
  assert.deepEqual(result.plan.tools, ["bash", "edit", "read"]);
  assert.equal(result.plan.budget.maxSteps, 100);
});

test("a draft is inspectable but not runnable unless explicitly accepted", () => {
  const draft = { ...SESSION_SPEC, trust: "draft" };
  // Dry-run is always allowed: that is how a generated spec gets reviewed.
  assert.equal(planInvocation({ spec: draft, options: { dryRun: true } }).ok, true);
  const refused = planInvocation({ spec: draft });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "trust_draft");
  // Accepted drafts still lose anything outside the read-only family.
  const accepted = planInvocation({ spec: draft, options: { allowDraft: true } });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.plan.tools, ["read"]);
  assert.deepEqual(accepted.plan.droppedTools, ["bash", "edit"]);
});

test("an unwired executor is planned but never pretends to run", () => {
  const workflow = { ...WORKFLOW_SPEC, executor: "orchestrator" };
  assert.equal(EXECUTOR_WIRING.orchestrator.wired, false);
  const refused = planInvocation({ spec: workflow });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "executor_unwired");
  assert.equal(planInvocation({ spec: workflow, options: { dryRun: true } }).ok, true);
});

test("a parent surface narrows the child and an empty result is refused", () => {
  const narrowed = planInvocation({ spec: SESSION_SPEC, parentTools: ["read", "grep"] });
  assert.deepEqual(narrowed.plan.tools, ["read"]);
  assert.deepEqual(narrowed.plan.droppedTools, ["bash", "edit"]);
  const empty = planInvocation({ spec: SESSION_SPEC, parentTools: ["grep"] });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "tools_empty");
});

test("a malformed spec fails closed before anything is planned", () => {
  const result = planInvocation({ spec: { description: "no name" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_spec");
});

test("budget is capped even when the spec asks for more", () => {
  const greedy = { ...SESSION_SPEC, budget: { maxSteps: 10_000_000, maxTokens: 99 } };
  const plan = planInvocation({ spec: greedy }).plan;
  assert.equal(plan.budget.maxSteps, BUDGET_CAPS.maxSteps);
  assert.equal(plan.budget.maxTokens, 99);
});

test("a workflow plan carries dependency waves", () => {
  // The default orchestrator is intentionally unwired; dry-run still exposes
  // the complete dependency plan without pretending execution is available.
  const result = planInvocation({ spec: WORKFLOW_SPEC, options: { dryRun: true } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const plan = result.plan;
  assert.equal(plan.surface, "workflow");
  assert.equal(plan.waves.length, 3);
  assert.deepEqual(plan.waves[0].map((unit) => unit.key), ["explore"]);
  assert.deepEqual(plan.waves[1].map((unit) => unit.key), ["correct", "secure"]);
  assert.deepEqual(plan.waves[2].map((unit) => unit.key), ["report"]);
  assert.ok(plan.memoKey.length === 64);
});

test("a request is planned against its resolved spec node", () => {
  const spec = normalizeAgentSpec(SESSION_SPEC);
  const result = planInvocationFromRequest(
    { nodeId: "agent-spec:build", prompt: "go" },
    spec,
    { parentTools: ["read", "edit", "bash"] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.plan.specName, "build");
  assert.throws(() => planInvocationFromRequest(null, spec), /must be an object/);
});
