/**
 * Typed desktop settings. This store is the authority for Omega UI/runtime
 * preferences; Pi SettingsManager remains the authority for agent behavior
 * (steering, compaction, models). Credentials never live here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DESKTOP_SETTINGS_DEFAULTS = Object.freeze({
  themeMode: "system",
  workerCap: 3,
  workerIdleTtlMs: 5 * 60 * 1000,
  lastSessionId: null,
  lastWorkspace: null,
  rightPanelOpen: true,
  windowBounds: null,
});

const THEME_MODES = new Set(["system", "light", "dark"]);

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
    workerCap: clampInt(source.workerCap, 1, 8, base.workerCap),
    workerIdleTtlMs: clampInt(source.workerIdleTtlMs, 30_000, 60 * 60 * 1000, base.workerIdleTtlMs),
    lastSessionId: typeof source.lastSessionId === "string" && source.lastSessionId.trim() ? source.lastSessionId.trim().slice(0, 128) : null,
    lastWorkspace: typeof source.lastWorkspace === "string" && source.lastWorkspace.trim() ? source.lastWorkspace.trim().slice(0, 4096) : null,
    rightPanelOpen: typeof source.rightPanelOpen === "boolean" ? source.rightPanelOpen : base.rightPanelOpen,
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
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(current, null, "\t")}\n`);
    renameSync(temp, filePath);
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
