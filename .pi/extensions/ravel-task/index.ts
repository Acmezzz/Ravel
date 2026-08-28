/**
 * Ravel task bridge — first-party `task` tool for delegated subagents
 * (next-cycle B4; design ported from oh-my-pi task.*, prime-agent rlm() and
 * kilocode task, MIT).
 *
 * The tool surface is deliberately thin: execution lives in the agent worker
 * (injected as globalThis.__ravelTaskRunner), where the child AgentSession is
 * created with the parent's shared model runtime, the same fail-closed
 * approval guard and the same permission rulesets. Read-only tool family,
 * depth-capped recursion; approval facts land in the child's own JSONL
 * session. If the runner is missing the tool throws instead of degrading.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface TaskRunnerResult {
	text: string;
	sessionId: string;
}

type TaskRunner = (input: { prompt: string }) => Promise<TaskRunnerResult>;

export default function ravelTask(pi: ExtensionAPI) {
	pi.registerTool({
		name: "task",
		label: "Task: delegated subagent",
		description:
			"Delegate a bounded read-only research/analysis task to a subagent. " +
			"The subagent can read, grep, find and ls, but cannot modify files or run commands. " +
			"Provide a self-contained prompt describing the task and what to report back.",
		promptSnippet: "[task] delegate a bounded read-only task to a subagent",
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "Self-contained task description: what to investigate and what to report.",
				},
			},
			required: ["prompt"],
		},
		async execute(_toolCallId: string, params: unknown) {
			const runner = (globalThis as { __ravelTaskRunner?: TaskRunner }).__ravelTaskRunner;
			if (typeof runner !== "function") {
				throw new Error("task runner is unavailable in this worker");
			}
			const prompt = params && typeof params === "object" && typeof (params as { prompt?: unknown }).prompt === "string"
				? (params as { prompt: string }).prompt
				: "";
			const result = await runner({ prompt });
			return {
				content: [{ type: "text", text: result.text }],
				details: { subagentSessionId: result.sessionId },
			};
		},
	});
}
