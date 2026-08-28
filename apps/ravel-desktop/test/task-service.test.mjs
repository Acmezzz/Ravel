import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TASK_DEPTH,
  SUBAGENT_TOOLS,
  buildTaskPrompt,
  finalAssistantTextOf,
  validateTaskInput,
} from "../electron/task-service.js";

test("task input validation fails closed and bounds the prompt", () => {
  assert.throws(() => validateTaskInput({}), (error) => error.code === "invalid_args");
  assert.throws(() => validateTaskInput({ prompt: "   " }), (error) => error.code === "invalid_args");
  assert.throws(() => validateTaskInput({ prompt: "x".repeat(50_000) }), (error) => error.code === "invalid_args");
  const validated = validateTaskInput({ prompt: "  梳理 auth 模块  ", description: "调研" });
  assert.equal(validated.prompt, "梳理 auth 模块");
  assert.equal(validated.description, "调研");
});

test("subagent surface stays inside the read-only family with a depth cap", () => {
  assert.deepEqual([...SUBAGENT_TOOLS], ["read", "grep", "find", "ls"]);
  assert.ok(MAX_TASK_DEPTH >= 1 && MAX_TASK_DEPTH <= 4, "depth cap exists and stays bounded");
  const prompt = buildTaskPrompt({ prompt: "找出所有使用 legacyAuth 的调用点" });
  assert.ok(prompt.includes("只读子代理"), "child is told it is read-only");
  assert.ok(prompt.includes("找出所有使用 legacyAuth 的调用点"));
});

test("finalAssistantTextOf picks the last assistant text and skips thinking parts", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "任务" }] },
    { role: "assistant", content: [{ type: "thinking", text: "internal" }, { type: "text", text: "结论 A" }] },
    { role: "toolCall", content: [] },
    { role: "assistant", content: [{ type: "text", text: "结论 B" }, { type: "text", text: "证据: src/a.ts:12" }] },
  ];
  assert.equal(finalAssistantTextOf(messages), "结论 B证据: src/a.ts:12");
  // A thinking-only tail keeps searching; with no earlier assistant text the result is null.
  assert.equal(finalAssistantTextOf([{ role: "assistant", content: [{ type: "thinking", text: "only thinking" }] }]), null);
  assert.equal(finalAssistantTextOf([]), null);
  assert.equal(finalAssistantTextOf(undefined), null);
});
