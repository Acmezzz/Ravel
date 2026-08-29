import type {
  IpcResult,
  WorkspaceInfo,
  ProjectTrustInfo,
  ProjectTrustChoice,
  DirListing,
  FileReadResult,
  UploadConflictMode,
  UploadTargetInfo,
  BashResultDTO,
  CheckpointInfo,
  ResourceBundle,
  RegistryEntry,
  RegistryStagedResult,
  FlowScheduleRow,
  McpBundle,
  SessionRecord,
  ExtensionUIRequest,
  ExtensionUIResponse,
} from "../types/dto";
import { ok } from "./utils";

/** Workspace switching, trust, file ops, bash, checkpoints, resources, MCP. */
export const workspaceClient = {
  listWorkspaces: async (): Promise<IpcResult<WorkspaceInfo[]>> => ok(await window.omega?.listWorkspaces?.()),
  chooseWorkspace: async (): Promise<IpcResult<{ root: string; workspace?: WorkspaceInfo; workspaces: WorkspaceInfo[]; trust?: ProjectTrustInfo }>> => ok(await window.omega?.chooseWorkspace?.()),
  switchWorkspace: async (req: { workspace: string }): Promise<IpcResult<SessionRecord>> => ok(await window.omega?.switchWorkspace?.(req)),
  removeWorkspace: async (req: { workspace: string }): Promise<IpcResult<WorkspaceInfo[]>> => ok(await window.omega?.removeWorkspace?.(req)),
  inspectProjectTrust: async (req?: { workspace?: string }): Promise<IpcResult<ProjectTrustInfo>> => ok(await window.omega?.inspectProjectTrust?.(req)),
  decideProjectTrust: async (req: { workspace: string; decision: ProjectTrustChoice }): Promise<IpcResult<{ trust: ProjectTrustInfo; reloaded?: boolean; sessionId?: string; workspaces: WorkspaceInfo[] }>> => ok(await window.omega?.decideProjectTrust?.(req)),
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
  checkpointList: async (): Promise<IpcResult<CheckpointInfo[]>> => ok(await window.omega?.checkpointList?.()),
  checkpointCreate: async (req?: { label?: string }): Promise<IpcResult<CheckpointInfo>> => ok(await window.omega?.checkpointCreate?.(req)),
  checkpointRestore: async (req: { id: string }): Promise<IpcResult<{ restored: string; safety: string }>> => ok(await window.omega?.checkpointRestore?.(req)),
  onFileChanged: (callback: (data: { path: string }) => void): (() => void) =>
    window.omega?.onFileChanged?.(callback) ?? (() => {}),
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
  stageRemoteResource: async (req: { url: string }): Promise<IpcResult<{ path: string; sha256: string; bytes: number; filename: string }>> =>
    ok(await window.omega?.stageRemoteResource?.(req)),
  registryFetch: async (req: { url: string }): Promise<IpcResult<{ entries: RegistryEntry[] }>> =>
    ok(await window.omega?.registryFetch?.(req)),
  registryStage: async (req: { url: string; names?: string[] }): Promise<IpcResult<{ results: RegistryStagedResult[] }>> =>
    ok(await window.omega?.registryStage?.(req)),
  flowScheduleCreate: async (req: { flowSha: string; kind: "interval" | "daily"; intervalMinutes?: number; timeOfDay?: string; maxRuns?: number }): Promise<IpcResult<{ items: FlowScheduleRow[] }>> =>
    ok(await window.omega?.flowScheduleCreate?.(req)),
  flowScheduleList: async (): Promise<IpcResult<{ items: FlowScheduleRow[] }>> => ok(await window.omega?.flowScheduleList?.()),
  flowScheduleRemove: async (req: { id: string }): Promise<IpcResult<{ items: FlowScheduleRow[] }>> => ok(await window.omega?.flowScheduleRemove?.(req)),
  mcpList: async (): Promise<IpcResult<McpBundle>> => ok(await window.omega?.mcpList?.()),
  mcpAdd: async (req: { name: string; command?: string; url?: string; args?: string[]; auth?: { authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scopes?: string[] }; project?: boolean }): Promise<IpcResult<McpBundle>> =>
    ok(await window.omega?.mcpAdd?.(req)),
  mcpSetEnabled: async (req: { name: string; enabled: boolean; project?: boolean }): Promise<IpcResult<McpBundle>> =>
    ok(await window.omega?.mcpSetEnabled?.(req)),
  mcpRemove: async (req: { name: string; project?: boolean }): Promise<IpcResult<McpBundle>> =>
    ok(await window.omega?.mcpRemove?.(req)),
  mcpLogin: async (req: { name: string; project?: boolean }): Promise<IpcResult<{ name: string; credentialId: string }>> =>
    ok(await window.omega?.mcpLogin?.(req)),
  onExtensionUiRequest: (callback: (request: ExtensionUIRequest) => void): (() => void) =>
    window.omega?.onExtensionUiRequest?.(callback) ?? (() => {}),
  extensionUiResponse: async (response: ExtensionUIResponse): Promise<IpcResult<{ accepted: boolean }>> =>
    ok(await window.omega?.extensionUiResponse?.(response)),
  extensionUiCancel: async (response: Omit<ExtensionUIResponse, "value" | "confirmed"> & { cancelled: true }): Promise<IpcResult<{ accepted: boolean }>> =>
    ok(await window.omega?.extensionUiCancel?.(response)),
};

export type WorkspaceClient = typeof workspaceClient;