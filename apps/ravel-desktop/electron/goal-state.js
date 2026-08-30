/**
 * GoalState + AutonomousGate (adapted from prime-agent `goals.ts` /
 * `autonomous.ts`).
 *
 * Goal state is the durable accounting for a long-running, budget-bounded
 * session mode. The worker.mjs goal continuation loop already enforces a
 * round/elapsed cap; this module adds:
 *   - a normalized `GoalState` shape with token / time / round counters
 *   - an `AutonomousGateConfig` + `AutonomousGateResult` contract for
 *     "self-loop until a bash command passes" workflows (plan / goal mode
 *     can both mount a gate)
 *   - serialization helpers that round-trip through the existing
 *     `ravel_record` fact channel so goal state is append-only, restorable
 *     after a crash, and queryable by the Histos fact graph
 *
 * Nothing here is wired into the worker prompt path; this is the contract
 * surface that the surface / Histos queries rely on. Worker integration
 * can be added by calling `appendGoalStateFact` + `runAutonomousGate` from
 * the same code that already updates `goalState` in worker.mjs.
 */

export const GOAL_STATUS = Object.freeze([
  "idle",
  "active",
  "paused",
  "budget_limited",
  "complete",
  "error",
]);

export const AUTONOMOUS_LIMIT_REASONS = Object.freeze([
  "max_continuations",
  "max_turns",
  "max_tokens",
  "timeout_ms",
]);

const GOAL_ROUND_CAP = 25;
const GOAL_ELAPSED_CAP_MS = 30 * 60 * 1000;
const GOAL_TOKEN_CAP = 2_000_000;
const DEFAULT_MAX_CONTINUATIONS = 5;
const DEFAULT_TIMEOUT_MS = 600_000;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: "invalid_args" });
}

function requireString(value, name, max = 1024) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw invalid(`${name} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function requireFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${name} must be a finite number`);
  }
  return value;
}

function requireBoundedInteger(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalid(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Build a fresh `GoalState` for a new run. All counters start at 0 except
 * `startedAt` and `rounds` (which advance on each continuation).
 */
export function createGoalState({ objective, sessionId, startedAt = Date.now() } = {}) {
  return {
    objective: requireString(objective, "objective", 4096),
    sessionId: typeof sessionId === "string" ? sessionId : null,
    status: "active",
    startedAt: requireFiniteNumber(startedAt, "startedAt"),
    rounds: 0,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    continuationsUsed: 0,
    tokenCap: GOAL_TOKEN_CAP,
    roundCap: GOAL_ROUND_CAP,
    elapsedCapMs: GOAL_ELAPSED_CAP_MS,
  };
}

/**
 * Reduce a goal state with the latest turn's outcome. Mutates the passed
 * state for caller convenience; returns it.
 */
export function recordGoalTurn(state, { tokensDelta = 0, timeDeltaMs = 0, continuation = false } = {}) {
  if (!state) throw invalid("state is required");
  state.rounds += 1;
  state.tokensUsed = Math.max(0, state.tokensUsed + Math.max(0, tokensDelta));
  state.timeUsedSeconds = Math.max(0, state.timeUsedSeconds + Math.round(timeDeltaMs / 1000));
  if (continuation) state.continuationsUsed += 1;
  if (state.tokensUsed >= state.tokenCap) state.status = "budget_limited";
  else if (state.rounds >= state.roundCap) state.status = "budget_limited";
  else if (Date.now() - state.startedAt >= state.elapsedCapMs) state.status = "budget_limited";
  return state;
}

export function isGoalBudgetExceeded(state, now = Date.now()) {
  if (!state) return false;
  if (state.tokensUsed >= state.tokenCap) return true;
  if (state.rounds >= state.roundCap) return true;
  if (now - state.startedAt >= state.elapsedCapMs) return true;
  return false;
}

export function isGoalTerminal(state) {
  return state?.status === "complete" || state?.status === "error" || state?.status === "budget_limited";
}

/**
 * Build the `thread_goal_state` CustomEntry the prime-agent harness
 * appends when a goal starts. The entry rides in Ravel's existing
 * `ravel_record` fact channel so the durable JSONL stays the source of
 * truth. The id format mirrors SessionEntry (8-char hex); the entryId
 * stored in the JSONL is the parent custom entry id.
 */
export function buildGoalStateEntry(state, { entryId, parentId = null, lane = "main" } = {}) {
  if (!state) throw invalid("state is required");
  return {
    type: "ravel_record",
    customType: "thread_goal_state",
    entryId: requireString(entryId, "entryId", 128),
    parentId: parentId ?? null,
    lane,
    data: { ...state },
  };
}

export function parseGoalStateEntry(entry) {
  if (!entry || entry.customType !== "thread_goal_state" || !entry.data) return null;
  if (!GOAL_STATUS.includes(entry.data.status)) return null;
  return { ...entry.data };
}

/**
 * Autonomous gate config: a list of bash commands the host runs to
 * decide whether the run may continue. The host treats a non-zero exit
 * as "failed" and either retries (up to `maxRetries`) or returns
 * `"retry_exhausted"`.
 */
export function createAutonomousGateConfig({
  commands = [],
  maxRetries = DEFAULT_MAX_CONTINUATIONS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  backoffMs = 5_000,
} = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw invalid("commands must be a non-empty array of bash command strings");
  }
  for (const command of commands) {
    if (typeof command !== "string" || command.length === 0 || command.length > 8192) {
      throw invalid("each command must be a non-empty string of at most 8192 characters");
    }
  }
  return {
    commands: [...commands],
    maxRetries: requireBoundedInteger(maxRetries, "maxRetries", 0, 100),
    timeoutMs: requireBoundedInteger(timeoutMs, "timeoutMs", 1000, 24 * 60 * 60 * 1000),
    backoffMs: requireBoundedInteger(backoffMs, "backoffMs", 0, 60_000),
  };
}

/**
 * Run a single command via the supplied `exec` function. The host decides
 * what `exec` means (Electron main process, child_process, sandbox) and
 * must resolve with `{ ok, code, signal?, timedOut? }`. The gate wraps
 * retries + backoff so the host can stay one-line per gate.
 */
export async function runAutonomousGate(config, { exec, sleep = defaultSleep, onAttempt } = {}) {
  if (!config) throw invalid("config is required");
  if (typeof exec !== "function") throw invalid("exec must be a function");
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    let lastFailure = null;
    for (const command of config.commands) {
      const result = await exec(command, { timeoutMs: config.timeoutMs });
      onAttempt?.({ attempt, command, result });
      if (result?.ok) continue;
      lastFailure = { command, code: result?.code ?? null, signal: result?.signal ?? null, timedOut: Boolean(result?.timedOut) };
      break;
    }
    if (!lastFailure) return { result: "passed", attempts: attempt + 1 };
    if (attempt >= config.maxRetries) {
      return { result: "retry_exhausted", attempts: attempt + 1, lastFailure };
    }
    if (config.backoffMs > 0) await sleep(config.backoffMs * (attempt + 1));
  }
  return { result: "failed", attempts: 0 };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const GOAL_LIMITS = Object.freeze({
  GOAL_ROUND_CAP,
  GOAL_ELAPSED_CAP_MS,
  GOAL_TOKEN_CAP,
  DEFAULT_MAX_CONTINUATIONS,
  DEFAULT_TIMEOUT_MS,
});
