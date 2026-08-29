/**
 * 任务一：Ravel Shell 重构基线与测试夹具 —— 事件排序。
 *
 * 自包含夹具，忠实复刻 `src/renderer/App.tsx` `handleEvent` 中针对当前 session 的
 * 旧事件判定逻辑（generation → runtimeEpoch → sequence 三元组）：
 *
 *   若 meta.generation < 当前，或 (generation 相等且 runtimeEpoch 更小)，或
 *   (generation 与 runtimeEpoch 都相等且 sequence <= lastSequence)，则该事件为旧，
 *   应被忽略；否则事件被接受并用其坐标推进事件时钟。
 *
 * 当 generation 或 runtimeEpoch 变化时，sequence 维度重置（不延续旧 sequence）。
 *
 * 不 import 任何源码模块；不触碰 Electron 主进程 / IPC / 事件字段。
 */
import test from "node:test";
import assert from "node:assert/strict";

/** 事件时钟：记录已接受的最高事件坐标。 */
export function createEventClock() {
  return {
    currentGeneration: 0,
    currentRuntimeEpoch: 0,
    lastSequence: -1,
  };
}

/** 判定一个事件的 meta 是否“旧”（应被忽略）。 */
export function isEventStale(clock, meta) {
  const generation = meta.generation;
  const runtimeEpoch = meta.runtimeEpoch ?? 0;
  const sequence = meta.sequence;
  if (generation < clock.currentGeneration) return true;
  if (generation === clock.currentGeneration && runtimeEpoch < clock.currentRuntimeEpoch) return true;
  if (
    generation === clock.currentGeneration &&
    runtimeEpoch === clock.currentRuntimeEpoch &&
    sequence <= clock.lastSequence
  ) {
    return true;
  }
  return false;
}

/**
 * 处理一个带 meta 的事件：若为旧事件则返回原时钟（不推进）；否则用其坐标推进时钟。
 */
export function advanceEventClock(clock, meta) {
  if (isEventStale(clock, meta)) return clock;
  const generation = meta.generation;
  const runtimeEpoch = meta.runtimeEpoch ?? 0;
  return {
    currentGeneration: generation,
    currentRuntimeEpoch: runtimeEpoch,
    lastSequence: meta.sequence,
  };
}

test("较旧 generation 的事件被判定为旧", () => {
  const clock = { currentGeneration: 3, currentRuntimeEpoch: 1, lastSequence: 10 };
  assert.ok(isEventStale(clock, { generation: 2, runtimeEpoch: 5, sequence: 99 }));
});

test("较新 generation 的事件被接受（即便其余更低）", () => {
  const clock = { currentGeneration: 3, currentRuntimeEpoch: 1, lastSequence: 10 };
  assert.ok(!isEventStale(clock, { generation: 4, runtimeEpoch: 0, sequence: 1 }));
});

test("同 generation 下较旧 runtimeEpoch 的事件被判定为旧", () => {
  const clock = { currentGeneration: 3, currentRuntimeEpoch: 2, lastSequence: 0 };
  assert.ok(isEventStale(clock, { generation: 3, runtimeEpoch: 1, sequence: 5 }));
});

test("同 generation 下较新 runtimeEpoch 的事件被接受（sequence 被忽略）", () => {
  const clock = { currentGeneration: 3, currentRuntimeEpoch: 2, lastSequence: 100 };
  assert.ok(!isEventStale(clock, { generation: 3, runtimeEpoch: 3, sequence: 0 }));
});

test("同 generation 且同 runtimeEpoch 下旧 sequence 被判定为旧", () => {
  const clock = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  assert.ok(isEventStale(clock, { generation: 2, runtimeEpoch: 1, sequence: 6 }));
});

test("同 sequence 重放被忽略（<= lastSequence）", () => {
  const clock = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  assert.ok(isEventStale(clock, { generation: 2, runtimeEpoch: 1, sequence: 7 }));
});

test("更新序列（sequence 递增）被接受", () => {
  const clock = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  assert.ok(!isEventStale(clock, { generation: 2, runtimeEpoch: 1, sequence: 8 }));
});

test("generic 递增接受后推进事件时钟", () => {
  const clock = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  const next = advanceEventClock(clock, { generation: 2, runtimeEpoch: 1, sequence: 8 });
  assert.deepEqual(next, { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 8 });
});

test("旧事件不推进事件时钟", () => {
  const clock = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 7 };
  const next = advanceEventClock(clock, { generation: 2, runtimeEpoch: 1, sequence: 5 });
  assert.equal(next, clock);
});

test("generation 变化时 sequence 重置：旧的较大 sequence 不压制新事件", () => {
  // 旧时钟已在 sequence 100；切到新 generation 后首事件 sequence 从 0 开始。
  const clock = { currentGeneration: 1, currentRuntimeEpoch: 0, lastSequence: 100 };
  assert.ok(
    !isEventStale(clock, { generation: 2, runtimeEpoch: 0, sequence: 0 }),
    "新 generation 下 sequence 从 0 开始不应被判定为旧"
  );
  const next = advanceEventClock(clock, { generation: 2, runtimeEpoch: 0, sequence: 0 });
  assert.deepEqual(next, { currentGeneration: 2, currentRuntimeEpoch: 0, lastSequence: 0 });
});

test("runtimeEpoch 变化（同 generation）时 sequence 重置", () => {
  const clock = { currentGeneration: 2, currentRuntimeEpoch: 1, lastSequence: 4 };
  assert.ok(!isEventStale(clock, { generation: 2, runtimeEpoch: 2, sequence: 0 }));
  const next = advanceEventClock(clock, { generation: 2, runtimeEpoch: 2, sequence: 0 });
  assert.deepEqual(next, { currentGeneration: 2, currentRuntimeEpoch: 2, lastSequence: 0 });
});

test("重置后同 generation/runtimeEpoch 下 sequence 重新累计", () => {
  let clock = { currentGeneration: 2, currentRuntimeEpoch: 2, lastSequence: 0 };
  assert.ok(!isEventStale(clock, { generation: 2, runtimeEpoch: 2, sequence: 1 }));
  clock = advanceEventClock(clock, { generation: 2, runtimeEpoch: 2, sequence: 1 });
  // 重放的 sequence 1 现在应被判定为旧。
  assert.ok(isEventStale(clock, { generation: 2, runtimeEpoch: 2, sequence: 1 }));
});

test("runtimeEpoch 缺省时视为 0", () => {
  const clock = { currentGeneration: 1, currentRuntimeEpoch: 0, lastSequence: -1 };
  assert.ok(!isEventStale(clock, { generation: 1, sequence: 0 }));
});