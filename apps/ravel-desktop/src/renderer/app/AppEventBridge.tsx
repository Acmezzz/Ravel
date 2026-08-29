import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { ipc } from "../ipc/client";
import type { ActivityRow } from "../types/dto";
import type { EventMeta, SafeEvent } from "../types/events";
import { advanceEventRef, initialEventOrderRef, isStaleEvent, type EventOrderRef } from "../lib/events/event-ordering";
import { reduceAgentEvent, type AgentEventCmd } from "../lib/events/agent-event-reducer";
import { reduceTransportEvent, type TransportCmd } from "../lib/events/transport-event-reducer";
import { refreshControlPlane } from "./AppBootstrap";

function executeAgentCmds(cmds: AgentEventCmd[]): void {
  for (const cmd of cmds) {
    switch (cmd.kind) {
      case "setConnection":
        useAppStore.getState().setConnection(cmd.state);
        break;
      case "ipcGetStateThenSetAgent":
        void ipc.getState().then((res) => {
          if (res.ok) useAppStore.getState().setAgent(res.data);
        });
        break;
      case "ipcListSessionsThenApplySessionPage":
        void ipc.listSessions().then((res) => {
          if (res.ok) useAppStore.getState().applySessionPage(res.data);
        });
        break;
    }
  }
}

function executeTransportCmds(cmds: TransportCmd[], handleEvent: (data: unknown) => void): void {
  for (const cmd of cmds) {
    switch (cmd.kind) {
      case "setConnection":
        useAppStore.getState().setConnection(cmd.state);
        break;
      case "setShutdownPhase":
        useAppStore.getState().setShutdownPhase(cmd.phase);
        break;
      case "setBootstrapError":
        useAppStore.getState().setBootstrapError(cmd.message);
        break;
      case "setWorkerError":
        useAppStore.getState().setWorkerError(cmd.message, cmd.canRetry);
        break;
      case "setComposerError":
        useAppStore.getState().setComposerError(cmd.message);
        break;
      case "resetRunState":
        useAppStore.setState({ streamingBuckets: {}, thinkingActive: false, compacting: false, retrying: false, bashTail: "" });
        break;
      case "refreshControlPlane":
        void refreshControlPlane();
        break;
      case "onReady":
        void (async () => {
          const reconciled = await refreshControlPlane();
          if (!reconciled) {
            useAppStore.getState().setComposerError("会话已恢复，但状态未完全同步。请手动刷新或重试。");
            return;
          }
          const store = useAppStore.getState();
          const state = store.agent;
          const sessionId = state?.sessionId ?? store.activeSessionId ?? undefined;
          if (store.pendingOptimistic.length > 0) {
            store.dropAllOptimistic();
            store.setComposerError("Worker 已恢复。未确认发送的消息没有自动重发，请检查后手动发送。");
          }
          const result = await ipc.recentEvents({ sessionId, after: 0, runtimeEpoch: 0 });
          if (!result.ok || result.data.gap || state?.isStreaming !== true) {
            if (result.ok && result.data.gap && !store.composerError) store.setComposerError("会话已恢复，事件缓存已重新同步");
            return;
          }
          for (const item of result.data.events) handleEvent({ event: item.event as SafeEvent, meta: item.meta as EventMeta });
        })();
        break;
    }
  }
}

/**
 * Subscribes to the agent event stream (onEvent / onActivityChanged / onStatus /
 * onTransport), applies event ordering, and routes accepted events into the
 * pure reducers. Async IPC and connection-state effects are executed here from
 * the returned command lists.
 */
export function AppEventBridge(): React.ReactNode | null {
  React.useEffect(() => {
    let orderRef: EventOrderRef = initialEventOrderRef();

    const handleEvent = (data: unknown): void => {
      const envelope = data && typeof data === "object" && "event" in data ? (data as { event: SafeEvent; meta?: EventMeta }) : { event: data as SafeEvent };
      const event = envelope.event;
      const meta = envelope.meta;
      const activeSessionId = useAppStore.getState().activeSessionId;
      if (meta) {
        const background = Boolean(activeSessionId && meta.sessionId && activeSessionId !== meta.sessionId);
        if (background && meta.sessionId) {
          const sessionId = meta.sessionId;
          if (event?.type === "agent_start" || event?.type === "turn_start") {
            useAppStore.getState().markSessionActivity(sessionId, { running: true, unread: true, failed: false });
          } else if (event?.type === "agent_end" || event?.type === "turn_end" || event?.type === "agent_settled") {
            useAppStore.getState().markSessionActivity(sessionId, { running: false, unread: true });
          } else if (event?.type === "compaction_start") {
            useAppStore.getState().markSessionActivity(sessionId, { compacting: true });
          } else if (event?.type === "compaction_end") {
            useAppStore.getState().markSessionActivity(sessionId, { compacting: false });
          } else if (event?.type === "error") {
            useAppStore.getState().markSessionActivity(sessionId, { failed: true, unread: true, running: false });
          }
          return;
        }
        if (isStaleEvent(meta, orderRef)) return;
        orderRef = advanceEventRef(meta, orderRef);
      }
      if (!event || typeof event !== "object" || typeof event.type !== "string") return;
      const cmds = reduceAgentEvent(
        { store: useAppStore.getState(), setState: useAppStore.setState, activeSessionId },
        event,
        meta,
      );
      executeAgentCmds(cmds);
    };

    const offEvent = window.omega.onEvent(handleEvent);
    const offActivity = ipc.onActivityChanged((data: unknown) => {
      const items = data && typeof data === "object" && "items" in data ? (data as { items?: unknown }).items : null;
      if (Array.isArray(items)) useAppStore.getState().applyActivityRows(items as ActivityRow[]);
    });
    const offStatus = window.omega.onStatus((data: unknown) => {
      const payload = data as { message?: string };
      if (payload?.message) useAppStore.getState().setBootstrapError(payload.message);
    });
    const offTransport = window.omega.onTransport((data) => {
      if (data.foreground === false) return;
      const cmds = reduceTransportEvent(data);
      executeTransportCmds(cmds, handleEvent);
    });

    return () => {
      offEvent();
      offActivity();
      offStatus();
      offTransport();
    };
  }, []);

  return null;
}