/**
 * Shared IPC channel allowlist. Main, preload, and tests all derive from this
 * list so a new handler cannot land without a matching invoke surface.
 */
export const INVOKE_CHANNELS = Object.freeze([
  "omega:sessionReady",
  "omega:getState",
  "omega:listModels",
  "omega:setModel",
  "omega:setThinkingLevel",
  "omega:listCommands",
  "omega:compact",
  "omega:authStatus",
  "omega:getDesktopSettings",
  "omega:updateDesktopSettings",
  "omega:setProviderApiKey",
  "omega:removeProviderApiKey",
  "omega:listSessions",
  "omega:readSessionMessages",
  "omega:newSession",
  "omega:loadSession",
  "omega:saveSession",
  "omega:deleteSession",
  "omega:listWorkspaces",
  "omega:chooseWorkspace",
  "omega:switchWorkspace",
  "omega:removeWorkspace",
  "omega:inspectProjectTrust",
  "omega:decideProjectTrust",
  "omega:retryWorker",
  "omega:recentEvents",
  "omega:sessionRpc",
  "omega:listPiSessions",
  "omega:newPiSession",
  "omega:switchPiSession",
  "omega:setSessionName",
  "omega:updateSettings",
  "omega:clearQueue",
  "omega:getSessionTree",
  "omega:getForkCandidates",
  "omega:fork",
  "omega:clone",
  "omega:navigateTree",
  "omega:getThinking",
  "omega:getToolDetail",
  "omega:listResources",
  "omega:reloadResources",
  "omega:installLocalResource",
  "omega:removeLocalResource",
  "omega:setResourceEnabled",
  "omega:setSkillModelInvocation",
  "omega:setSkillCommandsEnabled",
  "omega:getSystemPrompt",
  "omega:exportHtml",
  "omega:bash",
  "omega:queryExtensionState",
  "omega:listDir",
  "omega:readFile",
  "omega:readFilePage",
  "omega:fileIndex",
  "omega:revealInFolder",
  "omega:openFileDefault",
  "omega:chooseFileForWorkspace",
  "omega:inspectUploadTarget",
  "omega:uploadFile",
  "omega:watchFile",
  "omega:unwatchFile",
  "omega:gitSnapshot",
  "omega:listWorktrees",
  "omega:addWorktree",
  "omega:removeWorktree",
  "omega:gitStage",
  "omega:gitUnstage",
  "omega:gitCommit",
  "omega:diffWorkspace",
  "omega:approveChange",
  "omega:setPermissionProfile",
  "omega:configureCustomProvider",
  "omega:extensionUiResponse",
  "omega:extensionUiCancel",
  "agent:prompt",
  "agent:abort",
  "window:minimize",
  "window:toggleMaximize",
  "window:close",
  "window:isMaximized",
]);

export const PUSH_CHANNELS = Object.freeze([
  "agent:event",
  "worker:transport",
  "app:bootstrap-error",
  "window:maximizedChanged",
  "file:changed",
  "extension-ui:request",
]);

export function extractHandleChannels(source) {
  return [...source.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

export function extractInvokeChannels(source) {
  return [...source.matchAll(/ipcRenderer\.invoke\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function diffChannelSets(expected, actual) {
  const missing = expected.filter((channel) => !actual.includes(channel));
  const extra = actual.filter((channel) => !expected.includes(channel));
  return { missing, extra };
}
