import type { ConnectionState, ShutdownPhase } from "../../store/useAppStore";

/**
 * Transport-state reducer.
 *
 * Pure decision half of the `window.omega.onTransport` handler that used to
 * live in `App.tsx`. Each transport state is mapped to an ordered list of
 * {@link TransportCmd} values describing the effects the host (AppEventBridge)
 * executes: `setConnection` / `setShutdownPhase` / `setBootstrapError` /
 * `setWorkerError` / `setComposerError` store updates, a one-shot run-state
 * reset, an immediate `refreshControlPlane` fire, or the full "ready"
 * reconciliation block (refreshControlPlane + optimistic drop + recentEvents
 * replay) which the host runs back through the event handler.
 */

export type TransportCmd =
  | { kind: "setConnection"; state: ConnectionState }
  | { kind: "setShutdownPhase"; phase: ShutdownPhase }
  | { kind: "setBootstrapError"; message: string | null }
  | { kind: "setWorkerError"; message: string | null; canRetry: boolean }
  | { kind: "setComposerError"; message: string | null }
  | { kind: "resetRunState" }
  | { kind: "refreshControlPlane" }
  | { kind: "onReady" };

export interface TransportEventData {
  state: string;
  error?: string;
  canRetry?: boolean;
  sessionId?: string;
  foreground?: boolean;
}

export function reduceTransportEvent(data: TransportEventData): TransportCmd[] {
  const cmds: TransportCmd[] = [];

  switch (data.state) {
    case "reconcile":
      cmds.push({ kind: "refreshControlPlane" });
      break;
    case "ready":
      cmds.push({ kind: "setShutdownPhase", phase: "idle" });
      cmds.push({ kind: "setBootstrapError", message: null });
      cmds.push({ kind: "setConnection", state: "ready" });
      cmds.push({ kind: "setWorkerError", message: null, canRetry: false });
      cmds.push({ kind: "resetRunState" });
      cmds.push({ kind: "onReady" });
      break;
    case "closing":
      cmds.push({ kind: "setShutdownPhase", phase: "closing" });
      cmds.push({ kind: "setConnection", state: "closing" });
      cmds.push({ kind: "setComposerError", message: "正在停止 Agent…" });
      break;
    case "flushing":
      cmds.push({ kind: "setShutdownPhase", phase: "flushing" });
      cmds.push({ kind: "setConnection", state: "closing" });
      cmds.push({ kind: "setComposerError", message: "正在保存会话…" });
      break;
    case "exiting":
      cmds.push({ kind: "setShutdownPhase", phase: "exiting" });
      cmds.push({ kind: "setConnection", state: "closing" });
      cmds.push({ kind: "setComposerError", message: "正在退出…" });
      break;
    case "starting":
    case "restarting":
    case "stopping":
      cmds.push({ kind: "setConnection", state: "connecting" });
      if (data.state === "restarting") {
        cmds.push({ kind: "setWorkerError", message: data.error ?? "Agent worker 正在重启…", canRetry: false });
        cmds.push({ kind: "setComposerError", message: "Agent worker 正在重启…" });
      }
      break;
    case "renderer-crashed":
    case "renderer-unresponsive":
      cmds.push({ kind: "setConnection", state: "error" });
      cmds.push({
        kind: "setWorkerError",
        message: data.state === "renderer-crashed" ? "界面进程已崩溃，请重新加载" : "界面进程无响应，请稍候或重新加载",
        canRetry: false,
      });
      cmds.push({
        kind: "setComposerError",
        message: data.state === "renderer-crashed" ? "界面进程已崩溃，主进程正在等待操作" : "界面进程暂时无响应",
      });
      break;
    case "dead": {
      cmds.push({ kind: "setConnection", state: "error" });
      const message = data.error ? `Agent worker 已断开：${data.error}` : "Agent worker 已断开";
      cmds.push({ kind: "setWorkerError", message, canRetry: data.canRetry !== false });
      cmds.push({ kind: "setComposerError", message: data.canRetry === false ? message : `${message}。可点击重试。` });
      break;
    }
    default:
      break;
  }

  return cmds;
}