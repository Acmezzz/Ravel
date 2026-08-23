import * as React from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Workbench } from "./components/layout/Workbench";
import { CommandPalette } from "./components/layout/CommandPalette";
import { TreeOverlay } from "./components/layout/TreeOverlay";
import { FileViewer } from "./components/files/FileViewer";
import { useAppStore } from "./store/useAppStore";
import { ipc } from "./ipc/client";
import type { EventMeta, SafeEvent } from "./types/events";

async function refreshControlPlane(): Promise<boolean> {
  const store = useAppStore.getState();
  const [stateRes, modelsRes, commandsRes, authRes, sessionsRes] = await Promise.all([
    ipc.getState(),
    ipc.listModels(),
    ipc.listCommands(),
    ipc.authStatus(),
    ipc.listSessions(),
  ]);
  if (stateRes.ok) {
    store.setAgent(stateRes.data);
    store.setActiveSession(stateRes.data.sessionId);
    // Replace the transcript only when idle — during a run the streaming
    // bubbles are ahead of the persisted branch entries.
    if (stateRes.data.messages && !stateRes.data.isStreaming) {
      store.loadTranscript({
        id: stateRes.data.sessionId,
        title: stateRes.data.sessionName || "未命名会话",
        workspace: stateRes.data.cwd,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "active",
        messages: stateRes.data.messages,
        toolCards: stateRes.data.toolCards,
      });
    }
  }
  if (modelsRes.ok) store.setModels(modelsRes.data);
  if (commandsRes.ok) store.setCommands(commandsRes.data);
  if (authRes.ok) store.setAuth(authRes.data);
  if (sessionsRes.ok) store.setSessions(sessionsRes.data);
  return stateRes.ok;
}

async function refreshTranscriptWhenIdle(): Promise<void> {
  const res = await ipc.getState();
  if (!res.ok || res.data.isStreaming) return;
  useAppStore.getState().setAgent(res.data);
  if (res.data.messages) {
    useAppStore.getState().loadTranscript({
      id: res.data.sessionId,
      title: res.data.sessionName || "未命名会话",
      workspace: res.data.cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active",
      messages: res.data.messages,
      toolCards: res.data.toolCards,
    });
  }
}

async function startNewSession(): Promise<void> {
  const record = await ipc.newSession({});
  if (!record.ok) return;
  const store = useAppStore.getState();
  store.setActiveSession(record.data.id);
  store.loadTranscript(record.data);
  const state = await ipc.getState();
  if (state.ok) store.setAgent(state.data);
  const list = await ipc.listSessions();
  if (list.ok) store.setSessions(list.data);
}

/**
 * Top-level component: wraps the app in the MUI theme and subscribes to the
 * agent event stream + bootstrap errors, folding them into the Zustand store.
 */
export function App(): React.ReactElement {
  const setConnection = useAppStore((s) => s.setConnection);
  const setShutdownPhase = useAppStore((s) => s.setShutdownPhase);
  const setBootstrapError = useAppStore((s) => s.setBootstrapError);
  const setSessions = useAppStore((s) => s.setSessions);
  const setExtensionState = useAppStore((s) => s.setExtensionState);
  const setExtensionLoading = useAppStore((s) => s.setExtensionLoading);
  const themeMode = useAppStore((s) => s.themeMode);

  // Follow OS theme changes while in `system` mode.
  React.useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = mq.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", mq.matches);
      document.documentElement.style.colorScheme = resolved;
      useAppStore.setState({ resolvedMode: resolved });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode]);

  React.useEffect(() => {
    let lastSequence = 0;
    let currentGeneration = 0;
    const handleEvent = (data: unknown) => {
      const envelope = data && typeof data === "object" && "event" in data ? data as { event: SafeEvent; meta?: EventMeta } : { event: data as SafeEvent };
      const event = envelope.event;
      const meta = envelope.meta;
      const activeSessionId = useAppStore.getState().activeSessionId;
      if (meta) {
        if (activeSessionId && meta.sessionId && activeSessionId !== meta.sessionId) return;
        if (meta.generation < currentGeneration || meta.sequence <= lastSequence) return;
        if (currentGeneration && meta.generation > currentGeneration) lastSequence = 0;
        currentGeneration = meta.generation;
        lastSequence = meta.sequence;
      }
      if (!event || typeof event !== "object" || typeof event.type !== "string") return;
      const store = useAppStore.getState();
      switch (event.type) {
        case "message_start": {
          if (event.message.role === "user") {
            store.consumeOptimisticWith({
              role: "user",
              id: event.message.id ?? `user-${Date.now()}`,
              text: event.message.text ?? "",
              ts: new Date().toISOString(),
            });
          } else if (event.message.role === "assistant") {
            const id = event.message.id ?? `assistant-${Date.now()}`;
            store.appendMessage({
              role: "assistant",
              id,
              text: event.message.text ?? "",
              ts: new Date().toISOString(),
            });
            store.setStreamingAssistantId(id);
          }
          break;
        }
        case "message_end": {
          if (event.message.role === "user") {
            store.consumeOptimisticWith({
              role: "user",
              id: event.message.id ?? `user-${Date.now()}`,
              text: event.message.text ?? "",
              ts: new Date().toISOString(),
            });
          } else if (event.message.role === "assistant") {
            // Authoritative final text: replace the streaming bubble, covering
            // deltas missed across a mid-run reload.
            const finalId = event.message.id;
            const streamingId = store.streamingAssistantId;
            useAppStore.setState((state) => ({
              messages: state.messages.map((message) => {
                if (finalId && message.id === finalId) {
                  return { ...message, text: event.message.text ?? message.text };
                }
                if (streamingId && message.id === streamingId && (!finalId || finalId !== message.id)) {
                  return { ...message, id: finalId ?? message.id, text: event.message.text ?? message.text };
                }
                return message;
              }),
              streamingAssistantId: null,
            }));
          }
          break;
        }
        case "message_update": {
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta") {
            const id = store.streamingAssistantId ?? store.ensureStreamingAssistant();
            store.appendDelta(id, update.delta);
          } else if (update.type === "thinking_delta") {
            const id = store.streamingAssistantId ?? store.ensureStreamingAssistant();
            useAppStore.setState((state) => ({
              messages: state.messages.map((message) =>
                message.id === id ? { ...message, thinking: (message.thinking ?? "") + update.delta } : message,
              ),
            }));
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
          break;
        case "compaction_end":
          store.setCompacting(false);
          void refreshTranscriptWhenIdle();
          break;
        case "queue_update":
          store.setQueuedMessages({ steering: event.steering, followUp: event.followUp });
          break;
        case "session_info_changed":
          store.patchAgent({ sessionName: event.name ?? null });
          void ipc.listSessions().then((res) => {
            if (res.ok) useAppStore.getState().setSessions(res.data);
          });
          break;
        case "auto_retry_start":
          store.setRetrying(true);
          break;
        case "auto_retry_end":
          store.setRetrying(false);
          break;
        case "agent_start":
        case "turn_start":
          setConnection("running");
          store.setComposerError(null);
          useAppStore.setState({ bashTail: "", streamingAssistantId: null, lastAgentStartAt: Date.now() });
          break;
        case "agent_end":
        case "turn_end":
        case "agent_settled":
          setConnection("ready");
          store.setThinkingActive(false);
          void ipc.getState().then((res) => {
            if (res.ok) useAppStore.getState().setAgent(res.data);
          });
          break;
        case "error":
          store.appendMessage({
            role: "assistant",
            id: `error-${Date.now()}`,
            text: `⚠️ ${event.message ?? "Agent error"}`,
            ts: new Date().toISOString(),
          });
          break;
        default:
          break;
      }
    };

    const offEvent = window.omega.onEvent(handleEvent);
    const offStatus = window.omega.onStatus((data: unknown) => {
      const payload = data as { message?: string };
      if (payload?.message) setBootstrapError(payload.message);
    });
    const offTransport = window.omega.onTransport((data) => {
      if (data.state === "ready") {
        setShutdownPhase("idle");
        setBootstrapError(null);
        setConnection("ready");
        useAppStore.setState({ streamingAssistantId: null, thinkingActive: false, compacting: false, retrying: false, bashTail: "", queuedMessages: { steering: [], followUp: [] } });
        void (async () => {
          const reconciled = await refreshControlPlane();
          if (!reconciled) return;
          const state = useAppStore.getState().agent;
          const sessionId = state?.sessionId ?? useAppStore.getState().activeSessionId ?? undefined;
          const result = await ipc.recentEvents({ sessionId, after: 0 });
          if (!result.ok || result.data.gap || state?.isStreaming !== true) {
            if (result.ok && result.data.gap) useAppStore.getState().setComposerError("会话已恢复，事件缓存已重新同步");
            return;
          }
          for (const item of result.data.events) handleEvent({ event: item.event as SafeEvent, meta: item.meta as EventMeta });
        })();
      } else if (data.state === "closing") {
        setShutdownPhase("closing");
        setConnection("closing");
        useAppStore.getState().setComposerError("正在停止 Agent…");
      } else if (data.state === "flushing") {
        setShutdownPhase("flushing");
        setConnection("closing");
        useAppStore.getState().setComposerError("正在保存会话…");
      } else if (data.state === "exiting") {
        setShutdownPhase("exiting");
        setConnection("closing");
        useAppStore.getState().setComposerError("正在退出…");
      } else if (data.state === "starting" || data.state === "restarting" || data.state === "stopping") {
        setConnection("connecting");
      } else if (data.state === "dead") {
        setConnection("error");
        useAppStore.getState().setComposerError("Agent worker 已断开，正在等待恢复");
      }
    });

    setConnection("connecting");
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
        const res = await ipc.sessionReady();
        if (cancelled) return;
        if (res.ok && res.data.ready) {
          setConnection("ready");
          await refreshControlPlane();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
    void (async () => {
      setExtensionLoading(true);
      const res = await ipc.queryExtensionState({ scope: "all" });
      if (res.ok) setExtensionState(res.data);
      setExtensionLoading(false);
    })();

    return () => {
      cancelled = true;
      offEvent();
      offStatus();
      offTransport();
    };
  }, [setConnection, setShutdownPhase, setBootstrapError, setSessions, setExtensionState, setExtensionLoading]);

  React.useEffect(() => {
    // Workbench shortcuts: Ctrl+K toggles the command palette, Ctrl+Shift+N
    // starts a fresh session, Esc stops a running agent. (F11 fullscreen and
    // F12 devtools live in main.)
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const layout = useAppStore.getState().layout;
        useAppStore.getState().setCommandPaletteOpen(!layout.commandPaletteOpen);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void startNewSession();
        return;
      }
      if (e.key === "Escape" && useAppStore.getState().connection === "running") {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
          (target as HTMLInputElement).value.length > 0
        ) {
          return; // Esc in a non-empty input belongs to the editor.
        }
        void ipc.abort().then(() => useAppStore.getState().setConnection("ready"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ThemeProvider>
      <Workbench />
      <CommandPalette />
      <TreeOverlay />
      <FileViewer />
    </ThemeProvider>
  );
}
