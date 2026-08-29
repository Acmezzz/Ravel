import { normalizeAgentSpec, planOrchestration, renderPrompt, agentSpecRevisionId } from "./histos-agent-spec.js";
import { memoKey as contentMemoKey, topologicalWaves } from "./histos-capability.js";

/**
 * Orchestration executor.
 *
 * The runner is injected, never imported: this module must stay runnable in
 * tests with a fake runner, and in production it is the worker's subagent
 * runner so the child session inherits the parent's model runtime, permission
 * guard and rulesets.
 *
 * Concurrency semantics are adapted from oh-my-pi's `mapWithConcurrencyLimit`:
 * results come back in input order, a failure cancels siblings, and an abort
 * returns what finished instead of throwing away partial work.
 */

export const MAX_RUN_TIMEOUT_MS = 10 * 60 * 1000;

function invalid(message, code = "invalid_args") {
  return Object.assign(new TypeError(message), { code });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("orchestration aborted"), { code: "aborted" }));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Run `items` through `worker` with at most `concurrency` in flight.
 * Resolves in input order. The first rejection aborts the siblings and is
 * rethrown; an external abort resolves with `aborted: true` and whatever
 * completed.
 */
export async function mapWithConcurrencyLimit(items, concurrency, worker, signal) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { results: [], aborted: false };
  const limit = Math.max(1, Math.min(Number.isSafeInteger(concurrency) ? concurrency : list.length, list.length));
  const results = new Array(list.length);
  const controller = new AbortController();
  const abortAll = (reason) => controller.abort(reason);
  const onExternalAbort = () => abortAll("external");
  if (signal) {
    if (signal.aborted) return { results, aborted: true };
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let failed = null;
  let next = 0;
  const runOne = async () => {
    for (;;) {
      if (controller.signal.aborted && failed) return;
      const index = next;
      if (index >= list.length) return;
      next += 1;
      try {
        results[index] = await worker(list[index], index, controller.signal);
      } catch (error) {
        if (!failed) {
          failed = error;
          abortAll("failed");
        }
        return;
      }
      if (controller.signal.aborted) return;
    }
  };

  const pool = Array.from({ length: limit }, () => runOne());
  await Promise.all(pool);
  if (signal) signal.removeEventListener("abort", onExternalAbort);
  if (failed) throw failed;
  return { results, aborted: Boolean(signal?.aborted) };
}

/** Render a unit's prompt, resolving chain placeholders against prior output. */
export function renderUnitPrompt(unit, { input = "", previous = "" } = {}) {
  return renderPrompt(unit.prompt, { input, previous });
}

/** A cache entry is reusable only when it explicitly settled successfully. */
export function isReusableAgentTask(value, expectedMemoKey) {
  if (!value || typeof value !== "object" || value.memoKey !== expectedMemoKey) return false;
  if (value.uncertain === true || value.failed === true || value.aborted === true || value.timedOut === true || value.error) return false;
  const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
  const outcome = typeof value.outcome === "string" ? value.outcome.toLowerCase() : "";
  const settled = status ? ["completed", "succeeded", "success", "ok"].includes(status)
    : outcome ? ["completed", "succeeded", "success", "ok"].includes(outcome)
      : value.ok === true;
  return settled && typeof value.text === "string";
}

function memoLookupOf(memoStore, memoLookup) {
  if (typeof memoLookup === "function") return memoLookup;
  if (memoStore && typeof memoStore.get === "function") return (key, unit) => memoStore.get(key, unit);
  return null;
}

function memoWriteOf(memoStore, memoWrite) {
  if (typeof memoWrite === "function") return memoWrite;
  if (memoStore && typeof memoStore.set === "function") return (key, value, unit) => memoStore.set(key, value, unit);
  return null;
}

async function runUnit(unit, runner, context) {
  const prompt = renderUnitPrompt(unit, context);
  if (!prompt.trim()) throw invalid(`unit "${unit.key}" resolved to an empty prompt`);
  const key = contentMemoKey({
    specRevisionId: unit.specRevisionId ?? context.specRevisionId,
    input: prompt,
    toolCatalog: (unit.tools ?? []).slice().sort().join(","),
    context: `${context.memoContext ?? ""}\n${context.previous ?? ""}`,
  });
  const lookup = context.memoLookup;
  if (lookup) {
    let cached;
    try { cached = await lookup(key, unit); } catch { cached = null; }
    if (isReusableAgentTask(cached, key)) {
      const now = Date.now();
      return {
        key: unit.key,
        spec: unit.spec,
        prompt,
        text: cached.text,
        sessionId: typeof cached.sessionId === "string" ? cached.sessionId : null,
        memoKey: key,
        reused: true,
        startedAt: now,
        endedAt: now,
        durationMs: 0,
      };
    }
  }
  if (context.signal?.aborted) throw Object.assign(new Error("orchestration aborted"), { code: "aborted" });
  const startedAt = Date.now();
  const result = await runner({ prompt, tools: unit.tools, signal: context.signal, ...(unit.model ? { model: unit.model } : {}) });
  const resultStatus = typeof result?.status === "string" ? result.status.toLowerCase() : "";
  const uncertain = result?.uncertain === true || ["uncertain", "pending"].includes(resultStatus);
  const failed = result?.failed === true || Boolean(result?.error) || ["failed", "error"].includes(resultStatus);
  const completed = {
    key: unit.key,
    spec: unit.spec,
    prompt,
    text: typeof result?.text === "string" ? result.text : "",
    sessionId: typeof result?.sessionId === "string" ? result.sessionId : null,
    memoKey: key,
    reused: false,
    ...(uncertain ? { uncertain: true } : {}),
    ...((failed || uncertain) ? { error: String(result?.error?.message ?? result?.error ?? (uncertain ? "result is uncertain" : "runner returned a failed result")) } : {}),
    startedAt,
    endedAt: Date.now(),
    durationMs: Date.now() - startedAt,
  };
  if (!failed && !uncertain && context.memoWrite && completed.text.length > 0 && !context.signal?.aborted) {
    await context.memoWrite(key, { memoKey: key, status: "completed", text: completed.text, sessionId: completed.sessionId }, unit);
  }
  return completed;
}

/**
 * Execute a spec. Returns a run record that is itself the input to the Histos
 * writer, so what happened and what it produced are recorded together.
 */
export async function runOrchestration({ spec, runner, input = "", resolveSpec, concurrency, signal, timeoutMs = MAX_RUN_TIMEOUT_MS, memoStore, memoLookup, memoWrite, memoContext = "", depth = 0 } = {}) {
  if (typeof runner !== "function") throw invalid("runOrchestration requires a runner function");
  const normalized = normalizeAgentSpec(spec);
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > normalized.maxDepth) {
    throw invalid(`spec "${normalized.name}" exceeds its maxDepth`, "depth_exceeded");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RUN_TIMEOUT_MS) {
    throw invalid(`timeoutMs must be between 1 and ${MAX_RUN_TIMEOUT_MS}`);
  }
  if (concurrency !== undefined && (!Number.isSafeInteger(concurrency) || concurrency < 1)) {
    throw invalid("concurrency must be a positive integer");
  }
  const plan = planOrchestration(normalized, { resolveSpec, input, depth });
  const limit = Number.isSafeInteger(concurrency) ? concurrency : normalized.maxConcurrency;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort("external");
  if (signal) {
    if (signal.aborted) return buildRunRecord({ spec: normalized, plan, units: [], input, aborted: true, timedOut: false });
    signal.addEventListener("abort", abortFromParent, { once: true });
  }
  let timer = null;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
      reject(Object.assign(new Error(`orchestration timed out after ${timeoutMs}ms`), { code: "orchestration_timeout" }));
    }, timeoutMs);
    timer.unref?.();
  });
  const lookup = memoLookupOf(memoStore, memoLookup);
  const write = memoWriteOf(memoStore, memoWrite);
  const context = {
    input,
    specRevisionId: agentSpecRevisionId(normalized),
    memoContext,
    memoLookup: lookup,
    memoWrite: write,
    signal: controller.signal,
  };
  const observedUnits = [];
  const execute = async () => {
    const units = [];
    const runWave = async (wave, previousByKey) => {
      const { results, aborted } = await mapWithConcurrencyLimit(
        wave,
        limit,
        (unit) => {
          const previous = (unit.dependsOn ?? []).map((key) => previousByKey.get(key)?.text ?? "").filter(Boolean).join("\\n\\n");
          return runUnit(unit, runner, { ...context, previous });
        },
        controller.signal,
      );
      units.push(...results.filter(Boolean));
      observedUnits.push(...results.filter(Boolean));
      for (const result of results.filter(Boolean)) previousByKey.set(result.key, result);
      return aborted;
    };
    if (plan.strategy === "parallel") {
      const waves = topologicalWaves(plan.units) ?? [plan.units];
      const previousByKey = new Map();
      for (const wave of waves) {
        if (controller.signal.aborted) return { units, aborted: true };
        if (await runWave(wave, previousByKey)) return { units, aborted: true };
      }
      return { units, aborted: Boolean(signal?.aborted) };
    }
    if (plan.strategy === "chain") {
      let previous = "";
      for (const unit of plan.units) {
        if (controller.signal.aborted) return { units, aborted: true };
        const result = await runUnit(unit, runner, { ...context, previous });
        units.push(result);
        observedUnits.push(result);
        previous = result.text;
      }
      return { units, aborted: false };
    }
    if (controller.signal.aborted) return { units, aborted: true };
    const result = await runUnit(plan.units[0], runner, context);
    observedUnits.push(result);
    return { units: [result], aborted: false };
  };

  try {
    const { units, aborted } = await Promise.race([execute(), timeout]);
    return buildRunRecord({ spec: normalized, plan, units, input, aborted, timedOut: false });
  } catch (error) {
    if (timedOut) return buildRunRecord({ spec: normalized, plan, units: observedUnits, input, aborted: true, timedOut: true, error });
    if (controller.signal.aborted && (signal?.aborted || error?.code === "aborted")) {
      return buildRunRecord({ spec: normalized, plan, units: observedUnits, input, aborted: true, timedOut: false, error: signal?.aborted ? undefined : error });
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abortFromParent);
  }
}

function buildRunRecord({ spec, plan, units, input, aborted, timedOut, error }) {
  const failures = units.filter((unit) => unit && typeof unit.error === "string");
  return {
    schemaVersion: 1,
    specName: spec.name,
    specRevisionId: agentSpecRevisionId(spec),
    strategy: plan.strategy,
    input,
    units,
    unitCount: plan.units.length,
    completedCount: units.filter((unit) => unit && !unit.error).length,
    aborted: Boolean(aborted),
    timedOut: Boolean(timedOut),
    ...(error ? { error: error instanceof Error ? error.message : String(error), errorCode: error?.code ?? null } : {}),
    ok: !timedOut && !error && failures.length === 0,
  };
}

/**
 * Flatten a run's unit outputs into one string. Chain steps read this as
 * `{previous}`; callers that only need the answer get the last unit.
 */
export function aggregateRunText(run, { joiner = "\n\n" } = {}) {
  if (!run || !Array.isArray(run.units)) return "";
  return run.units
    .map((unit) => (unit && typeof unit.text === "string" ? unit.text : ""))
    .filter(Boolean)
    .join(joiner);
}

export { sleep };
