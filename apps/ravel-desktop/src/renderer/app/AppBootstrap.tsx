import * as React from "react";
import { useAppStore } from "../store/useAppStore";
import { ipc } from "../ipc/client";

/**
 * Bootstrap coordination, extracted from `App.tsx`.
 *
 * `applyDesktopSettings` / `refreshControlPlane` / `startNewSession` are the
 * imperative async coordination functions; `AppBootstrap` drives the
 * `sessionReady` polling loop that was inline in `App.tsx`.
 */

export async function applyDesktopSettings(): Promise<void> {
  const store = useAppStore.getState();
  const res = await ipc.getDesktopSettings();
  if (!res.ok) return;
  store.setDesktopSettings(res.data);
  if (res.data.themeMode && res.data.themeMode !== store.themeMode) {
    store.setThemeMode(res.data.themeMode);
  }
  if (typeof res.data.rightPanelOpen === "boolean" && res.data.rightPanelOpen !== store.layout.rightPanelOpen) {
    store.setLayout({ rightPanelOpen: res.data.rightPanelOpen });
  }
}

export async function refreshControlPlane(): Promise<boolean> {
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
    if (stateRes.data.queuedMessages) {
      store.setQueuedMessages({
        steering: stateRes.data.queuedMessages.steering,
        followUp: stateRes.data.queuedMessages.followUp,
      });
    }
    if (stateRes.data.tree) store.setSessionTree(stateRes.data.tree);
    store.setCompacting(Boolean(stateRes.data.isCompacting));
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
      if (stateRes.data.queuedMessages) {
        store.setQueuedMessages({
          steering: stateRes.data.queuedMessages.steering,
          followUp: stateRes.data.queuedMessages.followUp,
        });
      }
      if (stateRes.data.tree) store.setSessionTree(stateRes.data.tree);
    }
  }
  if (modelsRes.ok) store.setModels(modelsRes.data);
  if (commandsRes.ok) store.setCommands(commandsRes.data);
  if (authRes.ok) store.setAuth(authRes.data);
  if (sessionsRes.ok) store.applySessionPage(sessionsRes.data);
  const activityRes = await ipc.activitySnapshot();
  if (activityRes.ok) store.applyActivityRows(activityRes.data.items);
  if (stateRes.ok) {
    store.setConnection(stateRes.data.isStreaming ? "running" : "ready");
  }
  return stateRes.ok;
}

export async function startNewSession(): Promise<void> {
  const record = await ipc.newSession({});
  if (!record.ok) return;
  const store = useAppStore.getState();
  store.setActiveSession(record.data.id);
  store.loadTranscript(record.data);
  const state = await ipc.getState();
  if (state.ok) {
    store.setAgent(state.data);
    store.setConnection(state.data.isStreaming ? "running" : "ready");
  }
  const list = await ipc.listSessions();
  if (list.ok) store.applySessionPage(list.data);
}

/**
 * Drives the session-ready polling (up to 40 × 500ms) and applies desktop
 * settings + control-plane refresh once the session is ready.
 */
export function AppBootstrap(): React.ReactElement {
  const setConnection = useAppStore((s) => s.setConnection);

  React.useEffect(() => {
    setConnection("connecting");
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
        const res = await ipc.sessionReady();
        if (cancelled) return;
        if (res.ok && res.data.ready) {
          setConnection("ready");
          await applyDesktopSettings();
          await refreshControlPlane();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setConnection]);

  return <></>;
}