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
  SessionListPage,
  ActivitySnapshotPage,
  McpBundle,
  SessionRecord,
  SessionMessage,
  ChangeApprovalResult,
  AgentStateSnapshot,
  ModelInfo,
  ThinkingLevel,
  SlashCommandInfo,
  AuthStatus,
  DesktopSettings,
  PlanReviewResult,
  PermissionRuleRow,
  PromptImage,
  PtyDataDTO,
  PtyExitDTO,
  SessionTree,
  DirListing,
  FileReadResult,
  UploadConflictMode,
  UploadTargetInfo,
  BashResultDTO,
  GitSnapshot,
  GitApplyResult,
  GitStageItem,
  GitWorktreeList,
  ResourceBundle,
  ExtensionUIRequest,
  ExtensionUIResponse,
  TelemetrySnapshot,
  SearchResultBundle,
  CheckpointInfo,
  HistosGetGraphRequest,
  HistosQueryDTO,
  HistosCondenseGraphRequest,
  HistosCondenseGraphResultDTO,
  HistosExecuteFlowRequest,
  HistosExecuteFlowResultDTO,
  HistosRebuildRequest,
  HistosGetNodeRequest,
  HistosFreezeContextRequest,
  HistosConvertToFlowRequest,
  HistosGetArtifactRequest,
  HistosGraphDTO,
  HistosRebuildResultDTO,
  HistosNodeRevisionDTO,
  HistosContextFreezeResultDTO,
  HistosConvertToFlowResultDTO,
  HistosArtifactDTO,
} from "../types/dto";

/** A structured @session mention resolved by the composer mention menu. */
export interface PromptSessionReference {
  targetSessionId: string;
  targetTitle: string;
}

export interface RavelBridge {
  /** A structured @session mention resolved by the composer menu. */
  prompt(text: string, behavior?: "steer" | "followUp", images?: PromptImage[], clientMessageId?: string, references?: PromptSessionReference[]): Promise<IpcResult<void>>;
  abort(): Promise<IpcResult<void>>;
  ptyCreate(req: { sessionId: string; cwd: string; cols?: number; rows?: number }): Promise<IpcResult<{ sessionId: string }>>;
  ptyWrite(req: { sessionId: string; data: string }): Promise<IpcResult<void>>;
  ptyResize(req: { sessionId: string; cols: number; rows: number }): Promise<IpcResult<void>>;
  ptyKill(req: { sessionId: string }): Promise<IpcResult<void>>;
  onPtyData(callback: (data: PtyDataDTO) => void): () => void;
  onPtyExit(callback: (data: PtyExitDTO) => void): () => void;
  updateSettings(req: {
    steeringMode?: "all" | "one-at-a-time";
    followUpMode?: "all" | "one-at-a-time";
    autoCompaction?: boolean;
    autoRetry?: boolean;
  }): Promise<IpcResult<AgentStateSnapshot>>;
  clearQueue(): Promise<IpcResult<{ steering: string[]; followUp: string[] }>>;
  getSessionTree(): Promise<IpcResult<SessionTree>>;
  fork(req: { entryId: string }): Promise<IpcResult<{ record: SessionRecord; selectedText: string }>>;
  clone(): Promise<IpcResult<{ record: SessionRecord }>>;
  navigateTree(req: { targetId: string }): Promise<IpcResult<SessionRecord>>;
  listDir(req: { path: string }): Promise<IpcResult<DirListing>>;
  readFile(req: { path: string }): Promise<IpcResult<FileReadResult>>;
  readFilePage(req: { path: string; offset?: number; limit?: number }): Promise<IpcResult<FileReadResult & { offset: number; nextOffset: number | null; totalLines: number }>>;
  fileIndex(req: { query: string }): Promise<IpcResult<string[]>>;
  revealInFolder(req: { path: string }): Promise<IpcResult<{ path: string }>>;
  openFileDefault(req: { path: string }): Promise<IpcResult<{ path: string }>>;
  chooseFileForWorkspace(): Promise<IpcResult<{ selectionId: string; name: string }>>;
  uploadFile(req: { selectionId: string; path: string; conflict?: UploadConflictMode; expectedToken?: string }): Promise<IpcResult<{ conflict: boolean; path?: string; target?: UploadTargetInfo; size?: number; hash?: string }>>;
  watchFile(req: { path: string }): Promise<IpcResult<{ path: string; watching: boolean }>>;
  unwatchFile(req: { path: string }): Promise<IpcResult<{ path: string; watching: boolean }>>;
  bash(req: { command: string; excludeFromContext?: boolean }): Promise<IpcResult<BashResultDTO>>;
  gitSnapshot(): Promise<IpcResult<GitSnapshot>>;
  gitStage(req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>>;
  gitUnstage(req: { snapshotToken: string; items: GitStageItem[] }): Promise<IpcResult<GitApplyResult>>;
  gitCommit(req: { message: string }): Promise<IpcResult<{ hash: string }>>;
  listWorktrees(): Promise<IpcResult<GitWorktreeList>>;
  addWorktree(req?: { path?: string; branch?: string; createBranch?: boolean }): Promise<IpcResult<GitWorktreeList>>;
  removeWorktree(req: { path: string; force?: boolean }): Promise<IpcResult<GitWorktreeList>>;
  getThinking(req: { entryId: string }): Promise<IpcResult<{ text: string | null }>>;
  getToolDetail(req: { toolCallId: string }): Promise<IpcResult<{ toolCallId: string; toolName?: string; argsJson?: string; resultText?: string; isError?: boolean }>>;
  telemetry(): Promise<IpcResult<TelemetrySnapshot>>;
  projectSearch(req: { query: string }): Promise<IpcResult<SearchResultBundle>>;
  checkpointList(): Promise<IpcResult<CheckpointInfo[]>>;
  checkpointCreate(req?: { label?: string }): Promise<IpcResult<CheckpointInfo>>;
  checkpointRestore(req: { id: string }): Promise<IpcResult<{ restored: string; safety: string }>>;
  getSystemPrompt(): Promise<IpcResult<{ systemPrompt: string }>>;
  exportHtml(): Promise<IpcResult<{ path: string }>>;
  listResources(): Promise<IpcResult<ResourceBundle>>;
  reloadResources(): Promise<IpcResult<ResourceBundle>>;
  stageRemoteResource(req: { url: string }): Promise<IpcResult<{ path: string; sha256: string; bytes: number; filename: string }>>;
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
  onFileChanged(callback: (data: { path: string }) => void): () => void;
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
  recentEvents(req: { sessionId?: string; after: number; runtimeEpoch?: number }): Promise<IpcResult<{ events: Array<{ event: unknown; meta: unknown }>; gap: boolean; first: number; last: number; nextAfter?: number | null; runtimeEpoch?: number }>>;
  sessionReady(): Promise<IpcResult<{ ready: boolean }>>;
  getState(): Promise<IpcResult<AgentStateSnapshot>>;
  listModels(): Promise<IpcResult<ModelInfo[]>>;
  setModel(req: { provider: string; modelId: string }): Promise<IpcResult<AgentStateSnapshot>>;
  setThinkingLevel(req: { level: ThinkingLevel }): Promise<IpcResult<AgentStateSnapshot>>;
  setSessionName(req: { name: string; sessionId?: string }): Promise<IpcResult<AgentStateSnapshot>>;
  listCommands(): Promise<IpcResult<SlashCommandInfo[]>>;
  compact(): Promise<IpcResult<AgentStateSnapshot>>;
  authStatus(): Promise<IpcResult<AuthStatus>>;
  getDesktopSettings(): Promise<IpcResult<DesktopSettings>>;
  updateDesktopSettings(req: Partial<DesktopSettings>): Promise<IpcResult<DesktopSettings>>;
  configureCustomProvider(req: Record<string, unknown>): Promise<IpcResult<{ provider: Record<string, unknown>; models: ModelInfo[] }>>;
  setPermissionProfile(req: { profile: DesktopSettings["permissionProfile"] }): Promise<IpcResult<DesktopSettings>>;
  setModeProfile(req: { mode: DesktopSettings["modeProfile"] }): Promise<IpcResult<{ modeProfile: DesktopSettings["modeProfile"] }>>;
  planReview(): Promise<IpcResult<PlanReviewResult>>;
  approvePlan(): Promise<IpcResult<{ mode: string }>>;
  permissionRulesList(): Promise<IpcResult<{ items: PermissionRuleRow[] }>>;
  permissionRulesAdd(req: { permission: string; pattern: string; action: "allow" | "ask" | "deny"; project?: boolean }): Promise<IpcResult<{ items: PermissionRuleRow[] }>>;
  permissionRulesRemove(req: { id: string; scope: "user" | "project" }): Promise<IpcResult<{ items: PermissionRuleRow[] }>>;
  histosGetGraph(req: HistosGetGraphRequest): Promise<IpcResult<HistosGraphDTO>>;
  histosCondenseGraph(req: HistosCondenseGraphRequest): Promise<IpcResult<HistosCondenseGraphResultDTO>>;
  histosSaveViewState(req: HistosQueryDTO & { positions: Array<{ id: string; x: number; y: number }> }): Promise<IpcResult<{ sha256: string; artifact: HistosArtifactDTO }>>;
  histosGetViewState(req: HistosQueryDTO): Promise<IpcResult<HistosArtifactDTO | null>>;
  histosExecuteFlow(req: HistosExecuteFlowRequest): Promise<IpcResult<HistosExecuteFlowResultDTO>>;
  histosRebuild(req: HistosRebuildRequest): Promise<IpcResult<HistosRebuildResultDTO>>;
  histosGetNode(req: HistosGetNodeRequest): Promise<IpcResult<HistosNodeRevisionDTO | null>>;
  histosFreezeContext(req: HistosFreezeContextRequest): Promise<IpcResult<HistosContextFreezeResultDTO>>;
  histosConvertToFlow(req: HistosConvertToFlowRequest): Promise<IpcResult<HistosConvertToFlowResultDTO>>;
  histosGetArtifact(req: HistosGetArtifactRequest): Promise<IpcResult<HistosArtifactDTO>>;
  histosDistillResource(req: { kind: "skill" | "extension" | "prompt"; name: string; filePath: string }): Promise<IpcResult<{ graphSha256: string; contextSha256: string | null; node: { nodeId: string; nodeRevisionId: string; title: string } }>>;
  histosImportContext(req: { sourceWorkspaceId: string; sourceSha256: string; budget?: number }): Promise<IpcResult<{ sha256: string; sourceSha256: string; factAppend: { ok: boolean; error?: string } }>>;
  histosSuggestContext(req: { query?: string; terms?: string[]; limit?: number }): Promise<IpcResult<{ terms: string[]; candidates: Array<{ nodeRevisionId: string; nodeId: string; kind: string; title: string | null; artifactSha: string | null; lens: string | null; createdAt: number; evidenceCount: number; matchedTerms: string[]; score: number }> }>>;
  setProviderApiKey(req: { providerId: string; apiKey: string }): Promise<IpcResult<AuthStatus>>;
  removeProviderApiKey(req: { providerId: string }): Promise<IpcResult<AuthStatus>>;
  listSessions(req?: { offset?: number; limit?: number }): Promise<IpcResult<SessionListPage>>;
  activitySnapshot(): Promise<IpcResult<ActivitySnapshotPage>>;
  onActivityChanged(callback: (data: unknown) => void): () => void;
  mcpList(): Promise<IpcResult<McpBundle>>;
  mcpAdd(req: { name: string; command: string; args?: string[]; project?: boolean }): Promise<IpcResult<McpBundle>>;
  mcpSetEnabled(req: { name: string; enabled: boolean; project?: boolean }): Promise<IpcResult<McpBundle>>;
  mcpRemove(req: { name: string; project?: boolean }): Promise<IpcResult<McpBundle>>;
  readSessionMessages(req: { sessionId: string; offset?: number; limit?: number }): Promise<IpcResult<{ items: SessionMessage[]; total: number; nextOffset: number | null }>>;
  newSession(req: {
    projectKey?: string;
    title?: string;
    workspace?: string;
  }): Promise<IpcResult<SessionRecord>>;
  loadSession(req: { sessionId: string }): Promise<IpcResult<SessionRecord>>;
  deleteSession(req: { sessionId: string }): Promise<IpcResult<void>>;
  approveChange(req: {
    action: "accept" | "reject";
    snapshotToken?: string;
    files?: string[];
    items?: GitStageItem[];
  }): Promise<IpcResult<ChangeApprovalResult>>;
}

declare global {
  interface Window {
    omega: RavelBridge;
  }
}

function ok<T>(value: IpcResult<T> | undefined): IpcResult<T> {
  if (value && typeof value === "object" && "ok" in value) return value;
  return { ok: false, code: "bridge_error", message: "No response from host" };
}

export const ipc = {
  prompt: async (text: string, behavior?: "steer" | "followUp", images?: PromptImage[], clientMessageId?: string, references?: PromptSessionReference[]): Promise<IpcResult<void>> =>
    ok(await window.omega?.prompt?.(text, behavior, images, clientMessageId, references)),
  abort: async (): Promise<IpcResult<void>> => ok(await window.omega?.abort?.()),
  ptyCreate: async (req: { sessionId: string; cwd: string; cols?: number; rows?: number }): Promise<IpcResult<{ sessionId: string }>> => ok(await window.omega?.ptyCreate?.(req)),
  ptyWrite: async (req: { sessionId: string; data: string }): Promise<IpcResult<void>> => ok(await window.omega?.ptyWrite?.(req)),
  ptyResize: async (req: { sessionId: string; cols: number; rows: number }): Promise<IpcResult<void>> => ok(await window.omega?.ptyResize?.(req)),
  ptyKill: async (req: { sessionId: string }): Promise<IpcResult<void>> => ok(await window.omega?.ptyKill?.(req)),
  onPtyData: (callback: (data: PtyDataDTO) => void): (() => void) => window.omega?.onPtyData?.(callback) ?? (() => {}),
  onPtyExit: (callback: (data: PtyExitDTO) => void): (() => void) => window.omega?.onPtyExit?.(callback) ?? (() => {}),
  updateSettings: async (req: {
    steeringMode?: "all" | "one-at-a-time";
    followUpMode?: "all" | "one-at-a-time";
    autoCompaction?: boolean;
    autoRetry?: boolean;
  }): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.updateSettings?.(req)),
  clearQueue: async (): Promise<IpcResult<{ steering: string[]; followUp: string[] }>> =>
    ok(await window.omega?.clearQueue?.()),
  getSessionTree: async (): Promise<IpcResult<SessionTree>> => ok(await window.omega?.getSessionTree?.()),
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
  openFileDefault: async (req: { path: string }): Promise<IpcResult<{ path: string }>> => ok(await window.omega?.openFileDefault?.(req)),
  chooseFileForWorkspace: async (): Promise<IpcResult<{ selectionId: string; name: string }>> => ok(await window.omega?.chooseFileForWorkspace?.()),
  uploadFile: async (req: { selectionId: string; path: string; conflict?: UploadConflictMode; expectedToken?: string }): Promise<IpcResult<{ conflict: boolean; path?: string; target?: UploadTargetInfo; size?: number; hash?: string }>> => ok(await window.omega?.uploadFile?.(req)),
  watchFile: async (req: { path: string }): Promise<IpcResult<{ path: string; watching: boolean }>> => ok(await window.omega?.watchFile?.(req)),
  unwatchFile: async (req: { path: string }): Promise<IpcResult<{ path: string; watching: boolean }>> => ok(await window.omega?.unwatchFile?.(req)),
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
  getToolDetail: async (req: { toolCallId: string }): Promise<IpcResult<{ toolCallId: string; toolName?: string; argsJson?: string; resultText?: string; isError?: boolean }>> => ok(await window.omega?.getToolDetail?.(req)),
  telemetry: async (): Promise<IpcResult<TelemetrySnapshot>> => ok(await window.omega?.telemetry?.()),
  projectSearch: async (req: { query: string }): Promise<IpcResult<SearchResultBundle>> => ok(await window.omega?.projectSearch?.(req)),
  checkpointList: async (): Promise<IpcResult<CheckpointInfo[]>> => ok(await window.omega?.checkpointList?.()),
  checkpointCreate: async (req?: { label?: string }): Promise<IpcResult<CheckpointInfo>> => ok(await window.omega?.checkpointCreate?.(req)),
  checkpointRestore: async (req: { id: string }): Promise<IpcResult<{ restored: string; safety: string }>> => ok(await window.omega?.checkpointRestore?.(req)),
  getSystemPrompt: async (): Promise<IpcResult<{ systemPrompt: string }>> => ok(await window.omega?.getSystemPrompt?.()),
  exportHtml: async (): Promise<IpcResult<{ path: string }>> => ok(await window.omega?.exportHtml?.()),
  listResources: async (): Promise<IpcResult<ResourceBundle>> => ok(await window.omega?.listResources?.()),
  reloadResources: async (): Promise<IpcResult<ResourceBundle>> => ok(await window.omega?.reloadResources?.()),
  stageRemoteResource: async (req: { url: string }): Promise<IpcResult<{ path: string; sha256: string; bytes: number; filename: string }>> =>
    ok(await window.omega?.stageRemoteResource?.(req)),
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
  onFileChanged: (callback: (data: { path: string }) => void): (() => void) =>
    window.omega?.onFileChanged?.(callback) ?? (() => {}),
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
  recentEvents: async (req: { sessionId?: string; after: number; runtimeEpoch?: number }): Promise<IpcResult<{ events: Array<{ event: unknown; meta: unknown }>; gap: boolean; first: number; last: number; nextAfter?: number | null; runtimeEpoch?: number }>> => ok(await window.omega?.recentEvents?.(req)),
  sessionReady: async (): Promise<IpcResult<{ ready: boolean }>> =>
    ok(await window.omega?.sessionReady?.()),
  getState: async (): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.getState?.()),
  listModels: async (): Promise<IpcResult<ModelInfo[]>> => ok(await window.omega?.listModels?.()),
  setModel: async (req: { provider: string; modelId: string }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setModel?.(req)),
  setThinkingLevel: async (req: { level: ThinkingLevel }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setThinkingLevel?.(req)),
  setSessionName: async (req: { name: string; sessionId?: string }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setSessionName?.(req)),
  listCommands: async (): Promise<IpcResult<SlashCommandInfo[]>> => ok(await window.omega?.listCommands?.()),
  compact: async (): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.compact?.()),
  authStatus: async (): Promise<IpcResult<AuthStatus>> => ok(await window.omega?.authStatus?.()),
  getDesktopSettings: async (): Promise<IpcResult<DesktopSettings>> => ok(await window.omega?.getDesktopSettings?.()),
  updateDesktopSettings: async (req: Partial<DesktopSettings>): Promise<IpcResult<DesktopSettings>> =>
    ok(await window.omega?.updateDesktopSettings?.(req)),
  configureCustomProvider: async (req: Record<string, unknown>): Promise<IpcResult<{ provider: Record<string, unknown>; models: ModelInfo[] }>> => ok(await window.omega?.configureCustomProvider?.(req)),
  setPermissionProfile: async (req: { profile: DesktopSettings["permissionProfile"] }): Promise<IpcResult<DesktopSettings>> =>
    ok(await window.omega?.setPermissionProfile?.(req)),
  setModeProfile: async (req: { mode: DesktopSettings["modeProfile"] }): Promise<IpcResult<{ modeProfile: DesktopSettings["modeProfile"] }>> =>
    ok(await window.omega?.setModeProfile?.(req)),
  planReview: async (): Promise<IpcResult<PlanReviewResult>> => ok(await window.omega?.planReview?.()),
  approvePlan: async (): Promise<IpcResult<{ mode: string }>> => ok(await window.omega?.approvePlan?.()),
  permissionRulesList: async (): Promise<IpcResult<{ items: PermissionRuleRow[] }>> => ok(await window.omega?.permissionRulesList?.()),
  permissionRulesAdd: async (req: { permission: string; pattern: string; action: "allow" | "ask" | "deny"; project?: boolean }): Promise<IpcResult<{ items: PermissionRuleRow[] }>> =>
    ok(await window.omega?.permissionRulesAdd?.(req)),
  permissionRulesRemove: async (req: { id: string; scope: "user" | "project" }): Promise<IpcResult<{ items: PermissionRuleRow[] }>> =>
    ok(await window.omega?.permissionRulesRemove?.(req)),
  histosGetGraph: async (req: HistosGetGraphRequest): Promise<IpcResult<HistosGraphDTO>> =>
    ok(await window.omega?.histosGetGraph?.(req)),
  histosCondenseGraph: async (req: HistosCondenseGraphRequest): Promise<IpcResult<HistosCondenseGraphResultDTO>> =>
    ok(await window.omega?.histosCondenseGraph?.(req)),
  histosSaveViewState: async (req: HistosQueryDTO & { positions: Array<{ id: string; x: number; y: number }> }): Promise<IpcResult<{ sha256: string; artifact: HistosArtifactDTO }>> =>
    ok(await window.omega?.histosSaveViewState?.(req)),
  histosGetViewState: async (req: HistosQueryDTO): Promise<IpcResult<HistosArtifactDTO | null>> =>
    ok(await window.omega?.histosGetViewState?.(req)),
  histosExecuteFlow: async (req: HistosExecuteFlowRequest): Promise<IpcResult<HistosExecuteFlowResultDTO>> =>
    ok(await window.omega?.histosExecuteFlow?.(req)),
  histosRebuild: async (req: HistosRebuildRequest): Promise<IpcResult<HistosRebuildResultDTO>> =>
    ok(await window.omega?.histosRebuild?.(req)),
  histosGetNode: async (req: HistosGetNodeRequest): Promise<IpcResult<HistosNodeRevisionDTO | null>> =>
    ok(await window.omega?.histosGetNode?.(req)),
  histosFreezeContext: async (req: HistosFreezeContextRequest): Promise<IpcResult<HistosContextFreezeResultDTO>> =>
    ok(await window.omega?.histosFreezeContext?.(req)),
  histosConvertToFlow: async (req: HistosConvertToFlowRequest): Promise<IpcResult<HistosConvertToFlowResultDTO>> =>
    ok(await window.omega?.histosConvertToFlow?.(req)),
  histosDistillResource: async (req: { kind: "skill" | "extension" | "prompt"; name: string; filePath: string }): Promise<IpcResult<{ graphSha256: string; contextSha256: string | null; node: { nodeId: string; nodeRevisionId: string; title: string } }>> =>
    ok(await window.omega?.histosDistillResource?.(req)),
  histosImportContext: async (req: { sourceWorkspaceId: string; sourceSha256: string; budget?: number }): Promise<IpcResult<{ sha256: string; sourceSha256: string; factAppend: { ok: boolean; error?: string } }>> =>
    ok(await window.omega?.histosImportContext?.(req)),
  histosSuggestContext: async (req: { query?: string; terms?: string[]; limit?: number }): Promise<IpcResult<{ terms: string[]; candidates: Array<{ nodeRevisionId: string; nodeId: string; kind: string; title: string | null; artifactSha: string | null; lens: string | null; createdAt: number; evidenceCount: number; matchedTerms: string[]; score: number }> }>> =>
    ok(await window.omega?.histosSuggestContext?.(req)),
  histosGetArtifact: async (req: HistosGetArtifactRequest): Promise<IpcResult<HistosArtifactDTO>> =>
    ok(await window.omega?.histosGetArtifact?.(req)),
  setProviderApiKey: async (req: { providerId: string; apiKey: string }): Promise<IpcResult<AuthStatus>> =>
    ok(await window.omega?.setProviderApiKey?.(req)),
  removeProviderApiKey: async (req: { providerId: string }): Promise<IpcResult<AuthStatus>> =>
    ok(await window.omega?.removeProviderApiKey?.(req)),
  listSessions: async (req?: { offset?: number; limit?: number }): Promise<IpcResult<SessionListPage>> =>
    ok(await window.omega?.listSessions?.(req)),
  activitySnapshot: async (): Promise<IpcResult<ActivitySnapshotPage>> => ok(await window.omega?.activitySnapshot?.()),
  onActivityChanged: (callback: (data: unknown) => void): (() => void) =>
    window.omega?.onActivityChanged?.(callback) ?? (() => {}),
  mcpList: async (): Promise<IpcResult<McpBundle>> => ok(await window.omega?.mcpList?.()),
  mcpAdd: async (req: { name: string; command: string; args?: string[]; project?: boolean }): Promise<IpcResult<McpBundle>> =>
    ok(await window.omega?.mcpAdd?.(req)),
  mcpSetEnabled: async (req: { name: string; enabled: boolean; project?: boolean }): Promise<IpcResult<McpBundle>> =>
    ok(await window.omega?.mcpSetEnabled?.(req)),
  mcpRemove: async (req: { name: string; project?: boolean }): Promise<IpcResult<McpBundle>> =>
    ok(await window.omega?.mcpRemove?.(req)),
  readSessionMessages: async (req: { sessionId: string; offset?: number; limit?: number }): Promise<IpcResult<{ items: SessionMessage[]; total: number; nextOffset: number | null }>> =>
    ok(await window.omega?.readSessionMessages?.(req)),
  newSession: async (req: {
    projectKey?: string;
    title?: string;
    workspace?: string;
  }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.newSession?.(req)),
  loadSession: async (req: { sessionId: string }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.loadSession?.(req)),
  deleteSession: async (req: { sessionId: string }): Promise<IpcResult<void>> => ok(await window.omega?.deleteSession?.(req)),
  approveChange: async (req: {
    action: "accept" | "reject";
    snapshotToken?: string;
    files?: string[];
    items?: GitStageItem[];
  }): Promise<IpcResult<ChangeApprovalResult>> => ok(await window.omega?.approveChange?.(req)),
};

/** Convenience helper that throws on `!ok` so callers can use try/catch. */
export async function unwrap<T>(result: IpcResult<T>): Promise<T> {
  if (result.ok) return result.data;
  throw new Error(`${result.code}: ${result.message}`);
}
