import type { AppState, ConnectionState } from "../../store/useAppStore";
import type { EventMeta, SafeEvent } from "../../types/events";
import { streamBucketOf } from "../stream-bucket";
import {
  appendStreamText,
  appendStreamThinking,
  getStreamLive,
  moveStreamLive,
  resetStreamLive,
  seedStreamLive,
} from "../stream-live";

/**
 * Agent-event reducer.
 *
 * This is the pure decision half of the `handleEvent` switch that used to live
 * in `App.tsx`. Each accepted (non-stale, non-background) agent event is reduced
 * into an ordered list of {@link AgentEventCmd} values describing the effects
 * the host (AppEventBridge) must execute:
 *
 *   - synchronous store mutations still happen through the injected
 *     `ctx.store` / `ctx.setState` (the zustand store owns all state);
 *   - async IPC calls and the React-bound `setConnection` are returned as
 *     commands so the reducer stays side-effect-free and testable.
 *
 * The ordering fence (stale detection) and the background-session shortcut live
 * in AppEventBridge, *before* this reducer is invoked.
 */

export type AgentEventCmd =
  | { kind: "setConnection"; state: ConnectionState }
  | { kind: "ipcGetStateThenSetAgent" }
  | { kind: "ipcListSessionsThenApplySessionPage" };

export interface AgentEventContext {
  store: AppState;
  setState: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
  activeSessionId: string | null;
}

export function reduceAgentEvent(
  ctx: AgentEventContext,
  event: SafeEvent,
  meta?: EventMeta,
): AgentEventCmd[] {
  const { store, setState, activeSessionId } = ctx;
  const cmds: AgentEventCmd[] = [];

  switch (event.type) {
    case "message_start": {
      if (event.message.role === "user") {
        store.consumeOptimisticWith(
          {
            role: "user",
            id: event.message.id ?? `user-${Date.now()}`,
            text: event.message.text ?? "",
            ts: new Date().toISOString(),
          },
          undefined,
          meta?.clientMessageId,
        );
      } else if (event.message.role === "assistant") {
        const id = event.message.id ?? `assistant-${Date.now()}`;
        store.appendMessage({
          role: "assistant",
          id,
          text: event.message.text ?? "",
          ts: new Date().toISOString(),
        });
        seedStreamLive(id, { text: event.message.text ?? "" });
        store.setStreamingBucket(streamBucketOf(meta), id);
      }
      break;
    }
    case "message_end": {
      if (event.message.role === "user") {
        // message_start normally consumes the optimistic bubble. The end
        // event remains a safe fallback for a missed start or late replay.
        store.consumeOptimisticWith(
          {
            role: "user",
            id: event.message.id ?? `user-${Date.now()}`,
            text: event.message.text ?? "",
            ts: new Date().toISOString(),
          },
          undefined,
          meta?.clientMessageId,
        );
      } else if (event.message.role === "assistant") {
        // Authoritative final text: replace the streaming bubble, covering
        // deltas missed across a mid-run reload. Only this run's bucket
        // closes; other runs (if any) keep their own bubbles.
        const finalId = event.message.id;
        const bucket = streamBucketOf(meta);
        const streamingId = ctx.store.streamingBuckets[bucket];
        const liveSnapshot = streamingId ? getStreamLive(streamingId) : null;
        if (streamingId && finalId && finalId !== streamingId) moveStreamLive(streamingId, finalId);
        setState((state) => {
          const nextBuckets = { ...state.streamingBuckets };
          delete nextBuckets[bucket];
          return {
            messages: state.messages.map((message) => {
              if (finalId && message.id === finalId) {
                return { ...message, text: event.message.text ?? liveSnapshot?.text ?? message.text, thinking: liveSnapshot?.thinking || message.thinking };
              }
              if (streamingId && message.id === streamingId && (!finalId || finalId !== message.id)) {
                return { ...message, id: finalId ?? message.id, text: event.message.text ?? liveSnapshot?.text ?? message.text, thinking: liveSnapshot?.thinking || message.thinking };
              }
              return message;
            }),
            streamingBuckets: nextBuckets,
          };
        });
        if (streamingId) resetStreamLive(finalId ?? streamingId);
      }
      break;
    }
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        const bucket = streamBucketOf(meta);
        const id = ctx.store.streamingBuckets[bucket] ?? store.ensureStreamingAssistant(bucket);
        appendStreamText(id, update.delta);
      } else if (update.type === "thinking_delta") {
        const bucket = streamBucketOf(meta);
        const id = ctx.store.streamingBuckets[bucket] ?? store.ensureStreamingAssistant(bucket);
        appendStreamThinking(id, update.delta);
      }
      break;
    }
    case "tool_execution_summary":
      store.upsertToolCard(event);
      break;
    case "bash_execution_update":
      store.appendBashTail(event.delta);
      break;
    case "thinking_status":
      store.setThinkingActive(event.active);
      break;
    case "thinking_level_changed":
      store.patchAgent({ thinkingLevel: event.level });
      break;
    case "compaction_start":
      store.setCompacting(true);
      if (activeSessionId) store.markSessionActivity(activeSessionId, { compacting: true });
      break;
    case "compaction_end":
      store.setCompacting(false);
      if (activeSessionId) store.markSessionActivity(activeSessionId, { compacting: false });
      cmds.push({ kind: "ipcGetStateThenSetAgent" });
      break;
    case "queue_update":
      store.setQueuedMessages({ steering: event.steering, followUp: event.followUp });
      break;
    case "session_info_changed":
      store.patchAgent({ sessionName: event.name ?? null });
      cmds.push({ kind: "ipcListSessionsThenApplySessionPage" });
      break;
    case "auto_retry_start":
      store.setRetrying(true);
      break;
    case "auto_retry_end":
      store.setRetrying(false);
      break;
    case "agent_start":
    case "turn_start":
      cmds.push({ kind: "setConnection", state: "running" });
      store.setComposerError(null);
      if (activeSessionId) store.markSessionActivity(activeSessionId, { running: true, failed: false });
      resetStreamLive();
      setState({ bashTail: "", streamingBuckets: {}, lastAgentStartAt: Date.now() });
      break;
    case "agent_end":
    case "turn_end":
    case "agent_settled":
      cmds.push({ kind: "setConnection", state: "ready" });
      store.setThinkingActive(false);
      if (activeSessionId) store.markSessionActivity(activeSessionId, { running: false, compacting: false });
      cmds.push({ kind: "ipcGetStateThenSetAgent" });
      break;
    case "error":
      if (activeSessionId) store.markSessionActivity(activeSessionId, { failed: true, running: false });
      store.setComposerError(event.message ?? "Agent error");
      break;
    default:
      break;
  }

  return cmds;
}