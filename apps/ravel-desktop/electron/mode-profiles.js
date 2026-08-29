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
/** Model-visible text injected on plan approval to switch back to execution. */
export const PLAN_APPROVED_TEXT = "计划已批准，执行。";

/** Goal-mode budget defaults (B2): rounds and wall-clock, not self-declared completion. */
export const GOAL_ROUND_CAP = 25;
export const GOAL_ELAPSED_CAP_MS = 30 * 60 * 1000;
export const GOAL_CONTINUATION_TEXT = "目标尚未完成，在预算内继续推进。";

/** Delimiters for the model-visible block that carries the plan-mode directive. */
export const MODE_DIRECTIVE_BEGIN = "===== BEGIN RAVEL MODE DIRECTIVE =====";
export const MODE_DIRECTIVE_END = "===== END RAVEL MODE DIRECTIVE =====";

/**
 * Model-visible instruction for plan mode: the plan's deliverable is the plan
 * file (the only path the guard lets the agent write); everything else stays
 * read-only until the human approves.
 */
export function buildModeDirectiveBlock(planFile) {
	if (!planFile) return "";
	return `\n${MODE_DIRECTIVE_BEGIN}\n当前为计划模式（只读探索）。请把完整计划写入计划文件 ${planFile}；除该文件外不得修改任何内容。计划完成后停下，等待用户审阅。\n${MODE_DIRECTIVE_END}`;
}

/** Split a prompt into the user-visible text and the appended mode directive. */
export function stripModeDirectiveBlock(text) {
	if (typeof text !== "string") return { text: text ?? "", block: "" };
	const begin = text.indexOf(MODE_DIRECTIVE_BEGIN);
	if (begin < 0) return { text, block: "" };
	const end = text.indexOf(MODE_DIRECTIVE_END, begin);
	if (end < 0) return { text, block: "" };
	const block = text.slice(begin, end + MODE_DIRECTIVE_END.length);
	const visible = (text.slice(0, begin) + text.slice(end + MODE_DIRECTIVE_END.length)).replace(/\n+$/, "");
	return { text: visible, block };
}

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
    wired: true,
    writeAccess: null,
    tools: null,
    completion: "round-cap",
    histosProfile: null,
    forcedPermissionProfile: null,
    budget: { roundCap: GOAL_ROUND_CAP, elapsedCapMs: GOAL_ELAPSED_CAP_MS },
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

/** Goal budget state: one round per prompt (initial + each continuation). */
export function goalCapExceeded(state, now = Date.now()) {
  if (!state) return false;
  if (state.rounds >= GOAL_ROUND_CAP) return true;
  return now - state.startedAt >= GOAL_ELAPSED_CAP_MS;
}

/** Return a serializable mode declaration for the Histos agent_spec adapter. */
export function modeProfileDeclaration(modeId) {
  const profile = getModeProfile(modeId);
  if (!profile) throw Object.assign(new Error("Unsupported mode profile"), { code: "invalid_args" });
  return {
    id: profile.id,
    title: profile.title,
    writeAccess: profile.writeAccess,
    tools: profile.tools ? [...profile.tools] : null,
    budget: profile.budget ? { ...profile.budget } : null,
    completion: profile.completion,
    histosProfile: profile.histosProfile,
  };
}
