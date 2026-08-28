/**
 * ModeProfile — the frozen contract for session modes (next-cycle §3.3).
 *
 * A mode is a session strategy, never a second runtime: it declares the write
 * access, the tool allowlist, the completion criterion and an optional Histos
 * profile. `plan` is the only fully wired mode this cycle; `goal` occupies its
 * stable id but is explicitly unwired and degrades to the default session
 * behavior instead of faking evidence-based completion.
 *
 * Effective enforcement layers the existing permission guard: a mode never
 * widens access, it can only narrow it (plan forces the read-only profile).
 */
export const MODE_IDS = Object.freeze(["default", "plan", "goal"]);
export const MODE_COMPLETIONS = Object.freeze(["human-review", "evidence", "round-cap"]);
export const MODE_HISTOS_PROFILES = Object.freeze(["plan.explore", "session.semantic", "flow.convert"]);
/** The read tool family plan mode allows; everything else stays untrusted. */
export const PLAN_MODE_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);

function frozenProfile(profile) {
  return Object.freeze({
    id: profile.id,
    title: profile.title,
    wired: profile.wired,
    writeAccess: profile.writeAccess,
    tools: profile.tools ? Object.freeze([...profile.tools]) : null,
    budget: profile.budget ?? null,
    completion: profile.completion,
    histosProfile: profile.histosProfile ?? null,
    forcedPermissionProfile: profile.forcedPermissionProfile ?? null,
  });
}

const PROFILES = new Map([
  ["default", frozenProfile({
    id: "default",
    title: "默认",
    wired: true,
    writeAccess: null,
    tools: null,
    completion: null,
    histosProfile: null,
    forcedPermissionProfile: null,
  })],
  ["plan", frozenProfile({
    id: "plan",
    title: "计划",
    wired: true,
    writeAccess: "read-only",
    tools: PLAN_MODE_TOOLS,
    completion: "human-review",
    histosProfile: "plan.explore",
    forcedPermissionProfile: "read-only",
  })],
  ["goal", frozenProfile({
    id: "goal",
    title: "目标",
    wired: false,
    writeAccess: null,
    tools: null,
    completion: "evidence",
    histosProfile: null,
    forcedPermissionProfile: null,
  })],
]);

export function listModeProfiles() {
  return Object.freeze([...PROFILES.values()].map((profile) => ({ ...profile, tools: profile.tools ? [...profile.tools] : null })));
}

export function getModeProfile(id) {
  return PROFILES.has(id) ? { ...PROFILES.get(id), tools: PROFILES.get(id).tools ? [...PROFILES.get(id).tools] : null } : null;
}

/** Validate a mode id from an IPC request. Unknown ids fail closed. */
export function sanitizeModeProfile(id) {
  if (typeof id !== "string" || !PROFILES.has(id)) {
    throw Object.assign(new Error("Unsupported mode profile"), { code: "invalid_args" });
  }
  return id;
}

/** Whether a tool call is allowed by the mode's tool allowlist (null = unrestricted). */
export function modeAllowsTool(modeId, toolName) {
  const profile = PROFILES.get(modeId);
  if (!profile || !profile.wired) return true;
  if (!profile.tools) return true;
  return profile.tools.includes(toolName);
}
