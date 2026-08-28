/**
 * Typed desktop settings. This store is the authority for Omega UI/runtime
 * preferences; Pi SettingsManager remains the authority for agent behavior
 * (steering, compaction, models). Credentials never live here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_KEYBINDINGS, sanitizeKeybindings } from "./keybindings.js";
import { DEFAULT_PERMISSION_PROFILE } from "./permission-profiles.js";

export const DESKTOP_SETTINGS_DEFAULTS = Object.freeze({
  themeMode: "system",
  language: "zh-CN",
  workerCap: 3,
  workerIdleTtlMs: 5 * 60 * 1000,
  lastSessionId: null,
  lastWorkspace: null,
  rightPanelOpen: true,
  permissionProfile: DEFAULT_PERMISSION_PROFILE,
  modeProfile: "default",
  sessionRecovery: {},
  keybindings: DEFAULT_KEYBINDINGS,
  customProviders: {},
  windowBounds: null,
});

const THEME_MODES = new Set(["system", "light", "dark"]);
const PERMISSION_PROFILES = new Set(["trusted", "workspace-only", "read-only", "ask-before-command"]);
const MODE_PROFILES = new Set(["default", "plan", "goal"]);

// Settings updates are synchronous today, so JavaScript calls cannot overlap
// normally. Keep a process-local queue for re-entrant/concurrent persistence
// (for example, an update triggered by a filesystem test hook) and isolate
// temporary names so queued writes never contend for the same file.
const persistQueues = new Map();
let temporaryFileSequence = 0;

function getPersistQueue(filePath) {
  let queue = persistQueues.get(filePath);
  if (!queue) {
    queue = { active: false, pending: [] };
    persistQueues.set(filePath, queue);
  }
  return queue;
}

function releasePersistQueue(filePath, queue) {
  if (!queue.active && queue.pending.length === 0) persistQueues.delete(filePath);
}

function enqueuePersist(filePath, write) {
  const queue = getPersistQueue(filePath);
  queue.pending.push(write);
  if (queue.active) return;
  queue.active = true;
  try {
    while (queue.pending.length > 0) queue.pending.shift()();
  } finally {
    queue.active = false;
    releasePersistQueue(filePath, queue);
  }
}

function nextTemporaryPath(filePath) {
  temporaryFileSequence = (temporaryFileSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${filePath}.tmp-${process.pid}-${temporaryFileSequence}`;
}

function clampInt(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isInteger(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

export function sanitizeDesktopSettings(input, base = DESKTOP_SETTINGS_DEFAULTS) {
  const source = input && typeof input === "object" ? input : {};
  const bounds = source.windowBounds && typeof source.windowBounds === "object" ? source.windowBounds : null;
  return {
    themeMode: THEME_MODES.has(source.themeMode) ? source.themeMode : base.themeMode,
    language: source.language === "zh-CN" || source.language === "en-US" ? source.language : base.language,
    workerCap: clampInt(source.workerCap, 1, 8, base.workerCap),
    workerIdleTtlMs: clampInt(source.workerIdleTtlMs, 30_000, 60 * 60 * 1000, base.workerIdleTtlMs),
    lastSessionId: typeof source.lastSessionId === "string" && source.lastSessionId.trim() ? source.lastSessionId.trim().slice(0, 128) : null,
    lastWorkspace: typeof source.lastWorkspace === "string" && source.lastWorkspace.trim() ? source.lastWorkspace.trim().slice(0, 4096) : null,
    rightPanelOpen: typeof source.rightPanelOpen === "boolean" ? source.rightPanelOpen : base.rightPanelOpen,
    permissionProfile: PERMISSION_PROFILES.has(source.permissionProfile) ? source.permissionProfile : base.permissionProfile,
    modeProfile: MODE_PROFILES.has(source.modeProfile) ? source.modeProfile : base.modeProfile,
    sessionRecovery: source.sessionRecovery && typeof source.sessionRecovery === "object" ? Object.fromEntries(Object.entries(source.sessionRecovery).slice(-100).map(([id, value]) => [String(id).slice(0, 128), { state: typeof value?.state === "string" ? value.state.slice(0, 64) : "unknown", running: Boolean(value?.running), unread: Boolean(value?.unread), error: typeof value?.error === "string" ? value.error.slice(0, 1000) : null, retryAttempt: Number.isInteger(value?.retryAttempt) ? value.retryAttempt : 0, retryMaxAttempts: Number.isInteger(value?.retryMaxAttempts) ? value.retryMaxAttempts : 0, retryDelayMs: Number.isInteger(value?.retryDelayMs) ? value.retryDelayMs : 0, updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : new Date().toISOString() }])) : { ...base.sessionRecovery },
    keybindings: (() => { const normalized = sanitizeKeybindings(source.keybindings); return normalized.conflicts.length === 0 ? { commandPalette: normalized.commandPalette, newSession: normalized.newSession, abort: normalized.abort, zoomIn: normalized.zoomIn, zoomOut: normalized.zoomOut, zoomReset: normalized.zoomReset } : { ...base.keybindings }; })(),
    customProviders: source.customProviders && typeof source.customProviders === "object" ? Object.fromEntries(Object.entries(source.customProviders).slice(-50)) : { ...base.customProviders },
    windowBounds: bounds
      ? {
          x: clampInt(bounds.x, -10_000, 10_000, 80),
          y: clampInt(bounds.y, -10_000, 10_000, 80),
          width: clampInt(bounds.width, 800, 10_000, 1440),
          height: clampInt(bounds.height, 600, 10_000, 900),
          maximized: Boolean(bounds.maximized),
        }
      : null,
  };
}

export function createDesktopSettingsStore(filePath) {
  let current = { ...DESKTOP_SETTINGS_DEFAULTS };

  function load() {
    if (!existsSync(filePath)) {
      current = { ...DESKTOP_SETTINGS_DEFAULTS };
      return current;
    }
    try {
      current = sanitizeDesktopSettings(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      current = { ...DESKTOP_SETTINGS_DEFAULTS };
    }
    return current;
  }

  function persist() {
    const serialized = `${JSON.stringify(current, null, "\t")}\n`;
    enqueuePersist(filePath, () => {
      mkdirSync(dirname(filePath), { recursive: true });
      const temp = nextTemporaryPath(filePath);
      try {
        writeFileSync(temp, serialized);
        renameSync(temp, filePath);
      } catch (error) {
        try {
          // Best-effort cleanup; preserve the original persistence error.
          if (existsSync(temp)) unlinkSync(temp);
        } catch {
          // Ignore cleanup failures.
        }
        throw error;
      }
    });
  }

  function get() {
    return { ...current, windowBounds: current.windowBounds ? { ...current.windowBounds } : null };
  }

  function update(patch) {
    current = sanitizeDesktopSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) }, current);
    persist();
    return get();
  }

  load();
  return { load, get, update };
}
