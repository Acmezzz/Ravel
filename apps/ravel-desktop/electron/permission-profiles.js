import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { argsDigestOf } from "./session-facts.js";

export const PERMISSION_PROFILES = Object.freeze([
  "trusted",
  "workspace-only",
  "read-only",
  "ask-before-command",
]);

export const DEFAULT_PERMISSION_PROFILE = "workspace-only";
/** Known read-only built-ins; every other tool name is treated as untrusted. */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

/**
 * Risk tier per tool name. Unlike trust (the permission profile), this
 * classifies what a tool CAN do: read / mutating / untrusted. Unknown tools —
 * including extension-registered customs — default to untrusted and are
 * fail-closed: denied under restrictive profiles, approval-gated under ask.
 */
function riskTierOf(toolName) {
	if (READ_ONLY_TOOLS.has(toolName)) return "read";
	if (MUTATING_TOOLS.has(toolName)) return "mutating";
	return "untrusted";
}
const OPERATION_POLICIES = Object.freeze({
  "git.commit": { workspaceBound: true, confirmation: true },
  "worktree.remove": { workspaceBound: true, confirmation: true },
  "change.approve": { workspaceBound: true, confirmation: true },
  "resource.install": { workspaceBound: true, confirmation: true },
  "resource.remove": { workspaceBound: true, confirmation: true },
  "resource.enable": { workspaceBound: true, confirmation: true },
  "session.delete": { workspaceBound: false, confirmation: true },
  "provider.key.write": { workspaceBound: false, confirmation: true },
  "provider.key.remove": { workspaceBound: false, confirmation: true },
});
const PATH_KEYS = ["path", "filePath", "file", "directory", "source"];

function normalizePath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/") : "";
}

function isInsideWorkspace(value, cwd) {
  const target = normalizePath(value);
  const root = normalizePath(cwd).replace(/\/+$/, "");
  if (!target || !root || target.startsWith("~") || target.split("/").includes("..")) return false;
  try {
    const canonicalRoot = normalizePath(realpathSync.native(resolve(root))).replace(/\/+$/, "");
    const targetPath = target.startsWith("/") || /^[A-Za-z]:\//.test(target) ? target : resolve(root, target);
    const canonicalTarget = normalizePath(realpathSync.native(resolve(targetPath)));
    return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(`${canonicalRoot}/`);
  } catch {
    // New paths are checked lexically until they exist; existing symlinks must pass canonical containment.
    const lexical = normalizePath(target.startsWith("/") || /^[A-Za-z]:\//.test(target) ? resolve(target) : resolve(root, target));
    const lexicalRoot = normalizePath(resolve(root));
    return lexical === lexicalRoot || lexical.startsWith(`${lexicalRoot}/`);
  }
}

function pathsFromInput(input) {
  if (!input || typeof input !== "object") return [];
  return PATH_KEYS.flatMap((key) => {
    const value = input[key];
    return Array.isArray(value) ? value : [value];
  }).filter((value) => typeof value === "string" && value.trim());
}

export function sanitizePermissionProfile(value) {
  return PERMISSION_PROFILES.includes(value) ? value : DEFAULT_PERMISSION_PROFILE;
}

export function permissionProfileLabel(profile) {
  return {
    trusted: "Trusted（当前用户权限）",
    "workspace-only": "Workspace-only（仅限工作区）",
    "read-only": "Read-only（只读）",
    "ask-before-command": "Ask before command（执行前确认）",
  }[sanitizePermissionProfile(profile)];
}

export function permissionEventOf(event) {
	if (event && typeof event === "object" && event.toolCall && typeof event.toolCall === "object") {
		return {
			toolCall: event.toolCall,
			toolCallId: typeof event.toolCall.id === "string" ? event.toolCall.id : "",
			args: event.args && typeof event.args === "object" ? event.args : {},
		};
	}
	return {
		toolCall: { name: event?.toolName ?? "" },
		toolCallId: typeof event?.toolCallId === "string" ? event.toolCallId : "",
		args: event?.input && typeof event.input === "object" ? event.input : {},
	};
}

function denied(message) {
	const error = new Error(message);
	error.code = "permission_denied";
	throw error;
}

/**
 * Durable ask/decide flow around the interactive confirm. The ask is appended
 * BEFORE asking; only a successfully persisted `allowed-once` decision allows
 * the tool. Every failure mode is fail-closed:
 *   ask append failure / decided append failure -> deny
 *   explicit true            -> allowed-once (user-allowed)
 *   explicit false           -> rejected (user-denied)
 *   UI cancel                -> cancelled (ui-cancelled)
 *   timeout                  -> unavailable (timeout)
 *   confirm threw            -> unavailable (no-answerer)
 */
async function confirmWithDurableFacts({ toolName, toolCallId, input, confirm, facts, policyProfile }) {
	let askedId = null;
	if (facts) {
		const asked = {
			type: "approval_asked",
			id: randomUUID(),
			lane: "main",
			runId: facts.runId() ?? "",
			toolCallId,
			toolName,
			argsDigest: argsDigestOf(input),
			...(policyProfile ? { policyProfile } : {}),
			timestamp: Date.now(),
		};
		try {
			facts.appendAsked(asked);
			askedId = asked.id;
		} catch {
			denied("审批事实写入失败，已阻止本次执行");
		}
	}

	let outcome = "unavailable";
	let reasonCode = "no-answerer";
	// Correlation id of the interactive UI request, captured when issued.
	const uiRequest = { id: null };
	try {
		const answer = await confirm?.(
			"允许 Agent 执行变更？",
			`${toolName} 将修改工作区或执行 shell 命令。\n\n${JSON.stringify(input).slice(0, 4_000)}`,
			(id) => {
				uiRequest.id = id;
			},
		);
		if (answer === true) {
			outcome = "allowed-once";
			reasonCode = "user-allowed";
		} else if (answer && typeof answer === "object" && answer.cancelled === true) {
			outcome = "cancelled";
			reasonCode = "ui-cancelled";
		} else if (answer && typeof answer === "object" && answer.timedOut === true) {
			outcome = "unavailable";
			reasonCode = "timeout";
		} else {
			outcome = "rejected";
			reasonCode = "user-denied";
		}
	} catch {
		outcome = "unavailable";
		reasonCode = "no-answerer";
	}

	if (askedId !== null) {
		try {
			facts.appendDecided({
				type: "approval_decided",
				id: randomUUID(),
				lane: "main",
				runId: facts.runId() ?? "",
				toolCallId,
				askedId,
				outcome,
				reasonCode,
				...(uiRequest.id ? { uiRequestId: uiRequest.id } : {}),
				timestamp: Date.now(),
			});
		} catch {
			// A decision that could not be persisted must never allow execution.
			denied("审批决定未能落盘，已阻止本次执行");
		}
	}
	return outcome;
}

export async function assertOperationAllowed({ profile, cwd, confirm, operation, input = {} }) {
  const policy = OPERATION_POLICIES[operation];
  if (!policy) {
    const error = new Error(`未知副作用操作：${operation}`);
    error.code = "permission_denied";
    throw error;
  }
  const mode = sanitizePermissionProfile(profile);
  if (mode === "read-only") {
    const error = new Error(`权限 profile 为 Read-only，已阻止 ${operation}`);
    error.code = "permission_denied";
    throw error;
  }
  if (policy.workspaceBound && mode === "workspace-only") {
    for (const path of pathsFromInput(input)) {
      if (!isInsideWorkspace(path, cwd)) {
        const error = new Error(`路径超出授权 workspace，已阻止 ${operation}`);
        error.code = "workspace_unauthorized";
        throw error;
      }
    }
  }
  if (policy.confirmation && mode === "ask-before-command") {
    const allowed = await confirm?.(
      "允许执行高副作用操作？",
      `${operation} 将修改工作区或账户状态。\\n\\n${JSON.stringify(input).slice(0, 4_000)}`,
    );
    if (!allowed) {
      const error = new Error("用户拒绝了本次操作");
      error.code = "permission_denied";
      throw error;
    }
  }
}

export function createPermissionGuard({ profile, cwd, confirm, facts }) {
	const mode = sanitizePermissionProfile(profile);
	return async (event) => {
		const { toolCall, toolCallId, args } = permissionEventOf(event);
		const toolName = String(toolCall?.name ?? "");
		const input = args && typeof args === "object" ? args : {};
		const tier = riskTierOf(toolName);

		if (mode === "trusted") return;

		if (mode === "read-only" && tier !== "read") {
			const error = new Error(`权限 profile 为 Read-only，已阻止非只读工具 ${toolName}`);
			error.code = "permission_denied";
			throw error;
		}

		if (mode === "workspace-only") {
			if (toolName === "bash") {
				const error = new Error("Workspace-only 无法安全证明 shell 命令的路径范围，已阻止 bash");
				error.code = "permission_denied";
				throw error;
			}
			for (const path of pathsFromInput(input)) {
				if (!isInsideWorkspace(path, cwd)) {
					const error = new Error(`路径超出授权 workspace，已阻止 ${toolName}`);
					error.code = "workspace_unauthorized";
					throw error;
				}
			}
			if (tier === "untrusted") {
				const error = new Error(
					`未识别的工具 ${toolName} 无法证明其副作用范围，已按 fail-closed 阻止；请切换到 Ask-before-command 或 Trusted profile`,
				);
				error.code = "permission_denied";
				throw error;
			}
			return;
		}

		if (mode === "ask-before-command" && tier !== "read") {
			const outcome = await confirmWithDurableFacts({
				toolName,
				toolCallId,
				input,
				confirm,
				facts,
				policyProfile: mode,
			});
			if (outcome !== "allowed-once") {
				denied(
					outcome === "rejected"
						? "用户拒绝了本次工具执行"
						: outcome === "cancelled"
							? "本次审批已取消，未执行工具"
							: "无法获得审批（超时或界面不可用），已按 fail-closed 阻止本次执行",
				);
			}
		}
	};
}
