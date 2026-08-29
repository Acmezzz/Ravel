import { createHash } from "node:crypto";
import { SUBAGENT_TOOLS } from "./task-service.js";
import { canonicalJson } from "./histos-address.js";
import { getModeProfile, GOAL_ELAPSED_CAP_MS } from "./mode-profiles.js";

/**
 * Agent spec: an orchestration configuration, stored as a Histos revision.
 *
 * The design goal is that an orchestration is data, not code. A spec is a
 * content addressed document — same bytes, same revision id — so editing a
 * spec produces a new revision that can be diffed against the previous one
 * instead of silently replacing it. That is what makes "design several
 * orchestrations for one sub-agent" a matter of writing revisions rather than
 * adding branches to a runner.
 *
 * Adapted from oh-my-pi's agent frontmatter (name/description/tools/spawns/
 * output/model) with two Ravel-specific constraints:
 *
 *   1. Narrowing invariant. A spec may only narrow the parent's tool surface,
 *      never widen it. Anything unrecognised is dropped, not trusted.
 *   2. Explicit strategy. oh-my-pi encodes fan-out in the model's tool calls;
 *      here the fan-out is declared (`strategy` + `steps`) so the orchestration
 *      itself is inspectable and revisionable.
 *
 * Pure module: no IO, no Electron, no network.
 */

/** Bumped when the normalized shape changes so stored revisions stay comparable. */
export const SPEC_SCHEMA_VERSION = 2;
/** Mirrors mode-profiles' goal budget so the seed and the code fallback agree. */
export const GOAL_SEED_MAX_RUNTIME_MS = GOAL_ELAPSED_CAP_MS;

export const SPEC_STRATEGIES = Object.freeze(["single", "parallel", "chain"]);
export const DEFAULT_MAX_CONCURRENCY = 3;
export const MAX_SPEC_STEPS = 16;
export const MAX_SPEC_NAME = 64;
export const MAX_SPEC_DESCRIPTION = 1_024;
export const MAX_SPEC_DEPTH = 4;

/** Tools a child may ever receive. Sourced from task-service so there is one authority. */
export const ALLOWED_SPEC_TOOLS = Object.freeze([...SUBAGENT_TOOLS]);
const ALLOWED_TOOL_SET = new Set(ALLOWED_SPEC_TOOLS);

// ===== Unified namespace: surfaces, executors, trust =====
//
// A mode, a skill, a subagent and a scheduling DAG are the same primitive
// (`agent_spec`) bound to a session in four different ways. `surface` is that
// binding; `executor` is the closed set of code paths allowed to run it.

export const SPEC_SURFACES = Object.freeze(["session", "invocation", "child", "workflow"]);
export const SPEC_EXECUTORS = Object.freeze(["agent-loop", "skill-inject", "orchestrator", "flow-engine"]);
export const SPEC_TRUST = Object.freeze(["draft", "reviewed", "approved"]);
export const SPEC_COMPLETIONS = Object.freeze(["human-review", "evidence", "round-cap"]);

/** Kept as the default so existing child/subagent specs normalize unchanged. */
export const DEFAULT_SURFACE = "child";

const READ_TOOLS = Object.freeze([...SUBAGENT_TOOLS]);
const WRITE_TOOLS = Object.freeze(["edit", "write"]);
const EXEC_TOOLS = Object.freeze(["bash"]);

/**
 * Hard ceiling per surface. A spec may narrow inside its surface ceiling but
 * never widen past it, so a `child` spec can never obtain `bash` no matter what
 * the model or the user asks for.
 */
export const SURFACE_TOOL_CEILING = Object.freeze({
  session: Object.freeze([...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS]),
  invocation: Object.freeze([...READ_TOOLS, ...WRITE_TOOLS]),
  child: Object.freeze([...READ_TOOLS]),
  workflow: Object.freeze([...READ_TOOLS]),
});

/** Which executors a surface may bind to. Anything else is refused, not coerced. */
export const SURFACE_EXECUTORS = Object.freeze({
  session: Object.freeze(["agent-loop"]),
  invocation: Object.freeze(["skill-inject"]),
  child: Object.freeze(["agent-loop"]),
  workflow: Object.freeze(["orchestrator", "flow-engine"]),
});

const DEFAULT_SURFACE_EXECUTOR = Object.freeze({
  session: "agent-loop",
  invocation: "skill-inject",
  child: "agent-loop",
  workflow: "orchestrator",
});

/** Budget ceilings. A spec may ask for less, never more. */
export const BUDGET_CAPS = Object.freeze({
  maxSteps: 500,
  maxRuntimeMs: 24 * 60 * 60 * 1000,
  maxTokens: 20_000_000,
});
const MAX_CONTRACT_BYTES = 8_192;
const DRAFT_TARGET_TRUST = new Set(["reviewed", "approved"]);

function modeProfileSpecName(modeId) {
  return `mode.${modeId}`;
}

/** Convert a frozen session mode into a declarative agent_spec. */
export function modeProfileToAgentSpec(modeId) {
  const profile = getModeProfile(modeId);
  if (!profile) throw invalid(`unsupported mode profile "${modeId}"`);
  const budget = profile.budget
    ? {
        ...(Number.isSafeInteger(profile.budget.roundCap) ? { maxSteps: profile.budget.roundCap } : {}),
        ...(Number.isSafeInteger(profile.budget.elapsedCapMs) ? { maxRuntimeMs: profile.budget.elapsedCapMs } : {}),
      }
    : undefined;
  return normalizeAgentSpec({
    name: modeProfileSpecName(profile.id),
    description: `${profile.title}会话模式`,
    surface: "session",
    executor: "agent-loop",
    trust: "approved",
    strategy: "single",
    tools: profile.tools ?? undefined,
    ...(budget && Object.keys(budget).length ? { budget } : {}),
    ...(profile.completion ? { contract: { completion: profile.completion } } : {}),
  });
}

/** Project one mode profile as a graph-addressable agent_spec node. */
export function modeProfileGraph(modeId) {
  const spec = modeProfileToAgentSpec(modeId);
  const graph = agentSpecGraph(spec);
  graph.nodes[0].metadata.modeProfile = modeId;
  graph.nodes[0].metadata.histosProfile = getModeProfile(modeId).histosProfile;
  return graph;
}

/** Map a skill declaration to a draft invocation spec; content remains data. */
export function skillToAgentSpec(skill, options = {}) {
  if (!skill || typeof skill !== "object") throw invalid("skill must be an object");
  const name = typeof skill.name === "string" ? skill.name.trim() : "";
  const description = typeof skill.description === "string" ? skill.description.trim() : "";
  if (!name || !description) throw invalid("skill requires a name and description");
  const content = typeof skill.content === "string" ? skill.content : "";
  return normalizeAgentSpec({
    name: options.name ?? `skill.${name}`,
    description,
    surface: "invocation",
    executor: "skill-inject",
    trust: "draft",
    strategy: "single",
    tools: ["find", "grep", "ls", "read"],
    ...(content ? { prompt: content } : {}),
    ...(options.contract ? { contract: options.contract } : {}),
  });
}

/** Map the bounded task declaration to a read-only draft child spec. */
export function subagentToAgentSpec(task, options = {}) {
  if (!task || typeof task !== "object" || typeof task.prompt !== "string" || !task.prompt.trim()) {
    throw invalid("subagent task requires a non-empty prompt");
  }
  return normalizeAgentSpec({
    name: options.name ?? "subagent.task",
    description: options.description ?? "只读子代理任务",
    surface: "child",
    executor: "agent-loop",
    trust: "draft",
    strategy: "single",
    tools: ["find", "grep", "ls", "read"],
    prompt: task.prompt.trim(),
  });
}

/** Minimal JSON-schema-like contract for conversational draft generation. */
export function draftAgentSpecSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "description"],
    properties: {
      name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", maxLength: MAX_SPEC_NAME },
      description: { type: "string", maxLength: MAX_SPEC_DESCRIPTION },
      surface: { enum: [...SPEC_SURFACES] },
      executor: { enum: [...SPEC_EXECUTORS] },
      trust: { const: "draft" },
      strategy: { enum: [...SPEC_STRATEGIES] },
      tools: { type: "array", items: { type: "string" } },
      steps: { type: "array", maxItems: MAX_SPEC_STEPS },
      budget: { type: "object" },
      contract: { type: "object" },
      model: { type: "string", maxLength: 128 },
      prompt: { type: "string" },
    },
  };
}

/** Validate and normalize a model-produced draft; promotion is a separate action. */
export function validateDraftAgentSpec(raw) {
  const spec = normalizeAgentSpec({ ...(raw ?? {}), trust: "draft" });
  return spec;
}

/** Promote only a draft with explicit caller approval; never widens its tools. */
export function promoteDraftAgentSpec(raw, targetTrust = "reviewed", options = {}) {
  if (!DRAFT_TARGET_TRUST.has(targetTrust)) throw invalid(`target trust must be reviewed or approved`);
  const draft = validateDraftAgentSpec(raw);
  if (options.approved !== true) throw Object.assign(new Error("draft promotion requires explicit approval"), { code: "trust_required" });
  return normalizeAgentSpec({ ...draft, trust: targetTrust });
}

export const agentSpecFromModeProfile = modeProfileToAgentSpec;
export const agentSpecFromSkill = skillToAgentSpec;
export const agentSpecFromSubagent = subagentToAgentSpec;
export const normalizeDraftSpec = validateDraftAgentSpec;
export const promoteAgentSpec = promoteDraftAgentSpec;

function invalid(message, code = "invalid_args") {
  return Object.assign(new TypeError(message), { code });
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseList(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return [];
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

/**
 * Resolve a spec's tool surface.
 *
 * Fail-safe in the same spirit as oh-my-pi's read-only policy: an unknown tool
 * does not make the agent read-only, it makes the request invalid. Requested
 * tools outside the child allowlist are dropped, so a spec can narrow but never
 * widen. An empty result is rejected — a subagent with no tools is a mistake,
 * not a configuration.
 */
export function resolveSpecTools(requested, allowed = ALLOWED_TOOL_SET) {
  if (requested === undefined || requested === null) return [...allowed].sort();
  const list = parseList(requested);
  if (list === undefined) throw invalid("spec tools must be an array or comma-separated string");
  const kept = [];
  const dropped = [];
  for (const tool of list) {
    if (allowed.has(tool)) {
      if (!kept.includes(tool)) kept.push(tool);
    } else if (!dropped.includes(tool)) {
      dropped.push(tool);
    }
  }
  if (kept.length === 0) throw invalid("spec tools resolved to an empty set");
  return { tools: kept.sort(), dropped: dropped.sort() };
}

/**
 * True when every tool in the surface is non-mutating. Since the only allowed
 * set is the read-only family this is normally true; it is kept explicit so a
 * future widening of the allowlist has to answer the question.
 */
export function isReadOnlyToolSet(tools) {
  return Array.isArray(tools) && tools.length > 0 && tools.every((tool) => ALLOWED_TOOL_SET.has(tool));
}

function normalizeStep(raw, index) {
  if (typeof raw === "string") raw = { spec: raw };
  if (!raw || typeof raw !== "object") throw invalid(`spec step ${index} must be an object or a spec name`);
  const name = typeof raw.spec === "string" ? raw.spec.trim() : "";
  if (!name) throw invalid(`spec step ${index} requires a spec name`);
  if (name.length > MAX_SPEC_NAME) throw invalid(`spec step ${index} name is too long`);
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (prompt.length > 40_000) throw invalid(`spec step ${index} prompt is too long`);
  // `key` is stable and addressable: a DAG step is referenced by key, never by
  // position, so reordering steps does not silently rewire dependencies.
  const key = typeof raw.key === "string" && raw.key.trim() ? raw.key.trim().slice(0, MAX_SPEC_NAME) : `${index}:${name}`;
  const dependsOn = parseList(raw.dependsOn) ?? [];
  for (const dep of dependsOn) {
    if (dep.length > MAX_SPEC_NAME) throw invalid(`spec step ${index} depends on an over-long key`);
  }
  return {
    key,
    spec: name,
    ...(prompt ? { prompt } : {}),
    ...(dependsOn.length ? { dependsOn: [...new Set(dependsOn)].sort() } : {}),
    ...(Number.isSafeInteger(raw.maxConcurrency) ? { maxConcurrency: raw.maxConcurrency } : {}),
  };
}

/**
 * Reject dependency graphs that cannot be executed: unknown keys, duplicate
 * keys, self reference, and cycles. Failing here is cheaper than discovering it
 * mid-run with a partially executed workflow.
 */
function assertAcyclic(steps) {
  const byKey = new Map();
  for (const step of steps) {
    if (byKey.has(step.key)) throw invalid(`duplicate spec step key "${step.key}"`);
    byKey.set(step.key, step);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (dep === step.key) throw invalid(`spec step "${step.key}" depends on itself`);
      if (!byKey.has(dep)) throw invalid(`spec step "${step.key}" depends on unknown key "${dep}"`);
    }
  }
  const state = new Map();
  const visit = (step) => {
    const current = state.get(step.key);
    if (current === "done") return;
    if (current === "visiting") throw invalid(`spec steps contain a dependency cycle at "${step.key}"`);
    state.set(step.key, "visiting");
    for (const dep of step.dependsOn ?? []) visit(byKey.get(dep));
    state.set(step.key, "done");
  };
  for (const step of steps) visit(step);
}

function normalizeSurface(raw) {
  const surface = raw === undefined || raw === null ? DEFAULT_SURFACE : raw;
  if (typeof surface !== "string" || !SPEC_SURFACES.includes(surface)) {
    throw invalid(`spec surface must be one of ${SPEC_SURFACES.join(", ")}`);
  }
  return surface;
}

function normalizeExecutor(raw, surface) {
  const allowed = SURFACE_EXECUTORS[surface];
  if (raw === undefined || raw === null) return DEFAULT_SURFACE_EXECUTOR[surface];
  if (typeof raw !== "string" || !SPEC_EXECUTORS.includes(raw)) {
    throw invalid(`spec executor must be one of ${SPEC_EXECUTORS.join(", ")}`);
  }
  if (!allowed.includes(raw)) throw invalid(`spec executor "${raw}" is not allowed for surface "${surface}"`);
  return raw;
}

function normalizeTrust(raw) {
  if (raw === undefined || raw === null) return "draft";
  if (typeof raw !== "string" || !SPEC_TRUST.includes(raw)) {
    throw invalid(`spec trust must be one of ${SPEC_TRUST.join(", ")}`);
  }
  return raw;
}

/**
 * Budget only ever shrinks: every field is clamped into [1, cap] and an
 * unparseable value fails closed rather than being ignored.
 */
function normalizeBudget(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid("spec budget must be an object");
  const budget = {};
  for (const field of Object.keys(BUDGET_CAPS)) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (!Number.isSafeInteger(value) || value < 1) throw invalid(`spec budget ${field} must be a positive integer`);
    budget[field] = Math.min(value, BUDGET_CAPS[field]);
  }
  return Object.keys(budget).length ? budget : null;
}

function normalizeContract(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid("spec contract must be an object");
  const contract = {};
  if (raw.completion !== undefined && raw.completion !== null) {
    if (!SPEC_COMPLETIONS.includes(raw.completion)) {
      throw invalid(`spec contract completion must be one of ${SPEC_COMPLETIONS.join(", ")}`);
    }
    contract.completion = raw.completion;
  }
  for (const field of ["inputSchema", "outputSchema"]) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) throw invalid(`spec contract ${field} must be an object`);
    const size = canonicalJson(value).length;
    if (size > MAX_CONTRACT_BYTES) throw invalid(`spec contract ${field} exceeds ${MAX_CONTRACT_BYTES} bytes`);
    contract[field] = value;
  }
  return Object.keys(contract).length ? contract : null;
}

/**
 * Validate and normalize a spec document.
 *
 * `strategy` decides how `steps` are executed:
 *   single   — one step, no fan-out (the default when no steps are declared)
 *   parallel — every step receives the same input; results arrive as an array
 *   chain    — each step receives the previous step's output as `{previous}`
 */
export function normalizeAgentSpec(raw) {
  if (!raw || typeof raw !== "object") throw invalid("spec must be an object");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) throw invalid("spec requires a name");
  if (name.length > MAX_SPEC_NAME) throw invalid(`spec name exceeds ${MAX_SPEC_NAME} characters`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw invalid("spec name must start alphanumeric and contain only . _ -");
  const description = typeof raw.description === "string" ? raw.description.trim().slice(0, MAX_SPEC_DESCRIPTION) : "";
  if (!description) throw invalid("spec requires a description");

  const strategy = raw.strategy === undefined ? "single" : raw.strategy;
  if (!SPEC_STRATEGIES.includes(strategy)) throw invalid(`spec strategy must be one of ${SPEC_STRATEGIES.join(", ")}`);

  const surface = normalizeSurface(raw.surface);
  const executor = normalizeExecutor(raw.executor, surface);
  const trust = normalizeTrust(raw.trust);
  const budget = normalizeBudget(raw.budget);
  const contract = normalizeContract(raw.contract);

  // The ceiling is chosen by surface, so a child spec cannot obtain `bash` or
  // `edit` no matter who asks. Narrowing is allowed; widening is not.
  const ceiling = new Set(SURFACE_TOOL_CEILING[surface]);
  const resolved = resolveSpecTools(raw.tools, ceiling);
  const tools = Array.isArray(resolved) ? resolved : resolved.tools;
  const droppedTools = Array.isArray(resolved) ? [] : resolved.dropped;
  if (surface === "child" && !isReadOnlyToolSet(tools)) {
    throw invalid("child spec tools must stay inside the read-only subagent family");
  }

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (rawSteps.length > MAX_SPEC_STEPS) throw invalid(`spec declares more than ${MAX_SPEC_STEPS} steps`);
  const steps = rawSteps.map(normalizeStep);
  assertAcyclic(steps);
  if (strategy !== "single" && steps.length === 0) throw invalid(`spec strategy "${strategy}" requires at least one step`);
  if (strategy === "single" && steps.length > 1) throw invalid('spec strategy "single" accepts at most one step');

  const maxConcurrency = Number.isSafeInteger(raw.maxConcurrency)
    ? Math.min(Math.max(raw.maxConcurrency, 1), MAX_SPEC_STEPS)
    : DEFAULT_MAX_CONCURRENCY;
  const depth = Number.isSafeInteger(raw.maxDepth) ? Math.min(Math.max(raw.maxDepth, 1), MAX_SPEC_DEPTH) : 1;
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim().slice(0, 128) : null;
  const promptTemplate = typeof raw.prompt === "string" ? raw.prompt : null;

  const spec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    name,
    description,
    surface,
    executor,
    trust,
    strategy,
    tools,
    maxConcurrency,
    maxDepth: depth,
    steps,
  };
  if (budget) spec.budget = budget;
  if (contract) spec.contract = contract;
  if (model) spec.model = model;
  if (promptTemplate) spec.prompt = promptTemplate;
  if (droppedTools.length) spec.droppedTools = droppedTools;
  return spec;
}

/**
 * The three seed patterns. They are ordinary specs — not a mode enum — so a
 * workspace's `plan` can be edited, diffed and derived from exactly like any
 * other spec. `build` is the only one carrying write/exec tools, and it keeps
 * the normal approval path rather than a mode-specific bypass.
 */
export function seedSpecs() {
  const seeds = [
    {
      name: "plan",
      description: "只读探索并产出计划，等待人工审阅后才执行",
      surface: "session",
      executor: "agent-loop",
      trust: "approved",
      strategy: "single",
      tools: [...READ_TOOLS],
      budget: { maxSteps: 30 },
      contract: { completion: "human-review" },
      prompt: "先读代码与上下文，充分理解后再给出计划。除计划文件外不修改任何内容。",
    },
    {
      name: "goal",
      description: "在预算内持续推进一个目标，由预算耗尽而非自述完成来结束",
      surface: "session",
      executor: "agent-loop",
      trust: "approved",
      strategy: "single",
      tools: [...READ_TOOLS, ...WRITE_TOOLS],
      budget: { maxSteps: 200, maxRuntimeMs: GOAL_SEED_MAX_RUNTIME_MS, maxTokens: 2_000_000 },
      contract: { completion: "round-cap" },
    },
    {
      name: "build",
      description: "完整开发模式：读写改并执行，写操作走正常审批",
      surface: "session",
      executor: "agent-loop",
      trust: "approved",
      strategy: "single",
      tools: [...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS],
      budget: { maxSteps: 100 },
      contract: { completion: "human-review" },
    },
  ];
  return seeds.map((seed) => normalizeAgentSpec(seed));
}

/**
 * The content address of a spec. Two specs with identical semantics hash
 * identically regardless of key order, because the canonical form is sorted.
 */
export function agentSpecRevisionId(spec) {
  return sha256Hex(canonicalJson(normalizeAgentSpec(spec)));
}

/**
 * The FactAddress of a spec revision. objectId is the spec name (stable),
 * revisionId is its content address (changes on every edit).
 */
export function agentSpecAddress(spec) {
  const normalized = normalizeAgentSpec(spec);
  return { sourceType: "agent_spec", objectId: normalized.name, revisionId: agentSpecRevisionId(normalized) };
}

export function agentSpecNodeIds(spec) {
  const normalized = normalizeAgentSpec(spec);
  return {
    nodeId: `agent-spec:${normalized.name}`,
    nodeRevisionId: sha256Hex(`agent-spec-node:${normalized.name}:${agentSpecRevisionId(normalized)}`),
  };
}

/**
 * Expand a spec into the ordered list of units an orchestrator must run.
 * Returns a flat plan; nesting beyond `maxDepth` is refused rather than
 * silently truncated.
 */
export function planOrchestration(spec, { resolveSpec, input = "", depth = 0 } = {}) {
  const normalized = normalizeAgentSpec(spec);
  if (depth > normalized.maxDepth) throw invalid(`spec "${normalized.name}" exceeds its maxDepth`);
  // A unit without an explicit template still needs a prompt: the spec's own
  // description becomes the instruction, so a minimal spec stays usable.
  const templateFor = (over) => over ?? normalized.prompt ?? `${normalized.description}\n\n任务：\n{input}`;
  if (normalized.strategy === "single") {
    const step = normalized.steps[0];
    return {
      strategy: "single",
      units: [
        {
          key: step?.key ?? normalized.name,
          spec: normalized.name,
          specRevisionId: agentSpecRevisionId(normalized),
          tools: normalized.tools,
          ...(normalized.model ? { model: normalized.model } : {}),
          prompt: renderPrompt(templateFor(step?.prompt), { input }),
        },
      ],
    };
  }

  const resolved = new Map();
  const units = normalized.steps.map((step) => {
    const child = typeof resolveSpec === "function" ? resolveSpec(step.spec) : undefined;
    if (child) resolved.set(step.spec, normalizeAgentSpec(child));
    const childSpec = resolved.get(step.spec);
    if (childSpec && depth + 1 > childSpec.maxDepth) {
      throw invalid(`step "${step.spec}" exceeds its maxDepth inside "${normalized.name}"`);
    }
    return {
      key: step.key,
      spec: step.spec,
      specRevisionId: childSpec ? agentSpecRevisionId(childSpec) : agentSpecRevisionId(normalized),
      tools: childSpec ? childSpec.tools : normalized.tools,
      ...(childSpec?.model ? { model: childSpec.model } : (normalized.model ? { model: normalized.model } : {})),
      prompt: renderPrompt(templateFor(step.prompt ?? childSpec?.prompt), { input }),
      ...(step.dependsOn?.length ? { dependsOn: [...step.dependsOn] } : {}),
      ...(Number.isSafeInteger(step.maxConcurrency) ? { maxConcurrency: step.maxConcurrency } : {}),
    };
  });
  return { strategy: normalized.strategy, units };
}

/**
 * Substitute `{input}` and `{previous}` placeholders. Unknown placeholders are
 * left untouched so a template typo is visible in the child's prompt rather
 * than silently erased. `previous` is only substituted when provided: planning
 * renders `{input}` alone so a chain step keeps its `{previous}` placeholder
 * intact until the previous unit has actually produced output.
 */
export function renderPrompt(template, { input = "", previous } = {}) {
  if (typeof template !== "string") return "";
  let text = template.replaceAll("{input}", String(input));
  if (previous !== undefined) text = text.replaceAll("{previous}", String(previous));
  return text;
}

export const normalizeSpec = normalizeAgentSpec;
export const specRevisionId = agentSpecRevisionId;

/**
 * Project a spec into the node/edge shape the engine's web/agent graph reader
 * consumes. The node keeps a stable id (`agent-spec:<name>`) while its revision
 * is content addressed, so editing a spec appends a revision instead of
 * overwriting the previous orchestration.
 */
export function agentSpecGraph(spec) {
  const normalized = normalizeAgentSpec(spec);
  const address = agentSpecAddress(normalized);
  const { nodeId, nodeRevisionId } = agentSpecNodeIds(normalized);
  return {
    schemaVersion: 1,
    lens: "structural",
    granularity: "entry",
    sourceSet: { sourceTypes: ["agent_spec"], specs: [normalized.name] },
    nodes: [
      {
        id: nodeId,
        nodeId,
        nodeRevisionId,
        kind: "agent_spec",
        title: `${normalized.name}: ${normalized.description}`.slice(0, 512),
        // Keep the complete normalized document on the durable graph node. The
        // engine stores this field in its internal anchor envelope so an
        // invocation can resolve an historical revision after restart.
        spec: normalized,
        evidence: [{ address, role: "produces" }],
        metadata: {
          surface: normalized.surface,
          executor: normalized.executor,
          trust: normalized.trust,
          invokable: "true",
          strategy: normalized.strategy,
          tools: normalized.tools.join(","),
          steps: normalized.steps.map((step) => step.spec).join(","),
          stepKeys: normalized.steps.map((step) => step.key).join(","),
          dependsOn: normalized.steps.map((step) => `${step.key}<-${(step.dependsOn ?? []).join("+")}`).join("|"),
          maxConcurrency: normalized.maxConcurrency,
          maxDepth: normalized.maxDepth,
          ...(normalized.budget ? { budget: canonicalJson(normalized.budget) } : {}),
          ...(normalized.contract?.completion ? { completion: normalized.contract.completion } : {}),
        },
      },
    ],
    edges: [],
    diagnostics: [],
  };
}

function agentRunAddress(run) {
  return { sourceType: "agent_run", objectId: run.specName, revisionId: run.runRevisionId };
}

/**
 * Project a finished run into the graph. Node identity is
 * `agent-run:<specName>` so every execution of one spec chains onto the last
 * through the engine's revision-parent linking — that is the temporal
 * traceability of an orchestration. Evidence points back at the spec revision
 * that drove it (spatial traceability of "why did it behave this way").
 */
export function agentRunGraph(run) {
  if (!run || typeof run !== "object" || typeof run.specName !== "string") throw invalid("run must be an object with a specName");
  const unitDigest = (run.units ?? []).map((unit) => `${unit.key}:${unit.sessionId ?? ""}:${(unit.text ?? "").length}`).join("|");
  const runRevisionId = sha256Hex(`agent-run:${run.specName}:${run.specRevisionId}:${run.input ?? ""}:${unitDigest}`);
  const payload = { ...run, runRevisionId };
  const nodeId = `agent-run:${run.specName}`;
  const nodeRevisionId = sha256Hex(`agent-run-node:${run.specName}:${runRevisionId}`);
  const createdAt = (run.units ?? []).reduce((latest, unit) => Math.max(latest, Number(unit?.endedAt) || 0), 0);
  const specAddress = { sourceType: "agent_spec", objectId: run.specName, revisionId: run.specRevisionId };
  const summary = (run.units ?? [])
    .map((unit) => (unit?.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    schemaVersion: 1,
    lens: "structural",
    granularity: "entry",
    sourceSet: { sourceTypes: ["agent_run"], specs: [run.specName] },
    nodes: [
      {
        id: nodeId,
        nodeId,
        nodeRevisionId,
        ...(createdAt > 0 ? { createdAt } : {}),
        kind: "agent_run",
        title: `${run.specName} ${run.strategy} run (${run.completedCount}/${run.unitCount}${run.ok ? "" : run.timedOut ? ", timed out" : run.aborted ? ", aborted" : ", failed"})`.slice(0, 512),
        evidence: [
          { address: agentRunAddress(payload), role: "produces" },
          { address: specAddress, role: "supports" },
        ],
        metadata: {
          specRevisionId: run.specRevisionId,
          strategy: run.strategy,
          ok: Boolean(run.ok),
          aborted: Boolean(run.aborted),
          timedOut: Boolean(run.timedOut),
          sessions: (run.units ?? []).map((unit) => unit?.sessionId ?? "").filter(Boolean).join(","),
        },
      },
    ],
    edges: [
      {
        id: `run_of:${nodeId}->agent-spec:${run.specName}`,
        edgeId: `run_of:${nodeId}->agent-spec:${run.specName}`,
        edgeRevisionId: sha256Hex(`agent-run-of:${run.specName}:${runRevisionId}`),
        srcNodeId: nodeId,
        dstNodeId: `agent-spec:${run.specName}`,
        kind: "run_of",
        evidence: [{ address: specAddress, role: "navigates" }],
      },
    ],
    diagnostics: [],
    // Exposed for callers that want to store the full transcript separately.
    summary: summary.slice(0, 65_536),
  };
}
