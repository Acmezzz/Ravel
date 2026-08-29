import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentSpecAddress,
  agentSpecNodeIds,
  agentSpecRevisionId,
  isReadOnlyToolSet,
  normalizeAgentSpec,
  planOrchestration,
  renderPrompt,
  resolveSpecTools,
  seedSpecs,
  modeProfileToAgentSpec,
  modeProfileGraph,
  skillToAgentSpec,
  subagentToAgentSpec,
  draftAgentSpecSchema,
  validateDraftAgentSpec,
  promoteDraftAgentSpec,
  SPEC_SCHEMA_VERSION,
  BUDGET_CAPS,
  GOAL_SEED_MAX_RUNTIME_MS,
} from "../electron/histos-agent-spec.js";
import { aggregateRunText, mapWithConcurrencyLimit, runOrchestration } from "../electron/histos-agent-orchestrator.js";
import { SUBAGENT_TOOLS } from "../electron/task-service.js";

const BASE = { name: "reviewer", description: "Reviews a diff for defects" };

test("normalizeAgentSpec fills in the safe defaults", () => {
  const spec = normalizeAgentSpec(BASE);
  assert.equal(spec.strategy, "single");
  assert.deepEqual(spec.tools, [...SUBAGENT_TOOLS].sort());
  assert.equal(spec.maxConcurrency, 3);
  assert.equal(spec.maxDepth, 1);
  assert.deepEqual(spec.steps, []);
});

test("normalizeAgentSpec rejects specs without identity", () => {
  assert.throws(() => normalizeAgentSpec({ description: "x" }), /requires a name/);
  assert.throws(() => normalizeAgentSpec({ name: "x" }), /requires a description/);
  assert.throws(() => normalizeAgentSpec({ name: "-bad", description: "x" }), /must start alphanumeric/);
  assert.throws(() => normalizeAgentSpec({ name: "ok", description: "x", strategy: "fanout" }), /strategy must be one of/);
});

test("a spec can narrow its tool surface but never widen it", () => {
  assert.deepEqual(resolveSpecTools(["read", "grep"]), { tools: ["grep", "read"], dropped: [] });
  // Requesting a mutating tool drops it instead of granting it.
  assert.deepEqual(resolveSpecTools(["read", "bash"]), { tools: ["read"], dropped: ["bash"] });
  const narrowed = normalizeAgentSpec({ ...BASE, tools: ["read", "bash"] });
  assert.deepEqual(narrowed.tools, ["read"]);
  assert.deepEqual(narrowed.droppedTools, ["bash"]);
  assert.throws(() => resolveSpecTools(["bash", "write"]), /resolved to an empty set/);
});

test("isReadOnlyToolSet only accepts the non-mutating family", () => {
  assert.equal(isReadOnlyToolSet(["read", "grep"]), true);
  assert.equal(isReadOnlyToolSet(["bash"]), false);
  assert.equal(isReadOnlyToolSet([]), false);
});

test("spec revisions are content addressed and order independent", () => {
  const a = agentSpecRevisionId({ ...BASE, tools: ["read", "grep"] });
  const b = agentSpecRevisionId({ tools: ["grep", "read"], description: BASE.description, name: BASE.name });
  assert.equal(a, b);
  const changed = agentSpecRevisionId({ ...BASE, tools: ["read"] });
  assert.notEqual(a, changed);
});

test("a spec keeps a stable node identity across revisions", () => {
  const first = agentSpecNodeIds({ ...BASE, tools: ["read"] });
  const second = agentSpecNodeIds({ ...BASE, tools: ["grep"] });
  assert.equal(first.nodeId, second.nodeId);
  assert.notEqual(first.nodeRevisionId, second.nodeRevisionId);
  assert.equal(agentSpecAddress({ ...BASE }).sourceType, "agent_spec");
});

test("parallel and chain strategies require declared steps", () => {
  assert.throws(() => normalizeAgentSpec({ ...BASE, strategy: "parallel" }), /requires at least one step/);
  assert.throws(() => normalizeAgentSpec({ ...BASE, strategy: "chain" }), /requires at least one step/);
  assert.throws(
    () => normalizeAgentSpec({ ...BASE, strategy: "single", steps: ["a", "b"] }),
    /accepts at most one step/,
  );
});

test("planOrchestration expands a parallel spec into one unit per step", () => {
  const spec = normalizeAgentSpec({
    ...BASE,
    strategy: "parallel",
    steps: [{ spec: "security", prompt: "audit {input}" }, { spec: "style", prompt: "lint {input}" }],
  });
  const plan = planOrchestration(spec, { input: "src/a.ts" });
  assert.equal(plan.strategy, "parallel");
  assert.deepEqual(plan.units.map((unit) => unit.spec), ["security", "style"]);
  assert.deepEqual(plan.units.map((unit) => unit.prompt), ["audit src/a.ts", "lint src/a.ts"]);
});

test("planOrchestration inherits a child spec's tools and model", () => {
  const registry = {
    security: { name: "security", description: "finds vulnerabilities", tools: ["read", "grep"], model: "strong" },
  };
  const spec = normalizeAgentSpec({ ...BASE, strategy: "parallel", steps: ["security"] });
  const plan = planOrchestration(spec, { resolveSpec: (name) => registry[name] });
  assert.deepEqual(plan.units[0].tools, ["grep", "read"]);
  assert.equal(plan.units[0].model, "strong");
});

test("planOrchestration refuses to exceed maxDepth", () => {
  const registry = { child: { name: "child", description: "inner", maxDepth: 1 } };
  const spec = normalizeAgentSpec({ ...BASE, strategy: "parallel", steps: ["child"], maxDepth: 1 });
  assert.throws(() => planOrchestration(spec, { resolveSpec: (name) => registry[name], depth: 1 }), /maxDepth/);
});

test("renderPrompt substitutes known placeholders and leaves typos visible", () => {
  assert.equal(renderPrompt("a {input} b {previous}", { input: "I", previous: "P" }), "a I b P");
  assert.equal(renderPrompt("a {unkown} b", { input: "I" }), "a {unkown} b");
});

function deferredRunner(values) {
  const calls = [];
  const runner = async ({ prompt }) => {
    calls.push(prompt);
    const value = typeof values === "function" ? values(prompt, calls.length) : values;
    if (value instanceof Error) throw value;
    return { text: typeof value === "string" ? value : `out:${prompt}`, sessionId: `s${calls.length}` };
  };
  return { runner, calls };
}

test("mapWithConcurrencyLimit preserves input order and respects the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [60, 10, 40, 20, 30];
  const { results, aborted } = await mapWithConcurrencyLimit(items, 2, async (delay) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, delay));
    inFlight -= 1;
    return delay;
  });
  assert.deepEqual(results, items);
  assert.equal(aborted, false);
  assert.equal(peak, 2);
});

test("mapWithConcurrencyLimit fails fast on the first rejection", async () => {
  const started = [];
  await assert.rejects(
    () =>
      mapWithConcurrencyLimit([1, 2, 3, 4], 2, async (item) => {
        started.push(item);
        if (item === 2) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return item;
      }),
    /boom/,
  );
  // Siblings stop being scheduled once one fails.
  assert.ok(started.length < 4);
});

test("mapWithConcurrencyLimit keeps completed work when aborted externally", async () => {
  const controller = new AbortController();
  const { results, aborted } = await mapWithConcurrencyLimit([1, 2, 3, 4], 1, async (item) => {
    if (item === 2) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return item;
  }, controller.signal);
  assert.equal(aborted, true);
  assert.equal(results[0], 1);
});

test("runOrchestration runs a single spec", async () => {
  const { runner, calls } = deferredRunner("done");
  const run = await runOrchestration({ spec: { ...BASE, prompt: "check {input}" }, runner, input: "src/a.ts" });
  assert.equal(run.ok, true);
  assert.equal(run.strategy, "single");
  assert.deepEqual(calls, ["check src/a.ts"]);
  assert.equal(aggregateRunText(run), "done");
  assert.equal(run.specName, "reviewer");
  assert.match(run.specRevisionId, /^[0-9a-f]{64}$/);
});

test("runOrchestration fans out in parallel and returns every result", async () => {
  const { runner } = deferredRunner();
  const run = await runOrchestration({
    spec: {
      ...BASE,
      strategy: "parallel",
      steps: [{ spec: "security", prompt: "audit {input}" }, { spec: "style", prompt: "lint {input}" }],
      maxConcurrency: 2,
    },
    runner,
    input: "src/a.ts",
  });
  assert.equal(run.unitCount, 2);
  assert.equal(run.completedCount, 2);
  assert.equal(aggregateRunText(run), "out:audit src/a.ts\n\nout:lint src/a.ts");
});

test("runOrchestration threads each chain step's output into the next", async () => {
  const { runner, calls } = deferredRunner((prompt) => `result-of:${prompt}`);
  const run = await runOrchestration({
    spec: {
      ...BASE,
      strategy: "chain",
      steps: [{ spec: "one", prompt: "first {input}" }, { spec: "two", prompt: "then {previous}" }],
    },
    runner,
    input: "seed",
  });
  assert.deepEqual(calls, ["first seed", "then result-of:first seed"]);
  assert.equal(run.units[1].text, "result-of:then result-of:first seed");
});

test("runOrchestration records a timeout instead of hanging", async () => {
  const run = await runOrchestration({
    spec: BASE,
    runner: () => new Promise((resolve) => setTimeout(() => resolve({ text: "late" }), 300)),
    timeoutMs: 10,
  });
  assert.equal(run.ok, false);
  assert.equal(run.timedOut, true);
  assert.equal(run.errorCode, "orchestration_timeout");
});

test("runOrchestration surfaces a runner failure with its code", async () => {
  const error = Object.assign(new Error("no model"), { code: "no_model" });
  await assert.rejects(() => runOrchestration({ spec: BASE, runner: async () => { throw error; } }), (thrown) => thrown.code === "no_model");
});

test("runOrchestration propagates an abort without discarding finished units", async () => {
  const controller = new AbortController();
  const run = await runOrchestration({
    spec: { ...BASE, strategy: "parallel", steps: ["a", "b", "c", "d"], maxConcurrency: 1 },
    runner: async ({ prompt }) => {
      // The second unit receives "{previous}"-free input marking the abort point.
      if (prompt.includes("input:b")) controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { text: prompt };
    },
    input: "input:b",
    signal: controller.signal,
  });
  assert.equal(run.aborted, true);
  assert.ok(run.completedCount >= 1);
  assert.ok(run.completedCount < 4);
});

test("a spec defaults to the child surface, agent-loop executor and draft trust", () => {
  const spec = normalizeAgentSpec({ name: "reviewer", description: "Reviews a diff" });
  assert.equal(spec.surface, "child");
  assert.equal(spec.executor, "agent-loop");
  assert.equal(spec.trust, "draft");
  assert.equal(spec.schemaVersion, SPEC_SCHEMA_VERSION);
});

test("a child spec can never widen past the read-only ceiling", () => {
  const narrowed = normalizeAgentSpec({ name: "reviewer", description: "d", tools: ["read", "bash", "edit"] });
  assert.deepEqual(narrowed.tools, ["read"]);
  assert.deepEqual(narrowed.droppedTools, ["bash", "edit"]);
  // The same request on a session surface is legitimate: build needs to write.
  const session = normalizeAgentSpec({ name: "builder", description: "d", surface: "session", tools: ["read", "edit", "bash"] });
  assert.deepEqual(session.tools, ["bash", "edit", "read"]);
});

test("the executor must belong to the declared surface", () => {
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", surface: "child", executor: "orchestrator" }), /not allowed for surface/);
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", executor: "nope" }), /executor must be one of/);
  const workflow = normalizeAgentSpec({ name: "pipe", description: "d", surface: "workflow", strategy: "parallel", steps: ["a", "b"] });
  assert.equal(workflow.executor, "orchestrator");
  assert.equal(normalizeAgentSpec({ name: "skill", description: "d", surface: "invocation" }).executor, "skill-inject");
});

test("trust is validated and never defaults above draft", () => {
  assert.equal(normalizeAgentSpec({ name: "x", description: "d" }).trust, "draft");
  assert.equal(normalizeAgentSpec({ name: "x", description: "d", trust: "approved" }).trust, "approved");
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", trust: "root" }), /trust must be one of/);
});

test("budget is clamped to the caps and fails closed on nonsense", () => {
  const spec = normalizeAgentSpec({ name: "x", description: "d", budget: { maxSteps: 999_999, maxRuntimeMs: 60_000 } });
  assert.equal(spec.budget.maxSteps, BUDGET_CAPS.maxSteps);
  assert.equal(spec.budget.maxRuntimeMs, 60_000);
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", budget: { maxSteps: 0 } }), /positive integer/);
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", budget: { maxSteps: "many" } }), /positive integer/);
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", budget: [] }), /budget must be an object/);
});

test("contract completion is validated and oversized schemas are refused", () => {
  const spec = normalizeAgentSpec({ name: "x", description: "d", contract: { completion: "round-cap" } });
  assert.deepEqual(spec.contract, { completion: "round-cap" });
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", contract: { completion: "vibes" } }), /completion must be one of/);
  const huge = { type: "object", properties: { pad: "x".repeat(9_000) } };
  assert.throws(() => normalizeAgentSpec({ name: "x", description: "d", contract: { outputSchema: huge } }), /exceeds/);
});

test("step dependencies are keyed, resolve, and reject cycles", () => {
  const spec = normalizeAgentSpec({
    name: "pipe",
    description: "d",
    surface: "workflow",
    strategy: "parallel",
    steps: [
      { key: "explore", spec: "scout" },
      { key: "review", spec: "reviewer", dependsOn: ["explore"] },
    ],
  });
  assert.deepEqual(spec.steps[1].dependsOn, ["explore"]);
  assert.throws(() => normalizeAgentSpec({
    name: "pipe", description: "d", surface: "workflow", strategy: "parallel",
    steps: [{ key: "a", spec: "x", dependsOn: ["ghost"] }],
  }), /unknown key/);
  assert.throws(() => normalizeAgentSpec({
    name: "pipe", description: "d", surface: "workflow", strategy: "parallel",
    steps: [{ key: "a", spec: "x", dependsOn: ["a"] }],
  }), /depends on itself/);
  assert.throws(() => normalizeAgentSpec({
    name: "pipe", description: "d", surface: "workflow", strategy: "parallel",
    steps: [
      { key: "a", spec: "x", dependsOn: ["b"] },
      { key: "b", spec: "y", dependsOn: ["a"] },
    ],
  }), /dependency cycle/);
  assert.throws(() => normalizeAgentSpec({
    name: "pipe", description: "d", surface: "workflow", strategy: "parallel",
    steps: [{ key: "a", spec: "x" }, { key: "a", spec: "y" }],
  }), /duplicate spec step key/);
});

test("the plan carries step keys and dependencies into the units", () => {
  const spec = normalizeAgentSpec({
    name: "pipe",
    description: "d",
    surface: "workflow",
    strategy: "parallel",
    steps: [
      { key: "explore", spec: "scout" },
      { key: "review", spec: "reviewer", dependsOn: ["explore"] },
    ],
  });
  const plan = planOrchestration(spec);
  assert.deepEqual(plan.units.map((unit) => unit.key), ["explore", "review"]);
  assert.deepEqual(plan.units[0].dependsOn, undefined);
  assert.deepEqual(plan.units[1].dependsOn, ["explore"]);
});

test("mode profiles project to graph-addressable agent specs", () => {
  const plan = modeProfileToAgentSpec("plan");
  assert.equal(plan.name, "mode.plan");
  assert.equal(plan.surface, "session");
  assert.deepEqual(plan.tools, ["find", "grep", "ls", "read"]);
  assert.equal(plan.contract.completion, "human-review");
  const graph = modeProfileGraph("plan");
  assert.equal(graph.nodes[0].metadata.modeProfile, "plan");
  assert.equal(graph.nodes[0].metadata.histosProfile, "plan.explore");
  assert.throws(() => modeProfileToAgentSpec("missing"), /unsupported mode profile/);
});

test("skills and task subagents map to safe draft specs", () => {
  const skill = skillToAgentSpec({ name: "review", description: "Review changes", content: "Read only" });
  assert.equal(skill.name, "skill.review");
  assert.equal(skill.surface, "invocation");
  assert.equal(skill.executor, "skill-inject");
  assert.equal(skill.trust, "draft");
  const task = subagentToAgentSpec({ prompt: "inspect files" });
  assert.equal(task.surface, "child");
  assert.deepEqual(task.tools, ["find", "grep", "ls", "read"]);
});

test("draft schema validates model output and requires explicit trust promotion", () => {
  assert.equal(draftAgentSpecSchema().properties.trust.const, "draft");
  const draft = validateDraftAgentSpec({ name: "draft", description: "Draft spec", tools: ["read", "bash"] });
  assert.equal(draft.trust, "draft");
  assert.throws(() => promoteDraftAgentSpec(draft), (error) => error.code === "trust_required");
  const promoted = promoteDraftAgentSpec(draft, "reviewed", { approved: true });
  assert.equal(promoted.trust, "reviewed");
  assert.deepEqual(promoted.tools, ["read"]);
  assert.throws(() => promoteDraftAgentSpec(draft, "approved", { approved: false }), /explicit approval/);
});

test("the three seed patterns are ordinary specs with distinct authority", () => {
  const seeds = seedSpecs();
  assert.deepEqual(seeds.map((spec) => spec.name), ["plan", "goal", "build"]);
  for (const spec of seeds) {
    assert.equal(spec.surface, "session");
    assert.equal(spec.executor, "agent-loop");
    assert.equal(spec.trust, "approved");
  }
  const [plan, goal, build] = seeds;
  assert.deepEqual(plan.tools, ["find", "grep", "ls", "read"]);
  assert.equal(plan.contract.completion, "human-review");
  assert.equal(goal.contract.completion, "round-cap");
  assert.equal(goal.budget.maxRuntimeMs, GOAL_SEED_MAX_RUNTIME_MS);
  assert.ok(build.tools.includes("bash"));
  assert.ok(build.tools.includes("edit"));
});
