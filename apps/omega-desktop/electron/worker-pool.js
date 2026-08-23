/**
 * Session-keyed worker slots. The desktop keeps one live Agent worker per
 * active session, with a cap and idle TTL so background runs can continue
 * after the user switches away.
 *
 * Hosts are injected (Electron WorkerHost in production, fakes in tests).
 * A host must support: start, kill, call, and the fields sessionId/cwd/state.
 */
export const DEFAULT_WORKER_CAP = 3;
export const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000;

export function createWorkerSlotPool({
  cap = DEFAULT_WORKER_CAP,
    idleTtlMs = DEFAULT_IDLE_TTL_MS,
    healthTtlMs = 60_000,
    now = Date.now,
    timers = { setTimeout, clearTimeout },
} = {}) {
  const slots = new Map();
  let foregroundSessionId = null;
  let healthTimer = null;

  function snapshotOf(slot) {
    return {
      sessionId: slot.sessionId,
      cwd: slot.cwd,
      state: slot.host?.state ?? "dead",
      running: Boolean(slot.running),
      foreground: slot.sessionId === foregroundSessionId,
      lastUsedAt: slot.lastUsedAt,
      lastHealthAt: slot.lastHealthAt ?? 0,
      health: slot.health ?? "unknown",
    };
  }

  function foreground() {
    return foregroundSessionId ? slots.get(foregroundSessionId) ?? null : null;
  }

  function get(sessionId) {
    return sessionId ? slots.get(sessionId) ?? null : null;
  }

  function list() {
    return [...slots.values()];
  }

  function snapshots() {
    return list().map(snapshotOf);
  }

  function hasRunning() {
    return list().some((slot) => slot.running);
  }

  function isRunning(sessionId) {
    return Boolean(get(sessionId)?.running);
  }

  function workspaceBusy(cwd) {
    return list().some((slot) => slot.cwd === cwd && slot.running);
  }

  function reusableWorkspaceSlot(cwd, excludeSessionId = null) {
    return list()
      .filter((slot) => slot.cwd === cwd && !slot.running && slot.sessionId !== foregroundSessionId && slot.sessionId !== excludeSessionId && slot.host?.state === "ready")
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0] ?? null;
  }

  function clearIdle(slot) {
    if (slot?.idleTimer) {
      timers.clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
  }

  function scheduleIdle(slot) {
    clearIdle(slot);
    if (!idleTtlMs || slot.running || slot.sessionId === foregroundSessionId) return;
    slot.idleTimer = timers.setTimeout(() => {
      void dispose(slot.sessionId);
    }, idleTtlMs);
  }

  function setForeground(sessionId) {
    foregroundSessionId = sessionId ?? null;
    const slot = get(sessionId);
    if (!slot) return slot;
    slot.lastUsedAt = now();
    clearIdle(slot);
    return slot;
  }

  function park(sessionId) {
    const slot = get(sessionId);
    if (!slot) return;
    slot.lastUsedAt = now();
    if (!slot.running) scheduleIdle(slot);
  }

  function idleCandidates() {
    return list()
      .filter((slot) => !slot.running && slot.sessionId !== foregroundSessionId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  }

  async function dispose(sessionId) {
    const slot = get(sessionId);
    if (!slot) return false;
    clearIdle(slot);
    slots.delete(sessionId);
    if (foregroundSessionId === sessionId) foregroundSessionId = null;
    try {
      await slot.host?.kill?.();
    } catch {
      /* best effort */
    }
    return true;
  }

  async function disposeWhere(predicate) {
    const targets = list().filter(predicate).map((slot) => slot.sessionId);
    for (const sessionId of targets) await dispose(sessionId);
    return targets.length;
  }

  async function disposeAll() {
    const ids = [...slots.keys()];
    if (healthTimer) timers.clearTimeout(healthTimer);
    healthTimer = null;
    for (const sessionId of ids) await dispose(sessionId);
  }

  async function checkHealth() {
    for (const slot of list()) {
      if (slot.host?.state !== "ready" || slot.health === "checking") continue;
      slot.health = "checking";
      try {
        await slot.host.call("getState");
        slot.health = "healthy";
        slot.lastHealthAt = now();
      } catch {
        slot.health = "unhealthy";
        if (!slot.running && slot.sessionId !== foregroundSessionId) await dispose(slot.sessionId);
      }
    }
    healthTimer = timers.setTimeout(() => void checkHealth(), healthTtlMs);
    healthTimer?.unref?.();
  }

  function startHealthChecks() {
    if (!healthTimer) {
      healthTimer = timers.setTimeout(() => void checkHealth(), healthTtlMs);
      healthTimer?.unref?.();
    }
  }

  async function evictToFit() {
    while (slots.size >= cap) {
      const idle = idleCandidates()[0];
      if (!idle) break;
      await dispose(idle.sessionId);
    }
  }

  function rekey(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return get(toId);
    const slot = slots.get(fromId);
    if (!slot) return null;
    slots.delete(fromId);
    slot.sessionId = toId;
    if (slot.host) slot.host.sessionId = toId;
    slots.set(toId, slot);
    if (foregroundSessionId === fromId) foregroundSessionId = toId;
    return slot;
  }

  function markRunning(sessionId, running) {
    const slot = get(sessionId);
    if (!slot) return null;
    slot.running = Boolean(running);
    slot.lastUsedAt = now();
    if (slot.running) clearIdle(slot);
    else if (slot.sessionId !== foregroundSessionId) scheduleIdle(slot);
    return slot;
  }

  function activate(sessionId) {
    const slot = get(sessionId);
    if (!slot) return null;
    const previousId = foregroundSessionId;
    setForeground(sessionId);
    if (previousId && previousId !== sessionId) park(previousId);
    return slot;
  }

  async function acquire({ sessionId = null, cwd, extensionsRoot, projectTrusted = true, createHost }) {
    startHealthChecks();
    if (sessionId && slots.has(sessionId)) return activate(sessionId);
    await evictToFit();
    if (slots.size >= cap && idleCandidates().length === 0) {
      const error = new Error("后台会话数量已达上限，请先停止或关闭一个会话");
      error.code = "worker_cap_exceeded";
      throw error;
    }
    if (typeof createHost !== "function") {
      const error = new Error("createHost is required");
      error.code = "invalid_args";
      throw error;
    }
    const host = createHost();
    host.activating = true;
    const pendingId = sessionId ?? `__pending-${now()}`;
    const slot = {
      sessionId: pendingId,
      cwd,
      host,
      running: false,
      lastUsedAt: now(),
      idleTimer: null,
      lastHealthAt: 0,
      health: "unknown",
    };
    const previousId = foregroundSessionId;
    slots.set(pendingId, slot);
    setForeground(pendingId);
    try {
      const info = await host.start(cwd, extensionsRoot, sessionId, projectTrusted);
      const id = info?.sessionId ?? sessionId ?? pendingId;
      slot.cwd = info?.cwd ?? cwd;
      if (id !== pendingId) rekey(pendingId, id);
      else slot.sessionId = id;
      if (slot.host) slot.host.sessionId = id;
      host.activating = false;
      slot.lastUsedAt = now();
      if (previousId && previousId !== slot.sessionId) park(previousId);
      return slot;
    } catch (error) {
      host.activating = false;
      slots.delete(pendingId);
      if (foregroundSessionId === pendingId) {
        foregroundSessionId = previousId && slots.has(previousId) ? previousId : null;
      }
      throw error;
    }
  }

  function configure(next = {}) {
    if (Number.isInteger(next.cap)) cap = Math.min(8, Math.max(1, next.cap));
    if (Number.isInteger(next.idleTtlMs)) idleTtlMs = Math.min(60 * 60 * 1000, Math.max(30_000, next.idleTtlMs));
  }

  return {
    get cap() {
      return cap;
    },
    get idleTtlMs() {
      return idleTtlMs;
    },
    configure,
    get,
    list,
    snapshots,
    foreground,
    hasRunning,
    isRunning,
    workspaceBusy,
    reusableWorkspaceSlot,
    activate,
    acquire,
    rekey,
    park,
    markRunning,
    dispose,
    disposeWhere,
    disposeAll,
  };
}
