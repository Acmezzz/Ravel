/**
 * Small adapter from a validated Histos invocation plan to the existing Pi
 * worker. It deliberately owns no session/runtime state: the WorkerHost remains
 * the only transport boundary and the worker remains the only Pi session owner.
 */

function executionError(message, code) {
  return Object.assign(new Error(message), { code });
}

export function invocationStatusOf(error) {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (code.includes("timeout") || message.includes("timed out") || message.includes("timeout")) return "timedOut";
  if (code === "aborted" || code === "abort" || message.includes("abort")) return "aborted";
  if (code === "uncertain_execution" || code === "executor_unwired" || code === "trust_draft") return "uncertain";
  return "failed";
}

/** Build the durable agent_run payload without exposing transport internals. */
export function buildAgentRunRecord({ plan, execution, error, status, input = "", sessionId = null, startedAt = Date.now(), endedAt = Date.now() } = {}) {
  const resolvedStatus = status ?? (error ? invocationStatusOf(error) : "success");
  const planData = plan?.plan ?? plan ?? {};
  const request = plan?.executionRequest ?? planData.executionRequest ?? {};
  const unit = request.unit ?? (Array.isArray(planData.units) && planData.units.length === 1 ? planData.units[0] : null);
  const result = execution?.result;
  const output = typeof result?.text === "string" ? result.text : typeof execution?.output === "string" ? execution.output : "";
  const effectiveSessionId = typeof result?.sessionId === "string" ? result.sessionId : sessionId;
  const unitRecord = unit && typeof unit === "object" ? {
    key: typeof unit.key === "string" ? unit.key : planData.specName ?? "invocation",
    spec: typeof unit.spec === "string" ? unit.spec : planData.specName ?? "invocation",
    prompt: typeof unit.prompt === "string" ? unit.prompt : "",
    text: output,
    sessionId: effectiveSessionId,
    startedAt,
    endedAt,
    ...((error || resolvedStatus !== "success") ? { error: String(error?.message ?? error ?? resolvedStatus) } : {}),
  } : null;
  return {
    schemaVersion: 1,
    specName: typeof planData.specName === "string" ? planData.specName : typeof plan?.specName === "string" ? plan.specName : "invocation",
    specRevisionId: typeof planData.specRevisionId === "string" ? planData.specRevisionId : typeof plan?.specRevisionId === "string" ? plan.specRevisionId : "0".repeat(64),
    strategy: typeof planData.strategy === "string" ? planData.strategy : "single",
    input: String(input ?? ""),
    status: resolvedStatus,
    errorCode: error?.code ?? null,
    output,
    sessionId: effectiveSessionId,
    startedAt,
    endedAt,
    ok: resolvedStatus === "success",
    aborted: resolvedStatus === "aborted",
    timedOut: resolvedStatus === "timedOut",
    uncertain: resolvedStatus === "uncertain",
    unitCount: unitRecord ? 1 : 0,
    completedCount: resolvedStatus === "success" ? 1 : 0,
    units: unitRecord ? [unitRecord] : [],
  };
}

function firstUnit(plan) {
  const candidate = plan?.executionRequest?.unit ?? (Array.isArray(plan?.units) && plan.units.length === 1 ? plan.units[0] : null);
  if (!candidate || typeof candidate !== "object" || typeof candidate.prompt !== "string" || !candidate.prompt.trim()) return null;
  return candidate;
}

export function createAgentLoopExecutor({ getWorker, isBusy = () => false } = {}) {
  if (typeof getWorker !== "function") throw executionError("getWorker must be a function", "invalid_args");
  if (typeof isBusy !== "function") throw executionError("isBusy must be a function", "invalid_args");

  return {
    /**
     * Execute only a single agent-loop unit. Orchestrator/flow plans and
     * malformed or uncertain plans fail closed instead of being approximated.
     */
    async execute({ plan, dryRun = false } = {}) {
      if (!plan || typeof plan !== "object") throw executionError("agent-loop execution plan is missing", "invalid_execution_plan");
      if (plan.executor !== "agent-loop") throw executionError("invocation is not an agent-loop plan", "executor_mismatch");
      if (plan.wired !== true) throw executionError("agent-loop executor is not wired", "executor_unwired");
      const unit = firstUnit(plan);
      if (!unit || plan.surface === "workflow") throw executionError("agent-loop plan must contain exactly one executable unit", "uncertain_execution");
      if (dryRun || plan.dryRun === true) return { executed: false, dryRun: true, method: null };

      const host = getWorker();
      if (!host || host.state !== "ready") throw executionError("The active Agent session is not ready", "not_ready");
      if (isBusy()) throw executionError("生成中无法执行 Agent invocation，请先停止或等待完成", "session_busy");

      const method = plan.surface === "child" ? "runSubagent" : plan.surface === "session" ? "prompt" : null;
      if (!method) throw executionError(`agent-loop surface "${String(plan.surface)}" is not executable`, "uncertain_execution");
      const data = await host.call(method, method === "prompt"
        ? { text: unit.prompt, behavior: "followUp" }
        : { prompt: unit.prompt, tools: unit.tools });
      return {
        executed: true,
        dryRun: false,
        method,
        ...(method === "runSubagent" && data && typeof data === "object" ? { result: data } : {}),
      };
    },
  };
}

export async function executeAgentLoopPlan(options) {
  const { getWorker, isBusy, ...request } = options ?? {};
  return createAgentLoopExecutor({ getWorker, isBusy }).execute(request);
}
