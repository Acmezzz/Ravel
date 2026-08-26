import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const PERMISSION_PROFILES = Object.freeze([
  "trusted",
  "workspace-only",
  "read-only",
  "ask-before-command",
]);

export const DEFAULT_PERMISSION_PROFILE = "workspace-only";
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);
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
      args: event.args && typeof event.args === "object" ? event.args : {},
    };
  }
  return {
    toolCall: { name: event?.toolName ?? "" },
    args: event?.input && typeof event.input === "object" ? event.input : {},
  };
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

export function createPermissionGuard({ profile, cwd, confirm }) {
  const mode = sanitizePermissionProfile(profile);
  return async (event) => {
    const { toolCall, args } = permissionEventOf(event);
    const toolName = String(toolCall?.name ?? "");
    const input = args && typeof args === "object" ? args : {};

    if (mode === "trusted") return;

    if (mode === "read-only" && MUTATING_TOOLS.has(toolName)) {
      const error = new Error(`权限 profile 为 Read-only，已阻止 ${toolName} 工具`);
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
      return;
    }

    if (mode === "ask-before-command" && MUTATING_TOOLS.has(toolName)) {
      const allowed = await confirm?.(
        "允许 Agent 执行变更？",
        `${toolName} 将修改工作区或执行 shell 命令。\n\n${JSON.stringify(input).slice(0, 4_000)}`,
      );
      if (!allowed) {
        const error = new Error("用户拒绝了本次工具执行");
        error.code = "permission_denied";
        throw error;
      }
    }
  };
}
