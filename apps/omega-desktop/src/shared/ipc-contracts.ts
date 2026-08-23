/** Shared renderer/main IPC vocabulary. Keep this independent from the Pi SDK types. */
export const IPC_CHANNELS = {
  sessionReady: "omega:sessionReady",
  getState: "omega:getState",
  listModels: "omega:listModels",
  setModel: "omega:setModel",
  setThinkingLevel: "omega:setThinkingLevel",
  listCommands: "omega:listCommands",
  compact: "omega:compact",
  authStatus: "omega:authStatus",
  getDesktopSettings: "omega:getDesktopSettings",
  updateDesktopSettings: "omega:updateDesktopSettings",
  setProviderApiKey: "omega:setProviderApiKey",
  removeProviderApiKey: "omega:removeProviderApiKey",
  listSessions: "omega:listSessions",
  readSessionMessages: "omega:readSessionMessages",
  newSession: "omega:newSession",
  loadSession: "omega:loadSession",
  saveSession: "omega:saveSession",
  deleteSession: "omega:deleteSession",
  listWorkspaces: "omega:listWorkspaces",
  chooseWorkspace: "omega:chooseWorkspace",
  switchWorkspace: "omega:switchWorkspace",
  removeWorkspace: "omega:removeWorkspace",
  inspectProjectTrust: "omega:inspectProjectTrust",
  decideProjectTrust: "omega:decideProjectTrust",
  retryWorker: "omega:retryWorker",
  recentEvents: "omega:recentEvents",
  sessionRpc: "omega:sessionRpc",
  listPiSessions: "omega:listPiSessions",
  newPiSession: "omega:newPiSession",
  switchPiSession: "omega:switchPiSession",
  setSessionName: "omega:setSessionName",
  updateSettings: "omega:updateSettings",
  clearQueue: "omega:clearQueue",
  getSessionTree: "omega:getSessionTree",
  getForkCandidates: "omega:getForkCandidates",
  fork: "omega:fork",
  clone: "omega:clone",
  navigateTree: "omega:navigateTree",
  getThinking: "omega:getThinking",
  getToolDetail: "omega:getToolDetail",
  listResources: "omega:listResources",
  reloadResources: "omega:reloadResources",
  installLocalResource: "omega:installLocalResource",
  removeLocalResource: "omega:removeLocalResource",
  setResourceEnabled: "omega:setResourceEnabled",
  setSkillModelInvocation: "omega:setSkillModelInvocation",
  setSkillCommandsEnabled: "omega:setSkillCommandsEnabled",
  getSystemPrompt: "omega:getSystemPrompt",
  exportHtml: "omega:exportHtml",
  bash: "omega:bash",
  queryExtensionState: "omega:queryExtensionState",
  listDir: "omega:listDir",
  readFile: "omega:readFile",
  readFilePage: "omega:readFilePage",
  fileIndex: "omega:fileIndex",
  revealInFolder: "omega:revealInFolder",
  watchFile: "omega:watchFile",
  unwatchFile: "omega:unwatchFile",
  gitSnapshot: "omega:gitSnapshot",
  listWorktrees: "omega:listWorktrees",
  addWorktree: "omega:addWorktree",
  removeWorktree: "omega:removeWorktree",
  gitStage: "omega:gitStage",
  gitUnstage: "omega:gitUnstage",
  gitCommit: "omega:gitCommit",
  diffWorkspace: "omega:diffWorkspace",
  approveChange: "omega:approveChange",
  setPermissionProfile: "omega:setPermissionProfile",
  extensionUiResponse: "omega:extensionUiResponse",
  extensionUiCancel: "omega:extensionUiCancel",
  prompt: "agent:prompt",
  abort: "agent:abort",
  event: "agent:event",
  transport: "worker:transport",
  bootstrapError: "app:bootstrap-error",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",
  windowIsMaximized: "window:isMaximized",
  windowMaximizedChanged: "window:maximizedChanged",
  fileChanged: "file:changed",
  extensionUiRequest: "extension-ui:request",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ERROR_CODES = {
  forbidden: "forbidden",
  invalidArgs: "invalid_args",
  invalidPrompt: "invalid_prompt",
  bootstrapFailed: "bootstrap_failed",
  workerUnavailable: "worker_unavailable",
  workerTimeout: "worker_timeout",
  workerDisposed: "worker_disposed",
  staleGeneration: "stale_generation",
  sessionBusy: "session_busy",
  sessionNotFound: "not_found",
  staleDiffSnapshot: "stale_diff_snapshot",
  workspaceUnauthorized: "workspace_not_authorized",
  workspaceInUse: "workspace_in_use",
  trustRequired: "trust_required",
  cancelled: "cancelled",
  unsupported: "unsupported",
  networkForbidden: "network_forbidden",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface IpcResult<T> {
  ok: true;
  data: T;
}

export interface IpcError {
  ok: false;
  code: string;
  message: string;
}

export function isIpcResult(value: unknown): value is IpcResult<unknown> | IpcError {
  return Boolean(value && typeof value === "object" && "ok" in value && typeof value.ok === "boolean");
}

export function isNonEmptyString(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
