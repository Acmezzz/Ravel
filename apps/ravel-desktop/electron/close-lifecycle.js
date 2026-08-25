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
  let firstError = null;
  const run = async (name) => {
    if (typeof ops[name] !== "function") return;
    try {
      await ops[name]();
    } catch (error) {
      firstError ??= error;
    } finally {
      steps.push(name);
    }
  };
  if (abortFirst) await run("abort");
  await run("flush");
  await run("dispose");
  await run("kill");
  if (firstError) throw firstError;
  return steps;
}
