/**
 * 任务三：拆分 App 协调层 —— 新模块 fixture。
 *
 * 直接 import 新抽取的 TS 纯模块（node 24 原生 strip-types），
 * 断言其与基线夹具 renderer-event-ordering.test.mjs 的语义一致，
 * 并冒烟 reducer 的命令拆分。不触碰 Electron 主进程 / IPC。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { isStaleEvent, advanceEventRef, initialEventOrderRef } from "../src/renderer/lib/events/event-ordering.ts";
import { reduceTransportEvent } from "../src/renderer/lib/events/transport-event-reducer.ts";

// NOTE: `reduceAgentEvent` has runtime deps on stream-live / stream-bucket whose
// bundler-style extensionless imports cannot be resolved by node's strip-mode
// ESM loader, so it is not importable under `node --test` here. It is instead
// exercised through AppEventBridge (typecheck + app runtime).

test("事件排序：initialEventOrderRef 默认坐标", () => {
  assert.deepEqual(initialEventOrderRef(), { currentGeneration: 0, currentRuntimeEpoch: 0, lastSequence: 0 });
});

test("事件排序：较旧 generation 判定为旧", () => {
  const ref = { currentGeneration: 3, currentRuntimeEpoch: 1, lastSequence: 10 };
  assert.ok(isStaleEvent({ generation: 2, runtimeEpoch: 5, sequence: 99 }, ref));
});

test("事件排序：较新 generation 被接受", () => {
  const ref = { currentGeneration: 3, currentRuntimeEpoch: 1, lastSequence: 10 };
  assert.ok(!isStaleEvent({ generation: 4, runtimeEpoch: 0, sequence: 1 }, ref));
});

test("事件排序：同 generation 较旧 runtimeEpoch 判定为旧", () => {
  const ref = { currentGeneration: 3, currentRuntimeEpoch: 2, lastSequence: 0 };
  assert.ok(isStaleEvent({ generation: 3, runtimeEpoch: 1, sequence: 5 }, ref));
});

test("事件排序：同 generation/runtimeEpoch 下旧 sequence 判定为旧", () => {
  const ref = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  assert.ok(isStaleEvent({ generation: 2, runtimeEpoch: 1, sequence: 6 }, ref));
});

test("事件排序：同 sequence 重放被忽略（<= lastSequence）", () => {
  const ref = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  assert.ok(isStaleEvent({ generation: 2, runtimeEpoch: 1, sequence: 7 }, ref));
});

test("事件排序：递增 sequence 被接受", () => {
  const ref = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  assert.ok(!isStaleEvent({ generation: 2, runtimeEpoch: 1, sequence: 8 }, ref));
});

test("事件排序：接受后推进 ref", () => {
  const ref = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  const next = advanceEventRef({ generation: 2, runtimeEpoch: 1, sequence: 8 }, ref);
  assert.deepEqual(next, { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 8 });
});

test("事件排序：旧事件不推进（返回同一 ref）", () => {
  const ref = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  const next = advanceEventRef({ generation: 2, runtimeEpoch: 1, sequence: 5 }, ref);
  assert.equal(next, ref);
});

test("事件排序：generation 变化时 sequence 从 0 不再被压制", () => {
  const ref = { currentGeneration: 1, currentRuntimeEpoch: 0, lastSequence: 100 };
  assert.ok(!isStaleEvent({ generation: 2, runtimeEpoch: 0, sequence: 0 }, ref));
  assert.deepEqual(advanceEventRef({ generation: 2, runtimeEpoch: 0, sequence: 0 }, ref), {
    currentGeneration: 2,
    currentRuntimeEpoch: 0,
    lastSequence: 0,
  });
});

test("事件排序：runtimeEpoch 变化（同 generation）时 sequence 重置", () => {
  const ref = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 4 };
  assert.ok(!isStaleEvent({ generation: 2, runtimeEpoch: 2, sequence: 0 }, ref));
  assert.deepEqual(advanceEventRef({ generation: 2, runtimeEpoch: 2, sequence: 0 }, ref), {
    currentGeneration: 2,
    currentRuntimeEpoch: 2,
    lastSequence: 0,
  });
});

test("事件排序：runtimeEpoch 缺省视为 0", () => {
  const ref = { currentGeneration: 1, currentRuntimeEpoch: 0, lastSequence: -1 };
  assert.ok(!isStaleEvent({ generation: 1, sequence: 0 }, ref));
});

test("transport reducer：reconcile 触发一次 refreshControlPlane", () => {
  const cmds = reduceTransportEvent({ state: "reconcile" });
  assert.deepEqual(cmds, [{ kind: "refreshControlPlane" }]);
});

test("transport reducer：ready 重置运行态并进入 onReady", () => {
  const cmds = reduceTransportEvent({ state: "ready" });
  const kinds = cmds.map((c) => c.kind);
  assert.ok(kinds.includes("setShutdownPhase"));
  assert.ok(kinds.includes("setConnection"));
  assert.ok(kinds.includes("setWorkerError"));
  assert.ok(kinds.includes("resetRunState"));
  assert.ok(kinds.indexOf("onReady") === kinds.length - 1);
  assert.equal(cmds.find((c) => c.kind === "setConnection")?.state, "ready");
});

test("transport reducer：dead 携带 canRetry 与错误文案", () => {
  const cmds = reduceTransportEvent({ state: "dead", error: "boom", canRetry: true });
  assert.equal(cmds.find((c) => c.kind === "setWorkerError")?.message, "Agent worker 已断开：boom");
  const composer = cmds.find((c) => c.kind === "setComposerError");
  assert.ok(composer.message.startsWith("Agent worker 已断开：boom）。可点击重试。") || composer.message.endsWith("可点击重试。"));
  assert.equal(cmds.find((c) => c.kind === "setConnection")?.state, "error");
});