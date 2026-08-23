/**
 * Close / shutdown lifecycle helpers. The desktop close path is a dialog plus
 * a fixed worker teardown order; this module keeps the decision mapping and
 * step plan testable without spinning Electron.
 *
 * Busy close: abort (stop only) → bounded flush → dispose → kill.
 * Idle close: flush → dispose → kill.
 */
export const CLOSE_DIALOG_BUTTONS = Object.freeze(["等待完成", "停止并退出", "取消"]);

export function closeDecisionFromIndex(index) {
  if (index === 0) return "wait";
  if (index === 1) return "stop";
  return "cancel";
}

export function plannedCloseSteps(decision, { busy = false } = {}) {
  if (decision === "cancel") return [];
  if (busy && decision === "stop") return ["abort", "flush", "dispose", "kill"];
  return ["flush", "dispose", "kill"];
}

export async function runWorkerTeardown(ops, { abortFirst = false } = {}) {
  const steps = [];
  if (abortFirst && typeof ops.abort === "function") {
    await ops.abort();
    steps.push("abort");
  }
  if (typeof ops.flush === "function") {
    await ops.flush();
    steps.push("flush");
  }
  if (typeof ops.dispose === "function") {
    await ops.dispose();
    steps.push("dispose");
  }
  if (typeof ops.kill === "function") {
    await ops.kill();
    steps.push("kill");
  }
  return steps;
}
