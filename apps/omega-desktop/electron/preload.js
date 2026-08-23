/**
 * Narrow, validated bridge exposed to the renderer.
 *
 * The legacy `prompt / onStatus / onEvent` methods are preserved untouched.
 * The new `omega:*` methods are appended in the same object; each performs the
 * SAME minimal validation as the main-process `senderAllowed` check (defence in
 * depth) before invoking its IPC channel. The renderer never gains raw
 * filesystem or git access. See system_design.md §1.4 / §3.3.
 */
const { contextBridge, ipcRenderer } = require("electron");
const MAX_PROMPT_CHARS = 40_000;
const MAX_FIELD_CHARS = 256_000;
const MAX_PROMPT_IMAGES = 4;
const MAX_IMAGE_CHARS = 8_000_000;

function validImage(image) {
  return (
    image !== null &&
    typeof image === "object" &&
    typeof image.mimeType === "string" &&
    image.mimeType.startsWith("image/") &&
    typeof image.data === "string" &&
    image.data.length > 0 &&
    image.data.length <= MAX_IMAGE_CHARS
  );
}

// ----- custom window controls (frameless TitleBar) -----
const windowApi = {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onWindowStateChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch (error) {
        console.error("omega window state callback failed", error);
      }
    };
    ipcRenderer.on("window:maximizedChanged", handler);
    return () => ipcRenderer.removeListener("window:maximizedChanged", handler);
  },
};

function safeString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

contextBridge.exposeInMainWorld("omega", {
  ...windowApi,
  // ----- legacy contract (unchanged) -----
  prompt: (text, behavior, images) => {
    if (typeof text !== "string" || !text.trim()) return Promise.resolve({ ok: false, code: "invalid_prompt", message: "Prompt must be a non-empty string" });
    if (text.length > MAX_PROMPT_CHARS) return Promise.resolve({ ok: false, code: "prompt_too_large", message: `Prompt exceeds ${MAX_PROMPT_CHARS} characters` });
    if (behavior !== undefined && behavior !== "steer" && behavior !== "followUp") {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "behavior must be steer|followUp" });
    }
    if (images !== undefined) {
      if (!Array.isArray(images) || images.length === 0 || images.length > MAX_PROMPT_IMAGES || !images.every(validImage)) {
        return Promise.resolve({ ok: false, code: "invalid_args", message: `images must be 1-${MAX_PROMPT_IMAGES} {mimeType,data} entries` });
      }
    }
    return ipcRenderer.invoke("agent:prompt", text, behavior, images);
  },
  abort: () => ipcRenderer.invoke("agent:abort"),
  onTransport: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      try { callback(data); } catch (error) { console.error("omega transport callback failed", error); }
    };
    ipcRenderer.on("worker:transport", handler);
    return () => ipcRenderer.removeListener("worker:transport", handler);
  },
  onStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      try { callback(data); } catch (error) { console.error("omega status callback failed", error); }
    };
    ipcRenderer.on("app:bootstrap-error", handler);
    return () => ipcRenderer.removeListener("app:bootstrap-error", handler);
  },
  onEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      try { callback(data); } catch (error) { console.error("omega event callback failed", error); }
    };
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },
  onExtensionUiRequest: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      try { callback(data); } catch (error) { console.error("omega extension UI callback failed", error); }
    };
    ipcRenderer.on("extension-ui:request", handler);
    return () => ipcRenderer.removeListener("extension-ui:request", handler);
  },
  extensionUiResponse: (response) => {
    if (!isPlainObject(response) || typeof response.id !== "string" || typeof response.sessionId !== "string" || !Number.isInteger(response.generation)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "Invalid extension UI response" });
    }
    return ipcRenderer.invoke("omega:extensionUiResponse", {
      ...response,
      id: response.id.slice(0, 128),
      sessionId: response.sessionId.slice(0, 128),
      runId: typeof response.runId === "string" ? response.runId.slice(0, 128) : null,
      value: typeof response.value === "string" ? response.value.slice(0, MAX_FIELD_CHARS) : response.value,
    });
  },
  extensionUiCancel: (response) => {
    if (!isPlainObject(response) || typeof response.id !== "string" || typeof response.sessionId !== "string" || !Number.isInteger(response.generation)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "Invalid extension UI cancellation" });
    }
    return ipcRenderer.invoke("omega:extensionUiCancel", {
      ...response,
      id: response.id.slice(0, 128),
      sessionId: response.sessionId.slice(0, 128),
      runId: typeof response.runId === "string" ? response.runId.slice(0, 128) : null,
      cancelled: true,
    });
  },

  // ----- extension state (read-only) -----
  listWorkspaces: () => ipcRenderer.invoke("omega:listWorkspaces"),
  chooseWorkspace: () => ipcRenderer.invoke("omega:chooseWorkspace"),
  switchWorkspace: (req) => {
    if (!req || typeof req.workspace !== "string" || !req.workspace.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "workspace is required" });
    }
    return ipcRenderer.invoke("omega:switchWorkspace", { workspace: req.workspace.slice(0, 4096) });
  },
  removeWorkspace: (req) => {
    if (!req || typeof req.workspace !== "string" || !req.workspace.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "workspace is required" });
    }
    return ipcRenderer.invoke("omega:removeWorkspace", { workspace: req.workspace.slice(0, 4096) });
  },
  inspectProjectTrust: (req) => ipcRenderer.invoke("omega:inspectProjectTrust", {
    workspace: safeString(req?.workspace, 4096),
  }),
  decideProjectTrust: (req) => {
    if (!req || typeof req.workspace !== "string" || !req.workspace.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "workspace is required" });
    }
    if (!["once", "always", "never"].includes(req.decision)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "decision must be once, always, or never" });
    }
    return ipcRenderer.invoke("omega:decideProjectTrust", {
      workspace: req.workspace.slice(0, 4096),
      decision: req.decision,
    });
  },
  retryWorker: () => ipcRenderer.invoke("omega:retryWorker"),
  recentEvents: (req) => ipcRenderer.invoke("omega:recentEvents", {
    sessionId: safeString(req?.sessionId, 128),
    after: Number.isFinite(req?.after) ? req.after : 0,
    limit: Number.isInteger(req?.limit) ? req.limit : 300,
  }),
  sessionRpc: (req) => {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId.trim() || typeof req.method !== "string" || !req.method.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId and method are required" });
    return ipcRenderer.invoke("omega:sessionRpc", { sessionId: req.sessionId.slice(0, 128), method: req.method.slice(0, 128), args: isPlainObject(req.args) ? req.args : {} });
  },
  sessionReady: () => ipcRenderer.invoke("omega:sessionReady"),
  getState: () => ipcRenderer.invoke("omega:getState"),
  listModels: () => ipcRenderer.invoke("omega:listModels"),
  setModel: (req) => {
    if (!req || typeof req.provider !== "string" || typeof req.modelId !== "string") {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "provider and modelId are required" });
    }
    return ipcRenderer.invoke("omega:setModel", {
      provider: req.provider.slice(0, 256),
      modelId: req.modelId.slice(0, 256),
    });
  },
  setThinkingLevel: (req) => {
    const allowed = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    if (!req || typeof req.level !== "string" || !allowed.includes(req.level)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "level must be a supported thinking level" });
    }
    return ipcRenderer.invoke("omega:setThinkingLevel", { level: req.level });
  },
  listCommands: () => ipcRenderer.invoke("omega:listCommands"),
  compact: () => ipcRenderer.invoke("omega:compact"),
  authStatus: () => ipcRenderer.invoke("omega:authStatus"),
  getDesktopSettings: () => ipcRenderer.invoke("omega:getDesktopSettings"),
  updateDesktopSettings: (req) => ipcRenderer.invoke("omega:updateDesktopSettings", isPlainObject(req) ? req : {}),
  setPermissionProfile: (req) => {
    const allowed = ["trusted", "workspace-only", "read-only", "ask-before-command"];
    if (!req || typeof req.profile !== "string" || !allowed.includes(req.profile)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "profile must be a supported permission profile" });
    }
    return ipcRenderer.invoke("omega:setPermissionProfile", { profile: req.profile });
  },
  setProviderApiKey: (req) => {
    if (!req || typeof req.providerId !== "string" || !req.providerId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "providerId is required" });
    }
    if (typeof req.apiKey !== "string" || !req.apiKey.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "apiKey is required" });
    }
    return ipcRenderer.invoke("omega:setProviderApiKey", {
      providerId: req.providerId.trim().slice(0, 128),
      apiKey: req.apiKey.trim().slice(0, 8192),
    });
  },
  removeProviderApiKey: (req) => {
    if (!req || typeof req.providerId !== "string" || !req.providerId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "providerId is required" });
    }
    return ipcRenderer.invoke("omega:removeProviderApiKey", { providerId: req.providerId.trim().slice(0, 128) });
  },
  listPiSessions: () => ipcRenderer.invoke("omega:listPiSessions"),
  newPiSession: (req) => {
    if (req && req.title !== undefined && (typeof req.title !== "string" || req.title.length > 256)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "title must be a short string" });
    }
    if (req && req.workspace !== undefined && typeof req.workspace !== "string") {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "workspace must be a string" });
    }
    return ipcRenderer.invoke("omega:newPiSession", {
      title: safeString(req?.title, 256),
      workspace: safeString(req?.workspace, 4096),
    });
  },
  switchPiSession: (req) => {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId is required" });
    }
    return ipcRenderer.invoke("omega:switchPiSession", { sessionId: req.sessionId });
  },
  setSessionName: (req) => {
    if (!req || typeof req.name !== "string" || !req.name.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "name must be a non-empty string" });
    }
    return ipcRenderer.invoke("omega:setSessionName", { name: req.name.slice(0, 256) });
  },
  updateSettings: (req) => {
    const payload = {};
    if (req?.steeringMode === "all" || req?.steeringMode === "one-at-a-time") payload.steeringMode = req.steeringMode;
    if (req?.followUpMode === "all" || req?.followUpMode === "one-at-a-time") payload.followUpMode = req.followUpMode;
    if (typeof req?.autoCompaction === "boolean") payload.autoCompaction = req.autoCompaction;
    if (typeof req?.autoRetry === "boolean") payload.autoRetry = req.autoRetry;
    return ipcRenderer.invoke("omega:updateSettings", payload);
  },
  clearQueue: () => ipcRenderer.invoke("omega:clearQueue"),
  getSessionTree: () => ipcRenderer.invoke("omega:getSessionTree"),
  getForkCandidates: () => ipcRenderer.invoke("omega:getForkCandidates"),
  fork: (req) => {
    if (!req || typeof req.entryId !== "string" || !req.entryId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "entryId is required" });
    }
    return ipcRenderer.invoke("omega:fork", { entryId: req.entryId });
  },
  clone: () => ipcRenderer.invoke("omega:clone"),
  navigateTree: (req) => {
    if (!req || typeof req.targetId !== "string" || !req.targetId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "targetId is required" });
    }
    return ipcRenderer.invoke("omega:navigateTree", { targetId: req.targetId });
  },
  listDir: (req) =>
    ipcRenderer.invoke("omega:listDir", { path: safeString(req?.path, 4096) ?? "" }),
  readFile: (req) => {
    if (!req || typeof req.path !== "string" || !req.path.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "path is required" });
    }
    return ipcRenderer.invoke("omega:readFile", { path: req.path.slice(0, 4096) });
  },
  readFilePage: (req) => {
    if (!req || typeof req.path !== "string" || !req.path.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "path is required" });
    }
    return ipcRenderer.invoke("omega:readFilePage", { path: req.path.slice(0, 4096), offset: Number.isInteger(req.offset) ? req.offset : 0, limit: Number.isInteger(req.limit) ? req.limit : 200 });
  },
  fileIndex: (req) => ipcRenderer.invoke("omega:fileIndex", { query: safeString(req?.query, 256) ?? "" }),
  revealInFolder: (req) => ipcRenderer.invoke("omega:revealInFolder", { path: safeString(req?.path, 4096) ?? "" }),
  bash: (req) => {
    if (!req || typeof req.command !== "string" || !req.command.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "command is required" });
    }
    return ipcRenderer.invoke("omega:bash", {
      command: req.command.slice(0, 8192),
      excludeFromContext: req?.excludeFromContext === true,
    });
  },
  gitSnapshot: () => ipcRenderer.invoke("omega:gitSnapshot"),
  listWorktrees: () => ipcRenderer.invoke("omega:listWorktrees"),
  addWorktree: (req) => ipcRenderer.invoke("omega:addWorktree", {
    path: safeString(req?.path, 4096),
    branch: safeString(req?.branch, 128),
    createBranch: req?.createBranch !== false,
  }),
  removeWorktree: (req) => {
    if (!req || typeof req.path !== "string" || !req.path.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "path is required" });
    }
    return ipcRenderer.invoke("omega:removeWorktree", { path: req.path.slice(0, 4096), force: req.force === true });
  },
  gitStage: (req) => {
    if (!Array.isArray(req?.items)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "items[] is required" });
    }
    return ipcRenderer.invoke("omega:gitStage", { snapshotToken: safeString(req.snapshotToken, 128), items: req.items.slice(0, 200) });
  },
  gitUnstage: (req) => {
    if (!Array.isArray(req?.items)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "items[] is required" });
    }
    return ipcRenderer.invoke("omega:gitUnstage", { snapshotToken: safeString(req.snapshotToken, 128), items: req.items.slice(0, 200) });
  },
  gitCommit: (req) => {
    if (!req || typeof req.message !== "string" || !req.message.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "message is required" });
    }
    return ipcRenderer.invoke("omega:gitCommit", { message: req.message.slice(0, 8000) });
  },
  getThinking: (req) => {
    if (!req || typeof req.entryId !== "string" || !req.entryId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "entryId is required" });
    }
    return ipcRenderer.invoke("omega:getThinking", { entryId: req.entryId });
  },
  getSystemPrompt: () => ipcRenderer.invoke("omega:getSystemPrompt"),
  exportHtml: () => ipcRenderer.invoke("omega:exportHtml"),
  listResources: () => ipcRenderer.invoke("omega:listResources"),
  reloadResources: () => ipcRenderer.invoke("omega:reloadResources"),
  installLocalResource: (req) => ipcRenderer.invoke("omega:installLocalResource", {
    source: safeString(req?.source, 4096),
    project: req?.project === true,
  }),
  removeLocalResource: (req) => {
    if (!req || typeof req.source !== "string" || !req.source.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "source is required" });
    }
    return ipcRenderer.invoke("omega:removeLocalResource", {
      source: req.source.slice(0, 4096),
      project: req.project === true,
    });
  },
  setResourceEnabled: (req) => {
    if (!req || typeof req.kind !== "string" || typeof req.path !== "string" || !req.path.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "kind and path are required" });
    }
    return ipcRenderer.invoke("omega:setResourceEnabled", {
      kind: req.kind.slice(0, 32),
      path: req.path.slice(0, 4096),
      enabled: req.enabled !== false,
      project: req.project === true,
      baseDir: safeString(req.baseDir, 4096),
    });
  },
  setSkillModelInvocation: (req) => {
    if (!req || typeof req.filePath !== "string" || !req.filePath.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "filePath is required" });
    }
    return ipcRenderer.invoke("omega:setSkillModelInvocation", {
      filePath: req.filePath.slice(0, 4096),
      disable: req.disable === true,
    });
  },
  setSkillCommandsEnabled: (req) => ipcRenderer.invoke("omega:setSkillCommandsEnabled", {
    enabled: req?.enabled !== false,
  }),
  queryExtensionState: (req) => {
    const scope = typeof req?.scope === "string" ? req.scope : "all";
    if (!["all", "workflow", "scout"].includes(scope)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "scope must be all|workflow|scout" });
    }
    return ipcRenderer.invoke("omega:queryExtensionState", {
      scope,
      projectKey: safeString(req?.projectKey, 512),
      taskId: safeString(req?.taskId, 512),
    });
  },

  // ----- sessions -----
  listSessions: (req) => ipcRenderer.invoke("omega:listSessions", {
    offset: Number.isInteger(req?.offset) ? req.offset : 0,
    limit: Number.isInteger(req?.limit) ? req.limit : 100,
  }),
  readSessionMessages: (req) => {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId is required" });
    return ipcRenderer.invoke("omega:readSessionMessages", { sessionId: req.sessionId.slice(0, 128), offset: Number.isInteger(req.offset) ? req.offset : 0, limit: Number.isInteger(req.limit) ? req.limit : 100 });
  },
  newSession: (req) => {
    if (req && req.title !== undefined && (typeof req.title !== "string" || req.title.length > 256)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "title must be a short string" });
    }
    if (req && req.workspace !== undefined && typeof req.workspace !== "string") {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "workspace must be a string" });
    }
    return ipcRenderer.invoke("omega:newSession", {
      projectKey: safeString(req?.projectKey, 512),
      title: safeString(req?.title, 256),
      workspace: safeString(req?.workspace, 4096),
    });
  },
  loadSession: (req) => {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId is required" });
    }
    return ipcRenderer.invoke("omega:loadSession", { sessionId: req.sessionId });
  },
  saveSession: (req) => {
    if (!req || typeof req.sessionId !== "string" || !isPlainObject(req.transcript)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId and transcript are required" });
    }
    return ipcRenderer.invoke("omega:saveSession", { sessionId: req.sessionId, transcript: req.transcript });
  },
  deleteSession: (req) => {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId is required" });
    }
    return ipcRenderer.invoke("omega:deleteSession", { sessionId: req.sessionId });
  },

  // ----- diff + approval -----
  diffWorkspace: (_req) => ipcRenderer.invoke("omega:diffWorkspace", {}),
  approveChange: (req) => {
    if (!req || (req.action !== "accept" && req.action !== "reject")) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "action must be accept|reject" });
    }
    const files = Array.isArray(req.files)
      ? req.files.filter((f) => typeof f === "string").map((f) => f.slice(0, 4096)).slice(0, 2000)
      : undefined;
    return ipcRenderer.invoke("omega:approveChange", { action: req.action, snapshotToken: safeString(req.snapshotToken, 128), files });
  },
});
