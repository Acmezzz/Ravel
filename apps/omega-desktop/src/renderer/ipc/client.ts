/**
 * Thin wrapper around the narrow, validated `window.omega` preload bridge.
 * Every method returns the unified `IpcResult<T>` envelope. The renderer never
 * touches `ipcRenderer` directly — only this sanitized surface.
 */
import type {
  IpcResult,
  WorkspaceInfo,
  ProjectTrustChoice,
  ProjectTrustInfo,
  ExtensionStateBundle,
  SessionSummary,
  SessionListPage,
  SessionRecord,
  SessionMessage,
  WorkspaceDiff,
  ChangeApprovalResult,
  AgentStateSnapshot,
  ModelInfo,
  ThinkingLevel,
  SlashCommandInfo,
  AuthStatus,
  DesktopSettings,
  PromptImage,
  SessionTree,
  ForkCandidate,
  DirListing,
  FileReadResult,
  BashResultDTO,
  GitSnapshot,
  GitApplyResult,
  GitStageItem,
  GitWorktreeList,
  ResourceBundle,
  ExtensionUIRequest,
  ExtensionUIResponse,
} from "../types/dto";

export interface OmegaBridge {
  prompt(text: string, behavior?: "steer" | "followUp", images?: PromptImage[]): Promise<IpcResult<void>>;
  abort(): Promise<IpcResult<void>>;
  updateSettings(req: {
    steeringMode?: "all" | "one-at-a-time";
    followUpMode?: "all" | "one-at-a-time";
    autoCompaction?: boolean;
    autoRetry?: boolean;
  }): Promise<IpcResult<AgentStateSnapshot>>;
  clearQueue(): Promise<IpcResult<{ steering: string[]; followUp: string[] }>>;
  getSessionTree(): Promise<IpcResult<SessionTree>>;
  getForkCandidates(): Promise<IpcResult<ForkCandidate[]>>;
  fork(req: { entryId: string }): Promise<IpcResult<{ record: SessionRecord; selectedText: string }>>;
  clone(): Promise<IpcResult<{ record: SessionRecord }>>;
  navigateTree(req: { targetId: string }): Promise<IpcResult<SessionRecord>>;
  listDir(req: { path: string }): Promise<IpcResult<DirListing>>;
  readFile(req: { path: string }): Promise<IpcResult<FileReadResult>>;
  readFilePage(req: { path: string; offset?: number; limit?: number }): Promise<IpcResult<FileReadResult & { offset: number; nextOffset: number | null; totalLines: number }>>;
  fileIndex(req: { query: string }): Promise<IpcResult<string[]>>;
  revealInFolder(req: { path: string }): Promise<IpcResult<{ path: string }>>;
  bash(req: { command: string; excludeFromContext?: boolean }): Promise<IpcResult<BashResultDTO>>;
  gitSnapshot(): Promise<IpcResult<GitSnapshot>>;
  gitStage(req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>>;
  gitUnstage(req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>>;
  gitCommit(req: { message: string }): Promise<IpcResult<{ hash: string }>>;
  listWorktrees(): Promise<IpcResult<GitWorktreeList>>;
  addWorktree(req?: { path?: string; branch?: string; createBranch?: boolean }): Promise<IpcResult<GitWorktreeList>>;
  removeWorktree(req: { path: string; force?: boolean }): Promise<IpcResult<GitWorktreeList>>;
  getThinking(req: { entryId: string }): Promise<IpcResult<{ text: string | null }>>;
  getSystemPrompt(): Promise<IpcResult<{ systemPrompt: string }>>;
  exportHtml(): Promise<IpcResult<{ path: string }>>;
  listResources(): Promise<IpcResult<ResourceBundle>>;
  reloadResources(): Promise<IpcResult<ResourceBundle>>;
  installLocalResource(req?: { source?: string; project?: boolean }): Promise<IpcResult<ResourceBundle>>;
  removeLocalResource(req: { source: string; project?: boolean }): Promise<IpcResult<ResourceBundle>>;
  setResourceEnabled(req: {
    kind: "extension" | "skill" | "prompt";
    path: string;
    enabled: boolean;
    project?: boolean;
    baseDir?: string;
  }): Promise<IpcResult<ResourceBundle>>;
  setSkillModelInvocation(req: { filePath: string; disable: boolean }): Promise<IpcResult<ResourceBundle>>;
  setSkillCommandsEnabled(req: { enabled: boolean }): Promise<IpcResult<ResourceBundle>>;
  minimize(): Promise<IpcResult<void>>;
  toggleMaximize(): Promise<IpcResult<{ maximized: boolean }>>;
  closeWindow(): Promise<IpcResult<void>>;
  isMaximized(): Promise<IpcResult<{ maximized: boolean }>>;
  onWindowStateChanged(callback: (data: { maximized: boolean }) => void): () => void;
  onStatus(callback: (data: unknown) => void): () => void;
  onTransport(callback: (data: { state: string; error?: string; canRetry?: boolean; sessionId?: string; foreground?: boolean }) => void): () => void;
  onEvent(callback: (data: unknown) => void): () => void;
  onExtensionUiRequest(callback: (request: ExtensionUIRequest) => void): () => void;
  extensionUiResponse(response: ExtensionUIResponse): Promise<IpcResult<{ accepted: boolean }>>;
  extensionUiCancel(response: Omit<ExtensionUIResponse, "value" | "confirmed"> & { cancelled: true }): Promise<IpcResult<{ accepted: boolean }>>;
  listWorkspaces(): Promise<IpcResult<WorkspaceInfo[]>>;
  chooseWorkspace(): Promise<IpcResult<{ root: string; workspace?: WorkspaceInfo; workspaces: WorkspaceInfo[]; trust?: ProjectTrustInfo }>>;
  switchWorkspace(req: { workspace: string }): Promise<IpcResult<SessionRecord>>;
  removeWorkspace(req: { workspace: string }): Promise<IpcResult<WorkspaceInfo[]>>;
  inspectProjectTrust(req?: { workspace?: string }): Promise<IpcResult<ProjectTrustInfo>>;
  decideProjectTrust(req: { workspace: string; decision: ProjectTrustChoice }): Promise<IpcResult<{ trust: ProjectTrustInfo; reloaded?: boolean; sessionId?: string; workspaces: WorkspaceInfo[] }>>;
  retryWorker(): Promise<IpcResult<{ state: string; sessionId?: string; cwd?: string }>>;
  recentEvents(req: { sessionId?: string; after: number }): Promise<IpcResult<{ events: Array<{ event: unknown; meta: unknown }>; gap: boolean; first: number; last: number }>>;
  sessionRpc(req: { sessionId: string; method: string; args?: Record<string, unknown> }): Promise<IpcResult<unknown>>;
  sessionReady(): Promise<IpcResult<{ ready: boolean }>>;
  getState(): Promise<IpcResult<AgentStateSnapshot>>;
  listModels(): Promise<IpcResult<ModelInfo[]>>;
  setModel(req: { provider: string; modelId: string }): Promise<IpcResult<AgentStateSnapshot>>;
  setThinkingLevel(req: { level: ThinkingLevel }): Promise<IpcResult<AgentStateSnapshot>>;
  setSessionName(req: { name: string }): Promise<IpcResult<AgentStateSnapshot>>;
  listCommands(): Promise<IpcResult<SlashCommandInfo[]>>;
  compact(): Promise<IpcResult<AgentStateSnapshot>>;
  authStatus(): Promise<IpcResult<AuthStatus>>;
  getDesktopSettings(): Promise<IpcResult<DesktopSettings>>;
  updateDesktopSettings(req: Partial<DesktopSettings>): Promise<IpcResult<DesktopSettings>>;
  setPermissionProfile(req: { profile: DesktopSettings["permissionProfile"] }): Promise<IpcResult<DesktopSettings>>;
  setProviderApiKey(req: { providerId: string; apiKey: string }): Promise<IpcResult<AuthStatus>>;
  removeProviderApiKey(req: { providerId: string }): Promise<IpcResult<AuthStatus>>;
  listPiSessions(): Promise<IpcResult<SessionSummary[]>>;
  newPiSession(req: { title?: string; workspace?: string }): Promise<IpcResult<SessionRecord>>;
  switchPiSession(req: { sessionId: string }): Promise<IpcResult<SessionRecord>>;
  queryExtensionState(req: {
    scope?: "all" | "workflow" | "scout";
    projectKey?: string;
    taskId?: string;
  }): Promise<IpcResult<ExtensionStateBundle>>;
  listSessions(req?: { offset?: number; limit?: number }): Promise<IpcResult<SessionListPage>>;
  readSessionMessages(req: { sessionId: string; offset?: number; limit?: number }): Promise<IpcResult<{ items: SessionMessage[]; total: number; nextOffset: number | null }>>;
  newSession(req: {
    projectKey?: string;
    title?: string;
    workspace?: string;
  }): Promise<IpcResult<SessionRecord>>;
  loadSession(req: { sessionId: string }): Promise<IpcResult<SessionRecord>>;
  saveSession(req: {
    sessionId: string;
    transcript: SessionRecord;
  }): Promise<IpcResult<void>>;
  deleteSession(req: { sessionId: string }): Promise<IpcResult<void>>;
  diffWorkspace(req: { taskId?: string }): Promise<IpcResult<WorkspaceDiff>>;
  approveChange(req: {
    action: "accept" | "reject";
    snapshotToken?: string;
    files?: string[];
  }): Promise<IpcResult<ChangeApprovalResult>>;
}

declare global {
  interface Window {
    omega: OmegaBridge;
  }
}

function ok<T>(value: IpcResult<T> | undefined): IpcResult<T> {
  if (value && typeof value === "object" && "ok" in value) return value;
  return { ok: false, code: "bridge_error", message: "No response from host" };
}

export const ipc = {
  prompt: async (text: string, behavior?: "steer" | "followUp", images?: PromptImage[]): Promise<IpcResult<void>> =>
    ok(await window.omega?.prompt?.(text, behavior, images)),
  abort: async (): Promise<IpcResult<void>> => ok(await window.omega?.abort?.()),
  updateSettings: async (req: {
    steeringMode?: "all" | "one-at-a-time";
    followUpMode?: "all" | "one-at-a-time";
    autoCompaction?: boolean;
    autoRetry?: boolean;
  }): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.updateSettings?.(req)),
  clearQueue: async (): Promise<IpcResult<{ steering: string[]; followUp: string[] }>> =>
    ok(await window.omega?.clearQueue?.()),
  getSessionTree: async (): Promise<IpcResult<SessionTree>> => ok(await window.omega?.getSessionTree?.()),
  getForkCandidates: async (): Promise<IpcResult<ForkCandidate[]>> => ok(await window.omega?.getForkCandidates?.()),
  fork: async (req: { entryId: string }): Promise<IpcResult<{ record: SessionRecord; selectedText: string }>> =>
    ok(await window.omega?.fork?.(req)),
  clone: async (): Promise<IpcResult<{ record: SessionRecord }>> => ok(await window.omega?.clone?.()),
  navigateTree: async (req: { targetId: string }): Promise<IpcResult<SessionRecord>> =>
    ok(await window.omega?.navigateTree?.(req)),
  listDir: async (req: { path: string }): Promise<IpcResult<DirListing>> => ok(await window.omega?.listDir?.(req)),
  readFile: async (req: { path: string }): Promise<IpcResult<FileReadResult>> => ok(await window.omega?.readFile?.(req)),
  readFilePage: async (req: { path: string; offset?: number; limit?: number }): Promise<IpcResult<FileReadResult & { offset: number; nextOffset: number | null; totalLines: number }>> => ok(await window.omega?.readFilePage?.(req)),
  fileIndex: async (req: { query: string }): Promise<IpcResult<string[]>> => ok(await window.omega?.fileIndex?.(req)),
  revealInFolder: async (req: { path: string }): Promise<IpcResult<{ path: string }>> =>
    ok(await window.omega?.revealInFolder?.(req)),
  bash: async (req: { command: string; excludeFromContext?: boolean }): Promise<IpcResult<BashResultDTO>> =>
    ok(await window.omega?.bash?.(req)),
  gitSnapshot: async (): Promise<IpcResult<GitSnapshot>> => ok(await window.omega?.gitSnapshot?.()),
  gitStage: async (req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>> => ok(await window.omega?.gitStage?.(req)),
  gitUnstage: async (req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>> => ok(await window.omega?.gitUnstage?.(req)),
  gitCommit: async (req: { message: string }): Promise<IpcResult<{ hash: string }>> => ok(await window.omega?.gitCommit?.(req)),
  listWorktrees: async (): Promise<IpcResult<GitWorktreeList>> => ok(await window.omega?.listWorktrees?.()),
  addWorktree: async (req?: { path?: string; branch?: string; createBranch?: boolean }): Promise<IpcResult<GitWorktreeList>> =>
    ok(await window.omega?.addWorktree?.(req)),
  removeWorktree: async (req: { path: string; force?: boolean }): Promise<IpcResult<GitWorktreeList>> =>
    ok(await window.omega?.removeWorktree?.(req)),
  getThinking: async (req: { entryId: string }): Promise<IpcResult<{ text: string | null }>> =>
    ok(await window.omega?.getThinking?.(req)),
  getSystemPrompt: async (): Promise<IpcResult<{ systemPrompt: string }>> => ok(await window.omega?.getSystemPrompt?.()),
  exportHtml: async (): Promise<IpcResult<{ path: string }>> => ok(await window.omega?.exportHtml?.()),
  listResources: async (): Promise<IpcResult<ResourceBundle>> => ok(await window.omega?.listResources?.()),
  reloadResources: async (): Promise<IpcResult<ResourceBundle>> => ok(await window.omega?.reloadResources?.()),
  installLocalResource: async (req?: { source?: string; project?: boolean }): Promise<IpcResult<ResourceBundle>> =>
    ok(await window.omega?.installLocalResource?.(req)),
  removeLocalResource: async (req: { source: string; project?: boolean }): Promise<IpcResult<ResourceBundle>> =>
    ok(await window.omega?.removeLocalResource?.(req)),
  setResourceEnabled: async (req: {
    kind: "extension" | "skill" | "prompt";
    path: string;
    enabled: boolean;
    project?: boolean;
    baseDir?: string;
  }): Promise<IpcResult<ResourceBundle>> => ok(await window.omega?.setResourceEnabled?.(req)),
  setSkillModelInvocation: async (req: { filePath: string; disable: boolean }): Promise<IpcResult<ResourceBundle>> =>
    ok(await window.omega?.setSkillModelInvocation?.(req)),
  setSkillCommandsEnabled: async (req: { enabled: boolean }): Promise<IpcResult<ResourceBundle>> =>
    ok(await window.omega?.setSkillCommandsEnabled?.(req)),
  minimize: async (): Promise<IpcResult<void>> => ok(await window.omega?.minimize?.()),
  toggleMaximize: async (): Promise<IpcResult<{ maximized: boolean }>> => ok(await window.omega?.toggleMaximize?.()),
  closeWindow: async (): Promise<IpcResult<void>> => ok(await window.omega?.closeWindow?.()),
  isMaximized: async (): Promise<IpcResult<{ maximized: boolean }>> => ok(await window.omega?.isMaximized?.()),
  onWindowStateChanged: (callback: (data: { maximized: boolean }) => void): (() => void) =>
    window.omega?.onWindowStateChanged?.(callback) ?? (() => {}),
  onExtensionUiRequest: (callback: (request: ExtensionUIRequest) => void): (() => void) =>
    window.omega?.onExtensionUiRequest?.(callback) ?? (() => {}),
  extensionUiResponse: async (response: ExtensionUIResponse): Promise<IpcResult<{ accepted: boolean }>> =>
    ok(await window.omega?.extensionUiResponse?.(response)),
  extensionUiCancel: async (response: Omit<ExtensionUIResponse, "value" | "confirmed"> & { cancelled: true }): Promise<IpcResult<{ accepted: boolean }>> =>
    ok(await window.omega?.extensionUiCancel?.(response)),
  listWorkspaces: async (): Promise<IpcResult<WorkspaceInfo[]>> => ok(await window.omega?.listWorkspaces?.()),
  chooseWorkspace: async (): Promise<IpcResult<{ root: string; workspace?: WorkspaceInfo; workspaces: WorkspaceInfo[]; trust?: ProjectTrustInfo }>> => ok(await window.omega?.chooseWorkspace?.()),
  switchWorkspace: async (req: { workspace: string }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.switchWorkspace?.(req)),
  removeWorkspace: async (req: { workspace: string }): Promise<IpcResult<WorkspaceInfo[]>> => ok(await window.omega?.removeWorkspace?.(req)),
  inspectProjectTrust: async (req?: { workspace?: string }): Promise<IpcResult<ProjectTrustInfo>> => ok(await window.omega?.inspectProjectTrust?.(req)),
  decideProjectTrust: async (req: { workspace: string; decision: ProjectTrustChoice }): Promise<IpcResult<{ trust: ProjectTrustInfo; reloaded?: boolean; sessionId?: string; workspaces: WorkspaceInfo[] }>> => ok(await window.omega?.decideProjectTrust?.(req)),
  retryWorker: async (): Promise<IpcResult<{ state: string; sessionId?: string; cwd?: string }>> => ok(await window.omega?.retryWorker?.()),
  recentEvents: async (req: { sessionId?: string; after: number }): Promise<IpcResult<{ events: Array<{ event: unknown; meta: unknown }>; gap: boolean; first: number; last: number }>> => ok(await window.omega?.recentEvents?.(req)),
  sessionRpc: async (req: { sessionId: string; method: string; args?: Record<string, unknown> }): Promise<IpcResult<unknown>> => ok(await window.omega?.sessionRpc?.(req)),
  sessionReady: async (): Promise<IpcResult<{ ready: boolean }>> =>
    ok(await window.omega?.sessionReady?.()),
  getState: async (): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.getState?.()),
  listModels: async (): Promise<IpcResult<ModelInfo[]>> => ok(await window.omega?.listModels?.()),
  setModel: async (req: { provider: string; modelId: string }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setModel?.(req)),
  setThinkingLevel: async (req: { level: ThinkingLevel }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setThinkingLevel?.(req)),
  setSessionName: async (req: { name: string }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setSessionName?.(req)),
  listCommands: async (): Promise<IpcResult<SlashCommandInfo[]>> => ok(await window.omega?.listCommands?.()),
  compact: async (): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.compact?.()),
  authStatus: async (): Promise<IpcResult<AuthStatus>> => ok(await window.omega?.authStatus?.()),
  getDesktopSettings: async (): Promise<IpcResult<DesktopSettings>> => ok(await window.omega?.getDesktopSettings?.()),
  updateDesktopSettings: async (req: Partial<DesktopSettings>): Promise<IpcResult<DesktopSettings>> =>
    ok(await window.omega?.updateDesktopSettings?.(req)),
  setPermissionProfile: async (req: { profile: DesktopSettings["permissionProfile"] }): Promise<IpcResult<DesktopSettings>> =>
    ok(await window.omega?.setPermissionProfile?.(req)),
  setProviderApiKey: async (req: { providerId: string; apiKey: string }): Promise<IpcResult<AuthStatus>> =>
    ok(await window.omega?.setProviderApiKey?.(req)),
  removeProviderApiKey: async (req: { providerId: string }): Promise<IpcResult<AuthStatus>> =>
    ok(await window.omega?.removeProviderApiKey?.(req)),
  listPiSessions: async (): Promise<IpcResult<SessionSummary[]>> => ok(await window.omega?.listPiSessions?.()),
  newPiSession: async (req: { title?: string; workspace?: string }): Promise<IpcResult<SessionRecord>> =>
    ok(await window.omega?.newPiSession?.(req)),
  switchPiSession: async (req: { sessionId: string }): Promise<IpcResult<SessionRecord>> =>
    ok(await window.omega?.switchPiSession?.(req)),
  queryExtensionState: async (req: {
    scope?: "all" | "workflow" | "scout";
    projectKey?: string;
    taskId?: string;
  }): Promise<IpcResult<ExtensionStateBundle>> => ok(await window.omega?.queryExtensionState?.(req)),
  listSessions: async (req?: { offset?: number; limit?: number }): Promise<IpcResult<SessionListPage>> =>
    ok(await window.omega?.listSessions?.(req)),
  readSessionMessages: async (req: { sessionId: string; offset?: number; limit?: number }): Promise<IpcResult<{ items: SessionMessage[]; total: number; nextOffset: number | null }>> =>
    ok(await window.omega?.readSessionMessages?.(req)),
  newSession: async (req: {
    projectKey?: string;
    title?: string;
    workspace?: string;
  }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.newSession?.(req)),
  loadSession: async (req: { sessionId: string }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.loadSession?.(req)),
  saveSession: async (req: {
    sessionId: string;
    transcript: SessionRecord;
  }): Promise<IpcResult<void>> => ok(await window.omega?.saveSession?.(req)),
  deleteSession: async (req: { sessionId: string }): Promise<IpcResult<void>> => ok(await window.omega?.deleteSession?.(req)),
  diffWorkspace: async (req: { taskId?: string }): Promise<IpcResult<WorkspaceDiff>> => ok(await window.omega?.diffWorkspace?.(req)),
  approveChange: async (req: {
    action: "accept" | "reject";
    snapshotToken?: string;
    files?: string[];
  }): Promise<IpcResult<ChangeApprovalResult>> => ok(await window.omega?.approveChange?.(req)),
};

/** Convenience helper that throws on `!ok` so callers can use try/catch. */
export async function unwrap<T>(result: IpcResult<T>): Promise<T> {
  if (result.ok) return result.data;
  throw new Error(`${result.code}: ${result.message}`);
}
