export const PERMISSION_PROFILES = Object.freeze([
  "trusted",
  "workspace-only",
  "read-only",
  "ask-before-command",
]);

const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);
const PATH_KEYS = ["path", "filePath", "file", "directory"];

function normalizePath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/") : "";
}

function isInsideWorkspace(value, cwd) {
  const target = normalizePath(value);
  const root = normalizePath(cwd).replace(/\/+$/, "");
  if (!target || !root) return false;
  if (target.startsWith("/") || /^[A-Za-z]:\//.test(target)) {
    return target === root || target.startsWith(`${root}/`);
  }
  return !target.split("/").includes("..") && !target.startsWith("~");
}

function pathsFromInput(input) {
  if (!input || typeof input !== "object") return [];
  return PATH_KEYS.flatMap((key) => {
    const value = input[key];
    return Array.isArray(value) ? value : [value];
  }).filter((value) => typeof value === "string" && value.trim());
}

export function sanitizePermissionProfile(value) {
  return PERMISSION_PROFILES.includes(value) ? value : "trusted";
}

export function permissionProfileLabel(profile) {
  return {
    trusted: "Trusted（当前用户权限）",
    "workspace-only": "Workspace-only（仅限工作区）",
    "read-only": "Read-only（只读）",
    "ask-before-command": "Ask before command（执行前确认）",
  }[sanitizePermissionProfile(profile)];
}

export function createPermissionGuard({ profile, cwd, confirm }) {
  const mode = sanitizePermissionProfile(profile);
  return async ({ toolCall, args }) => {
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
