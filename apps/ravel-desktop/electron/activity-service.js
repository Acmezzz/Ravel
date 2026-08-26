/**
 * Cross-session activity tracker — the live half of the 动态 view.
 *
 * Pure state reducer over lifecycle inputs the main process already observes:
 * projected agent events, permission/UI asks (with a timeout mirror of the
 * worker's modal timer), and worker transport states. No facts are written or
 * required here; restart reconciliation lives in session-reader.js
 * (readSessionActivity) which derives the same row shape from JSONL facts.
 *
 * Status derivation (matches docs/ravel-design-activity-session-reference-mcp.md):
 *   waiting  = pending blocking UI asks (fail-closed approvals made visible)
 *   running  = a run is open (agent_start..settled window, incl. retries)
 *   failed   = last terminal signal was an error / dead worker / failed retry
 *   done     = otherwise
 */
const BLOCKING_UI_METHODS = new Set(["confirm", "select", "input", "editor"]);
/** Mirror of the worker modal cap + reply latency before we self-settle an ask. */
const MAX_ASK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000;

export const ACTIVITY_STATUSES = Object.freeze(["running", "waiting", "failed", "done"]);

export function createActivityTracker({ now = () => Date.now(), onSettleTimeout } = {}) {
  /** sessionId -> { runActive, pendingAsks:Set<askId>, lastError, lastOutcome, updatedAt } */
  const sessions = new Map();
  /** askId -> { sessionId, timer } */
  const openAsks = new Map();

  function stateOf(sessionId) {
    let state = sessions.get(sessionId);
    if (!state) {
      state = { runActive: false, pendingAsks: new Set(), lastError: null, lastOutcome: null, updatedAt: now() };
      sessions.set(sessionId, state);
    }
    return state;
  }

  function touch(sessionId) {
    const state = stateOf(sessionId);
    state.updatedAt = now();
    return state;
  }

  function settleAsk(askId, outcome) {
    const open = openAsks.get(askId);
    if (!open) return false;
    openAsks.delete(askId);
    if (open.timer) clearTimeout(open.timer);
    const state = sessions.get(open.sessionId);
    if (state) {
      state.pendingAsks.delete(askId);
      state.updatedAt = now();
    }
    onSettleTimeout?.(open.sessionId, askId, outcome);
    return true;
  }

  /**
   * Fold one projected agent event. Only lifecycle shapes matter here; the
   * full-fidelity stream keeps flowing to the renderer untouched.
   */
  function applyEvent(sessionId, event) {
    if (!sessionId || !event || typeof event.type !== "string") return false;
    const type = event.type;
    if (type === "agent_start" || type === "turn_start" || type === "compaction_start" || type === "auto_retry_start") {
      const state = touch(sessionId);
      state.runActive = true;
      state.lastError = null;
      state.lastOutcome = null;
      return true;
    }
    if (type === "agent_settled") {
      const state = touch(sessionId);
      state.runActive = false;
      state.lastOutcome = "completed";
      return true;
    }
    if (type === "error") {
      const state = touch(sessionId);
      state.runActive = false;
      state.lastError = typeof event.message === "string" ? event.message : "Agent error";
      state.lastOutcome = "failed";
      return true;
    }
    if (type === "auto_retry_end") {
      if (event.status === "error") {
        const state = touch(sessionId);
        state.runActive = false;
        state.lastError = typeof event.finalError === "string" ? event.finalError : "重试后仍失败";
        state.lastOutcome = "failed";
        return true;
      }
      // A successful retry ends the retry episode; the enclosing run keeps
      // going until agent_settled, so the row stays running.
      return false;
    }
    if (type === "compaction_end") {
      // Compaction happens inside a run; the surrounding run state is unchanged.
      return false;
    }
    return false;
  }

  /** A blocking modal ask was forwarded to the renderer. */
  function applyAsk(sessionId, askId, timeoutMs) {
    if (!sessionId || !askId || openAsks.has(askId)) return false;
    const state = touch(sessionId);
    state.pendingAsks.add(askId);
    const effective = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_ASK_TIMEOUT_MS) : DEFAULT_ASK_TIMEOUT_MS;
    const timer = setTimeout(() => settleAsk(askId, "timeout"), effective + 1_000);
    timer?.unref?.();
    openAsks.set(askId, { sessionId, timer });
    return true;
  }

  /** The renderer answered or cancelled a modal ask. */
  function applyDecide(askId) {
    return settleAsk(askId, "decided");
  }

  function applyTransport(sessionId, state) {
    if (!sessionId || typeof state !== "string") return false;
    if (state === "dead" || state === "restarting" || state === "stopping") {
      const entry = touch(sessionId);
      if (entry.runActive) {
        entry.runActive = false;
        entry.lastError = "Agent worker 已中断";
        entry.lastOutcome = "failed";
        return true;
      }
    }
    return false;
  }

  function forget(sessionId) {
    if (!sessionId) return;
    const state = sessions.get(sessionId);
    if (state) {
      for (const askId of state.pendingAsks) {
        const open = openAsks.get(askId);
        if (open?.timer) clearTimeout(open.timer);
        openAsks.delete(askId);
      }
    }
    sessions.delete(sessionId);
  }

  function statusOf(state) {
    if (state.pendingAsks.size > 0) return "waiting";
    if (state.runActive) return "running";
    if (state.lastOutcome === "failed") return "failed";
    return "done";
  }

  function rowOf(sessionId, state) {
    return {
      sessionId,
      status: statusOf(state),
      pendingApprovals: state.pendingAsks.size,
      lastError: state.lastError,
      lastOutcome: state.lastOutcome,
      updatedAt: new Date(state.updatedAt).toISOString(),
    };
  }

  function rows() {
    return [...sessions.entries()].map(([sessionId, state]) => rowOf(sessionId, state));
  }

  function has(sessionId) {
    return sessions.has(sessionId);
  }

  function dispose() {
    for (const open of openAsks.values()) if (open.timer) clearTimeout(open.timer);
    openAsks.clear();
    sessions.clear();
  }

  return { applyEvent, applyAsk, applyDecide, applyTransport, forget, rows, has, dispose };
}

/** True for modal ask methods that should flip a session to "waiting". */
export function isBlockingUiMethod(method) {
  return BLOCKING_UI_METHODS.has(method);
}
