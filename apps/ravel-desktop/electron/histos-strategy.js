/**
 * P3 strategy co-creation: mode / orchestration / workflow drafts.
 *
 * The lifecycle shared by all strategy classes is
 * "template → draft in Histos → schema/permission/budget validation →
 * human approval → agent_spec artifact (new revision) → instantiate". This
 * module owns the validation gate (fail-closed) and the draft→agent_spec
 * projection; the engine persists approved specs as durable graph nodes so
 * invokeNode can plan against them.
 *
 * Honest boundary (R17): skill-inject and orchestrator executors stay
 * `wired: false` - a draft that asks for them is rejected here instead of
 * being silently routed to a fake runner.
 */
import { createHash } from "node:crypto";
import { normalizeAgentSpec, MAX_SPEC_STEPS, MAX_SPEC_NAME, ALLOWED_SPEC_TOOLS } from "./histos-agent-spec.js";

export const STRATEGY_KINDS = Object.freeze(["mode", "orchestration", "workflow"]);
export const STRATEGY_EXECUTORS = Object.freeze(["agent-loop", "skill-inject", "orchestrator", "flow-engine"]);
/** executors that are not yet wired to a production path must not be approved. */
export const WIRED_EXECUTORS = Object.freeze(["agent-loop", "flow-engine"]);
export const DEFAULT_STRATEGY_BUDGET = 64_000;
export const MAX_STRATEGY_BUDGET = 1_000_000;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "invalid_args";
  return error;
}

function boundedString(value, label, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw invalid(`${label} must be a non-empty string of at most ${max} characters`);
  return value;
}

/**
 * Build the agent-spec input shape for a strategy draft. `content` is the
 * raw strategy text produced by the conversation; a deterministic subset is
 * extracted so validation stays offline and reproducible. Returns the draft
 * object with a content-addressed id; a draft is NOT invokable until it has
 * passed approval and been persisted as an agent_spec node.
 */
export function createStrategyDraft(input = {}) {
  if (!input || typeof input !== "object") throw invalid("strategy draft input must be an object");
  const kind = boundedString(input.kind, "kind", 16);
  if (!STRATEGY_KINDS.includes(kind)) throw invalid(`kind must be one of ${STRATEGY_KINDS.join(", ")}`);
  const name = boundedString(input.name, "name", MAX_SPEC_NAME);
  const description = typeof input.description === "string" ? input.description.slice(0, 1024) : "";
  const surface = typeof input.surface === "string" ? input.surface : kind === "workflow" ? "workflow" : kind === "orchestration" ? "child" : "session";
  const executor = typeof input.executor === "string" ? input.executor : kind === "workflow" ? "flow-engine" : "agent-loop";
  if (!STRATEGY_EXECUTORS.includes(executor)) throw invalid(`executor must be one of ${STRATEGY_EXECUTORS.join(", ")}`);
  const tools = Array.isArray(input.tools) ? [...new Set(input.tools.map((tool) => String(tool).slice(0, 128)))].slice(0, 64) : [];
  const strategy = typeof input.strategy === "string" ? input.strategy : "single";
  const steps = Array.isArray(input.steps) ? input.steps.slice(0, MAX_SPEC_STEPS) : [];
  const content = typeof input.content === "string" ? input.content : "";
  const maxBudget = Number.isSafeInteger(input.maxBudget) ? input.maxBudget : DEFAULT_STRATEGY_BUDGET;
  const draft = {
    id: `draft-${createHash("sha256").update(JSON.stringify([kind, name, executor, tools, steps, content])).digest("hex").slice(0, 16)}`,
    kind,
    name,
    description,
    executor,
    surface,
    strategy,
    tools,
    steps,
    content: content.slice(0, 16_384),
    maxBudget,
    createdAt: Date.now(),
    approvedAt: null,
  };
  const checks = validateStrategyDraft(draft);
  return { draft, checks };
}

/**
 * Schema / permission / budget triple gate (fail-closed). Any failed check
 * returns { ok: false } - the draft must not reach the approval UI as
 * runnable. Unwired executors are rejected outright so a draft never
 * pretends a skill-inject / orchestrator production path exists.
 */
export function validateStrategyDraft(draft) {
  if (!draft || typeof draft !== "object") return { ok: false, code: "invalid_draft", message: "draft is required" };
  if (!STRATEGY_KINDS.includes(draft.kind)) return { ok: false, code: "invalid_kind", message: `kind must be one of ${STRATEGY_KINDS.join(", ")}` };
  if (!WIRED_EXECUTORS.includes(draft.executor)) {
    return { ok: false, code: "executor_unwired", message: `executor "${draft.executor}" is not wired to a production path yet (skill-inject / orchestrator stay disabled)` };
  }
  const disallowed = draft.tools.filter((tool) => !ALLOWED_SPEC_TOOLS.includes(tool));
  if (disallowed.length > 0) {
    return { ok: false, code: "permission_denied", message: `draft uses tools outside the allowlist: ${disallowed.join(", ")}` };
  }
  if (!Array.isArray(draft.steps) || draft.steps.length === 0 || draft.steps.length > MAX_SPEC_STEPS) {
    return { ok: false, code: "schema_invalid", message: `steps must be an array of 1..${MAX_SPEC_STEPS} entries` };
  }
  // Budget: coarse deterministic estimate (steps x concurrency ceiling).
  const budget = Number.isSafeInteger(draft.maxBudget) ? draft.maxBudget : DEFAULT_STRATEGY_BUDGET;
  const estimate = draft.steps.length * 2_000;
  if (estimate > budget) {
    return { ok: false, code: "budget_exceeded", message: `draft estimate ${estimate} exceeds budget ${budget}` };
  }
  // Schema: the draft must normalize as an agent spec before it can be approved.
  try {
    normalizeAgentSpec({
      name: draft.name,
      description: draft.description,
      surface: draft.surface,
      executor: draft.executor,
      strategy: draft.strategy,
      tools: draft.tools,
      steps: draft.steps.map((step, index) => (typeof step === "object" && step !== null ? step : { key: `step-${index}`, spec: String(step).slice(0, 512) })),
    });
  } catch {
    return { ok: false, code: "schema_invalid", message: "draft does not conform to the agent spec schema" };
  }
  return { ok: true, estimate, budget };
}

/** Deterministic spec projection for an approved draft (what gets persisted). */
export function strategyDraftToSpec(draft) {
  return {
    name: draft.name,
    description: draft.description,
    surface: draft.surface,
    executor: draft.executor,
    strategy: draft.strategy,
    tools: draft.tools,
    // Approval promotes the draft to the approved trust tier so invokeNode
    // stops treating it as an un-runnable draft.
    trust: "approved",
    steps: draft.steps.map((step, index) => (typeof step === "object" && step !== null ? step : { key: `step-${index}`, spec: String(step).slice(0, 512) })),
  };
}
