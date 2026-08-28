/**
 * Task tool / subagent primitives (next-cycle B4; design ported from
 * oh-my-pi task.*, prime-agent rlm() and kilocode task — MIT).
 *
 * A subagent is a child AgentSession in the SAME worker process sharing the
 * parent's model runtime, approval guard and rulesets: no second runtime, no
 * second authority. Narrowing invariant: the child's tool surface is a strict
 * subset of the parent's (read-only research family), the same permission
 * rules apply, and recursion is depth-capped. Mutating subagents need
 * worktree isolation and stay out of scope (borrowing doc).
 *
 * Pure parts live here so tests can exercise validation without a runtime.
 */

export const SUBAGENT_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);
export const MAX_TASK_DEPTH = 2;
export const TASK_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_TASK_PROMPT_CHARS = 40_000;

/** Validate an author-supplied (model-supplied) task call. Fails closed. */
export function validateTaskInput(input) {
  const prompt = input && typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) {
    throw Object.assign(new Error("task needs a non-empty prompt"), { code: "invalid_args" });
  }
  if (prompt.length > MAX_TASK_PROMPT_CHARS) {
    throw Object.assign(new Error(`task prompt exceeds ${MAX_TASK_PROMPT_CHARS} characters`), { code: "invalid_args" });
  }
  const description = input && typeof input.description === "string" ? input.description.trim().slice(0, 200) : "";
  return { prompt, ...(description ? { description } : {}) };
}

/** The child's system context: role, scope and the read-only boundary. */
export function buildTaskPrompt(validated) {
  const lines = [
    "你是一个只读子代理，代表主会话完成一个有界任务。",
    "只允许读取、检索与分析（read/grep/find/ls）；不要尝试修改文件或执行命令。",
    "完成后用简洁的结构化文本汇报结论与证据（引用文件路径与行号）。",
    "",
    "任务：",
    validated.prompt,
  ];
  return lines.join("\n");
}

/** Last assistant message text from a finished child session; null when absent. */
export function finalAssistantTextOf(messages) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const content = message.content;
    const text = Array.isArray(content)
      ? content
          .filter((part) => !(part && typeof part === "object" && (part.type === "thinking" || part.type === "thinking_delta")))
          .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
          .filter(Boolean)
          .join("")
      : typeof content === "string"
        ? content
        : "";
    if (text.trim()) return text;
  }
  return null;
}
