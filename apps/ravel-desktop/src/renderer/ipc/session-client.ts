import type {
  IpcResult,
  SessionTree,
  SessionRecord,
  SessionListPage,
  ActivitySnapshotPage,
  SessionMessage,
  AgentStateSnapshot,
} from "../types/dto";
import { ok } from "./utils";

/** Session tree, transcript, CRUD, and export surfaces. */
export const sessionClient = {
  getSessionTree: async (): Promise<IpcResult<SessionTree>> => ok(await window.omega?.getSessionTree?.()),
  fork: async (req: { entryId: string }): Promise<IpcResult<{ record: SessionRecord; selectedText: string }>> =>
    ok(await window.omega?.fork?.(req)),
  clone: async (): Promise<IpcResult<{ record: SessionRecord }>> => ok(await window.omega?.clone?.()),
  navigateTree: async (req: { targetId: string }): Promise<IpcResult<SessionRecord>> =>
    ok(await window.omega?.navigateTree?.(req)),
  setSessionName: async (req: { name: string; sessionId?: string }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setSessionName?.(req)),
  listSessions: async (req?: { offset?: number; limit?: number }): Promise<IpcResult<SessionListPage>> =>
    ok(await window.omega?.listSessions?.(req)),
  activitySnapshot: async (): Promise<IpcResult<ActivitySnapshotPage>> => ok(await window.omega?.activitySnapshot?.()),
  onActivityChanged: (callback: (data: unknown) => void): (() => void) =>
    window.omega?.onActivityChanged?.(callback) ?? (() => {}),
  readSessionMessages: async (req: { sessionId: string; offset?: number; limit?: number }): Promise<IpcResult<{ items: SessionMessage[]; total: number; nextOffset: number | null }>> =>
    ok(await window.omega?.readSessionMessages?.(req)),
  newSession: async (req: {
    projectKey?: string;
    title?: string;
    workspace?: string;
  }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.newSession?.(req)),
  loadSession: async (req: { sessionId: string }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.loadSession?.(req)),
  deleteSession: async (req: { sessionId: string }): Promise<IpcResult<void>> => ok(await window.omega?.deleteSession?.(req)),
  exportHtml: async (): Promise<IpcResult<{ path: string }>> => ok(await window.omega?.exportHtml?.()),
};

export type SessionClient = typeof sessionClient;