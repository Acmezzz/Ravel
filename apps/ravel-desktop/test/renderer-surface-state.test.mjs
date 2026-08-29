/**
 * 任务一：Ravel Shell 重构基线与测试夹具 —— surfaceMode。
 *
 * 自包含夹具。Spec 定义了独立的产品表面维度 `surfaceMode: "chat" | "ide" | "histos"`
 * （默认 `chat`），`SurfaceRouter` 仅依据 `surfaceMode` 返回对应 Surface，且不复用
 * `agent.mode`。当前源码尚无 `surfaceMode`，故此处实现一个最小 reducer 作为重构基线
 * 的契约，用于未来 `store/slices/surfaceSlice.ts` 对齐。
 *
 * 不 import 任何源码模块；不触碰 Electron 主进程 / IPC / 事件字段。
 */
import test from "node:test";
import assert from "node:assert/strict";

export const SURFACE_MODES = ["chat", "ide", "histos"];
export const DEFAULT_SURFACE_MODE = "chat";

/** 仅用于夹具的最小状态形态：`surfaceMode` 与 `agentMode` 是两个独立维度。 */
export function createSurfaceState(overrides = {}) {
  return {
    surfaceMode: DEFAULT_SURFACE_MODE,
    agentMode: "default",
    ...overrides,
  };
}

export function setSurfaceMode(state, mode) {
  if (!SURFACE_MODES.includes(mode)) return state;
  return { ...state, surfaceMode: mode };
}

export function setAgentMode(state, mode) {
  return { ...state, agentMode: mode };
}

test("surfaceMode 默认值为 chat", () => {
  assert.equal(DEFAULT_SURFACE_MODE, "chat");
  const state = createSurfaceState();
  assert.equal(state.surfaceMode, "chat");
});

test("surfaceMode 是独立维度，agent.mode 变化不得影响 surfaceMode", () => {
  const state = createSurfaceState({ surfaceMode: "ide", agentMode: "default" });
  const next = setAgentMode(state, "plan");
  assert.equal(next.agentMode, "plan");
  assert.equal(next.surfaceMode, "ide");
});

test("切换 agent.mode 多次后 surfaceMode 保持默认 chat", () => {
  let state = createSurfaceState();
  for (const mode of ["plan", "goal", "restricted", "elevated"]) {
    state = setAgentMode(state, mode);
    assert.equal(state.surfaceMode, "chat");
  }
  assert.equal(state.agentMode, "elevated");
});

test("surfaceMode 合法值仅允许 chat/ide/histos，非法值被忽略", () => {
  const state = createSurfaceState({ surfaceMode: "histos" });
  const next = setSurfaceMode(state, "settings");
  assert.equal(next.surfaceMode, "histos");
});

test("显式切换 surfaceMode 不影响 agent.mode", () => {
  const state = createSurfaceState({ agentMode: "plan" });
  const next = setSurfaceMode(state, "histos");
  assert.equal(next.surfaceMode, "histos");
  assert.equal(next.agentMode, "plan");
});

test("从空状态构造时占位字段不改变默认 surface", () => {
  const state = createSurfaceState({ agentMode: "goal" });
  assert.equal(state.surfaceMode, "chat");
});