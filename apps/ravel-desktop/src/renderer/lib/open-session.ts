/**
 * Shared "switch to this session" flow used by the 动态 list, @session chips,
 * and anywhere else that opens a session from a pointer. Mirrors
 * SessionList.handleLoad minus its per-list loading UI.
 */
import { ipc } from "../ipc/client";
import { useAppStore } from "../store/useAppStore";

export async function openSessionInStore(sessionId: string): Promise<boolean> {
  const res = await ipc.loadSession({ sessionId });
  if (!res.ok) return false;
  const next = useAppStore.getState();
  next.setActiveSession(sessionId);
  next.loadTranscript(res.data);
  const state = await ipc.getState();
  if (state.ok) {
    useAppStore.getState().setAgent(state.data);
    useAppStore.getState().setConnection(state.data.isStreaming ? "running" : "ready");
  }
  const list = await ipc.listSessions();
  if (list.ok) useAppStore.getState().applySessionPage(list.data);
  return true;
}
