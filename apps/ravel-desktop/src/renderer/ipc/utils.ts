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
  RegistryEntry,
  RegistryStagedResult,
  FlowScheduleRow,
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
  HistosListCapabilitiesRequest,
  HistosCapabilityDTO,
  HistosInvokeNodeRequest,
  HistosInvokeNodeResultDTO,
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
  HistosApplyWebResourcesRequest,
  HistosApplyWebResourcesResultDTO,
  HistosApplyAgentActivityRequest,
  HistosApplyAgentActivityResultDTO,
  HistosApplyEvalResultsRequest,
  HistosApplyEvalResultsResultDTO,
  HistosGraphDTO,
  HistosRebuildResultDTO,
  HistosNodeRevisionDTO,
  HistosContextFreezeResultDTO,
  HistosConvertToFlowResultDTO,
  HistosArtifactDTO,
  HistosFactTripleDTO,
  HistosFactQueryDTO,
  HistosFactStatsDTO,
  HistosFactQueryResultDTO,
  HistosFactWriteResultDTO,
  HistosFactClearResultDTO,
  HistosFactEventDTO,
} from "../types/dto";

/**
 * Shared helpers plus the `window.omega` bridge shape for the domain IPC
 * client modules in this directory. Living in one module avoids a circular
 * dependency between the aggregate `client.ts` and the per-domain clients.
 */

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
  registryFetch(req: { url: string }): Promise<IpcResult<{ entries: RegistryEntry[] }>>;
  registryStage(req: { url: string; names?: string[] }): Promise<IpcResult<{ results: RegistryStagedResult[] }>>;
  flowScheduleCreate(req: { flowSha: string; kind: "interval" | "daily"; intervalMinutes?: number; timeOfDay?: string; maxRuns?: number }): Promise<IpcResult<{ items: FlowScheduleRow[] }>>;
  flowScheduleList(): Promise<IpcResult<{ items: FlowScheduleRow[] }>>;
  flowScheduleRemove(req: { id: string }): Promise<IpcResult<{ items: FlowScheduleRow[] }>>;
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
  histosApplyWebResources(req: HistosApplyWebResourcesRequest): Promise<IpcResult<HistosApplyWebResourcesResultDTO>>;
  histosApplyAgentActivity(req: HistosApplyAgentActivityRequest): Promise<IpcResult<HistosApplyAgentActivityResultDTO>>;
  histosApplyEvalResults(req: HistosApplyEvalResultsRequest): Promise<IpcResult<HistosApplyEvalResultsResultDTO>>;
  histosListCapabilities(req?: HistosListCapabilitiesRequest): Promise<IpcResult<HistosCapabilityDTO[]>>;
  histosInvokeNode(req: HistosInvokeNodeRequest): Promise<IpcResult<HistosInvokeNodeResultDTO>>;
  histosGetNode(req: HistosGetNodeRequest): Promise<IpcResult<HistosNodeRevisionDTO | null>>;
  histosFreezeContext(req: HistosFreezeContextRequest): Promise<IpcResult<HistosContextFreezeResultDTO>>;
  histosConvertToFlow(req: HistosConvertToFlowRequest): Promise<IpcResult<HistosConvertToFlowResultDTO>>;
  histosGetArtifact(req: HistosGetArtifactRequest): Promise<IpcResult<HistosArtifactDTO>>;
  histosDiffGraphs(req: { prev: HistosGetArtifactRequest; next: HistosGetArtifactRequest }): Promise<IpcResult<{ diff: Record<string, unknown[]>; summary: string[] }>>;
  histosDistillResource(req: { kind: "skill" | "extension" | "prompt"; name: string; filePath: string }): Promise<IpcResult<{ graphSha256: string; contextSha256: string | null; node: { nodeId: string; nodeRevisionId: string; title: string } }>>;
  histosImportContext(req: { sourceWorkspaceId: string; sourceSha256: string; budget?: number }): Promise<IpcResult<{ sha256: string; sourceSha256: string; factAppend: { ok: boolean; error?: string } }>>;
  histosSuggestContext(req: { query?: string; terms?: string[]; limit?: number }): Promise<IpcResult<{ terms: string[]; candidates: Array<{ nodeRevisionId: string; nodeId: string; kind: string; title: string | null; artifactSha: string | null; lens: string | null; createdAt: number; evidenceCount: number; matchedTerms: string[]; score: number }> }>>;
  histosQueryFacts(req: HistosFactQueryDTO): Promise<IpcResult<HistosFactQueryResultDTO>>;
  histosWriteFacts(req: { triples: HistosFactTripleDTO[] }): Promise<IpcResult<HistosFactWriteResultDTO>>;
  histosFactStats(): Promise<IpcResult<HistosFactStatsDTO>>;
  histosClearFacts(): Promise<IpcResult<HistosFactClearResultDTO>>;
  onHistosEvent(callback: (data: HistosFactEventDTO) => void): () => void;
  setProviderApiKey(req: { providerId: string; apiKey: string }): Promise<IpcResult<AuthStatus>>;
  removeProviderApiKey(req: { providerId: string }): Promise<IpcResult<AuthStatus>>;
  listSessions(req?: { offset?: number; limit?: number }): Promise<IpcResult<SessionListPage>>;
  activitySnapshot(): Promise<IpcResult<ActivitySnapshotPage>>;
  onActivityChanged(callback: (data: unknown) => void): () => void;
  mcpList(): Promise<IpcResult<McpBundle>>;
  mcpAdd(req: { name: string; command?: string; url?: string; args?: string[]; auth?: { authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scopes?: string[] }; project?: boolean }): Promise<IpcResult<McpBundle>>;
  mcpSetEnabled(req: { name: string; enabled: boolean; project?: boolean }): Promise<IpcResult<McpBundle>>;
  mcpRemove(req: { name: string; project?: boolean }): Promise<IpcResult<McpBundle>>;
  mcpLogin(req: { name: string; project?: boolean }): Promise<IpcResult<{ name: string; credentialId: string }>>;
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

export function ok<T>(value: IpcResult<T> | undefined): IpcResult<T> {
  if (value && typeof value === "object" && "ok" in value) return value;
  return { ok: false, code: "bridge_error", message: "No response from host" };
}

/** Convenience helper that throws on `!ok` so callers can use try/catch. */
export async function unwrap<T>(result: IpcResult<T>): Promise<T> {
  if (result.ok) return result.data;
  throw new Error(`${result.code}: ${result.message}`);
}