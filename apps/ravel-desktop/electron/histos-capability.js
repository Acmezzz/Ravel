import { createHash } from "node:crypto";
import {
  BUDGET_CAPS,
  SPEC_EXECUTORS,
  normalizeAgentSpec,
  planOrchestration,
} from "./histos-agent-spec.js";
import { canonicalJson } from "./histos-address.js";
import { SUBAGENT_TOOLS } from "./task-service.js";

/**
 * The capability layer: how a spec node becomes something you can call.
 *
 * Nodes carry declarations, never code. The set of executors is closed and
 * audited — a spec (whether hand-written or model-generated) may only name one
 * of these, and `wired: false` means exactly that: the plan can be produced,
 * but nothing pretends to have run.
 *
 * Pure module: no IO, no Electron, no network.
 */

const READ_FAMILY = new Set(SUBAGENT_TOOLS);

export const EXECUTOR_WIRING = Object.freeze({
  "agent-loop": Object.freeze({ wired: true, surfaces: Object.freeze(["session", "child"]) }),
  "skill-inject": Object.freeze({ wired: false, surfaces: Object.freeze(["invocation"]) }),
  orchestrator: Object.freeze({ wired: false, surfaces: Object.freeze(["workflow"]) }),
  "flow-engine": Object.freeze({ wired: true, surfaces: Object.freeze(["workflow"]) }),
});

const MAX_PROMPT_CHARS = 40_000;
const MAX_SELECTION = 2_000;

function invalid(message, code = "invalid_args") {
  return Object.assign(new TypeError(message), { code });
}

function rejection(code, message) {
  return { ok: false, code, message, diagnostics: [{ code, message }] };
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Narrow a child's tool surface to the parent's. Widening is impossible by
 * construction: anything the parent does not have is dropped, not added.
 */
export function narrowTools(childTools, parentTools) {
  const tools = Array.isArray(childTools) ? childTools : [];
  if (!Array.isArray(parentTools) || parentTools.length === 0) {
    return { tools: [...tools], dropped: [] };
  }
  const parent = new Set(parentTools);
  return {
    tools: tools.filter((tool) => parent.has(tool)),
    dropped: tools.filter((tool) => !parent.has(tool)),
  };
}

/**
 * Group units into dependency waves. A wave can run concurrently; a later wave
 * waits for every earlier one. Returns null when the graph cannot be ordered,
 * which the spec normalizer should already have refused.
 *
 * Order inside a wave follows declaration order so plans stay readable and
 * results stay reproducible.
 */
export function topologicalWaves(units) {
  const list = Array.isArray(units) ? units : [];
  const byKey = new Map(list.map((unit) => [unit.key, unit]));
  const indegree = new Map(list.map((unit) => [unit.key, (unit.dependsOn ?? []).length]));
  const dependents = new Map(list.map((unit) => [unit.key, []]));
  for (const unit of list) {
    for (const dep of unit.dependsOn ?? []) {
      if (!byKey.has(dep)) return null;
      dependents.get(dep).push(unit.key);
    }
  }
  const waves = [];
  let ready = list.filter((unit) => indegree.get(unit.key) === 0).map((unit) => unit.key);
  let scheduled = 0;
  while (ready.length > 0) {
    waves.push(ready.map((key) => byKey.get(key)));
    scheduled += ready.length;
    const unlocked = [];
    for (const key of ready) {
      for (const next of dependents.get(key) ?? []) {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) unlocked.push(next);
      }
    }
    ready = list.filter((unit) => unlocked.includes(unit.key)).map((unit) => unit.key);
  }
  return scheduled === list.length ? waves : null;
}

/**
 * Content-addressed identity of one unit of work. When nothing that can affect
 * the result has changed, a previous `agent_task` result can be reused instead
 * of paying for the model again — orchestration becomes an incremental build.
 */
export function memoKey({ specRevisionId, input = "", toolCatalog = "", context = "" } = {}) {
  return sha256Hex(canonicalJson({
    specRevisionId: String(specRevisionId ?? ""),
    input: String(input ?? ""),
    toolCatalog: String(toolCatalog ?? ""),
    context: String(context ?? ""),
  }));
}

/**
 * Validate the shape of an invocation request arriving over IPC. The engine
 * owns semantic validation; this only guarantees we are looking at a plausible
 * reference and a bounded payload.
 */
export function normalizeInvocationRequest(value) {
  if (!value || typeof value !== "object") return null;
  const nodeId = typeof value.nodeId === "string" ? value.nodeId.trim().slice(0, 512) : "";
  if (!nodeId) return null;
  const revisionId = typeof value.revisionId === "string" ? value.revisionId.trim().slice(0, 64) : "";
  if (revisionId && !/^[0-9a-f]{64}$/.test(revisionId)) return null;
  const request = { nodeId };
  if (revisionId) request.revisionId = revisionId;
  if (typeof value.prompt === "string") request.prompt = value.prompt.slice(0, MAX_PROMPT_CHARS);
  if (value.args !== undefined && value.args !== null) {
    const size = canonicalJson(value.args).length;
    if (size > MAX_PROMPT_CHARS) return null;
    request.args = value.args;
  }
  if (Array.isArray(value.selection) && value.selection.length > 0) {
    if (value.selection.length > MAX_SELECTION) return null;
    request.selection = value.selection.slice(0, MAX_SELECTION).map((item) => (typeof item === "string" ? item.slice(0, 512) : String(item ?? "").slice(0, 512)));
  }
  if (value.dryRun === true) request.dryRun = true;
  return request;
}

function effectiveBudget(spec, options) {
  const budget = spec.budget ?? {};
  const caps = options.caps ?? {};
  const pick = (field) => {
    const values = [budget[field], caps[field]].filter((value) => Number.isSafeInteger(value) && value >= 1);
    return values.length ? Math.min(...values, BUDGET_CAPS[field]) : null;
  };
  const resolved = {};
  for (const field of Object.keys(BUDGET_CAPS)) {
    const value = pick(field);
    if (value !== null) resolved[field] = value;
  }
  return resolved;
}

/**
 * Turn a spec node into an executable plan, or refuse.
 *
 * The checks run in the order that makes refusal cheapest and safest:
 * shape → executor → trust → parent narrowing → budget → graph.
 *
 * `dryRun` always succeeds validation when the spec itself is valid, so a
 * conversationally generated draft can be inspected before it is trusted.
 */
export function planInvocation({ spec, input = {}, parentTools = null, options = {} } = {}) {
  let normalized;
  try {
    normalized = normalizeAgentSpec(spec);
  } catch (error) {
    return rejection("invalid_spec", error instanceof Error ? error.message : String(error));
  }

  const wiring = EXECUTOR_WIRING[normalized.executor];
  if (!wiring || !SPEC_EXECUTORS.includes(normalized.executor)) {
    return rejection("unknown_executor", `executor "${normalized.executor}" is not in the closed registry`);
  }
  if (!wiring.surfaces.includes(normalized.surface)) {
    return rejection("executor_surface_mismatch", `executor "${normalized.executor}" cannot serve surface "${normalized.surface}"`);
  }

  const dryRun = options.dryRun === true;
  if (!wiring.wired && !dryRun) {
    return rejection("executor_unwired", `executor "${normalized.executor}" is planned but not wired yet`);
  }

  // Trust ladder: a draft may be inspected freely but only runs when the caller
  // explicitly accepts it, and then only with the read-only family.
  let tools = [...normalized.tools];
  const trustDropped = [];
  if (normalized.trust === "draft" && !dryRun) {
    if (options.allowDraft !== true) {
      return rejection("trust_draft", `spec "${normalized.name}" is a draft; dry-run it or promote it before invoking`);
    }
    trustDropped.push(...tools.filter((tool) => !READ_FAMILY.has(tool)));
    tools = tools.filter((tool) => READ_FAMILY.has(tool));
  }

  const narrowed = narrowTools(tools, parentTools);
  if (narrowed.tools.length === 0) {
    return rejection("tools_empty", `spec "${normalized.name}" has no tools left after narrowing to the parent surface`);
  }

  // Preserve every narrowing decision for auditability. The normalizer records
  // tools rejected by the surface ceiling; invocation adds draft/parent drops.
  const droppedTools = [...new Set([...(normalized.droppedTools ?? []), ...trustDropped, ...narrowed.dropped])].sort();

  const budget = effectiveBudget(normalized, options);

  const requestInput = typeof input.prompt === "string" ? input.prompt : "";
  let waves = null;
  let executionUnits = null;
  if (normalized.surface === "workflow" || normalized.strategy !== "single") {
    const units = planOrchestration(normalized, { input: requestInput }).units;
    waves = topologicalWaves(units);
    if (waves === null) {
      return rejection("dependency_cycle", `spec "${normalized.name}" does not form an executable dependency graph`);
    }
    executionUnits = waves.flat();
  } else if (normalized.executor === "agent-loop") {
    executionUnits = planOrchestration(normalized, { input: requestInput }).units;
  }

  const executionRequest = wiring.wired && normalized.executor === "agent-loop" && !dryRun
    ? {
      executor: normalized.executor,
      surface: normalized.surface,
      specName: normalized.name,
      specRevisionId: typeof options.specRevisionId === "string" ? options.specRevisionId : null,
      ...(executionUnits?.length === 1 ? { unit: executionUnits[0] } : {}),
    }
    : null;

  return {
    ok: true,
    plan: {
      specName: normalized.name,
      specRevisionId: typeof options.specRevisionId === "string" ? options.specRevisionId : null,
      surface: normalized.surface,
      executor: normalized.executor,
      trust: normalized.trust,
      wired: wiring.wired,
      dryRun,
      tools: narrowed.tools.sort(),
      droppedTools,
      budget,
      completion: normalized.contract?.completion ?? null,
      maxConcurrency: normalized.maxConcurrency,
      maxDepth: normalized.maxDepth,
      units: waves ? waves.flat() : null,
      waves: waves ?? null,
      ...(executionRequest ? { executionRequest } : {}),
      memoKey: memoKey({
        specRevisionId: options.specRevisionId ?? normalized.name,
        input: input.prompt ?? "",
        toolCatalog: narrowed.tools.slice().sort().join(","),
        context: options.context ?? "",
      }),
    },
  };
}

/** Validate a raw invocation payload against a resolved spec node. */
export function planInvocationFromRequest(request, spec, { parentTools = null, options = {} } = {}) {
  if (!request || typeof request !== "object") throw invalid("invocation request must be an object");
  return planInvocation({
    spec,
    input: { prompt: request.prompt ?? "", args: request.args, selection: request.selection },
    parentTools,
    options: { ...options, dryRun: request.dryRun === true || options.dryRun === true },
  });
}
