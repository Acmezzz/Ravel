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
const MAX_PTY_ID_LENGTH = 128;
const MAX_PTY_WRITE_BYTES = 64 * 1024;
const MAX_PTY_CWD_LENGTH = 4096;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function validPtyString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !CONTROL_CHARS.test(value);
}

function validPtyDimensions(cols, rows) {
  return Number.isInteger(cols) && cols >= 1 && cols <= 500 && Number.isInteger(rows) && rows >= 1 && rows <= 300;
}

function validPtyData(value) {
  return value && typeof value === "object" && value.type === "pty:data" && validPtyString(value.sessionId, MAX_PTY_ID_LENGTH) && typeof value.chunk === "string" && Buffer.byteLength(value.chunk, "utf8") <= MAX_PTY_WRITE_BYTES && Number.isSafeInteger(value.sequence) && value.sequence >= 0 && typeof value.isFinal === "boolean";
}

function validPtyExit(value) {
  return value && typeof value === "object" && value.type === "pty:exit" && validPtyString(value.sessionId, MAX_PTY_ID_LENGTH) && (value.exitCode === null || Number.isSafeInteger(value.exitCode)) && (value.signal === null || Number.isSafeInteger(value.signal));
}

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
  onFileChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => { try { callback(data); } catch (error) { console.error("omega file change callback failed", error); } };
    ipcRenderer.on("file:changed", handler);
    return () => ipcRenderer.removeListener("file:changed", handler);
  },
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

const HISTOS_LENSES = ["structural", "semantic", "mixed"];
const HISTOS_GRANULARITIES = ["operation", "entry", "span", "file", "cluster"];
const HISTOS_SHA256 = /^[0-9a-f]{64}$/;
const HISTOS_CONTROL = /[\u0000-\u001f\u007f]/;
const HISTOS_MAX_ITEMS = 4096;
const HISTOS_MAX_DEPTH = 12;

function histosString(value, max = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !HISTOS_CONTROL.test(value);
}

function histosJson(value, depth = 0, count = { value: 0 }) {
  count.value += 1;
  if (depth > HISTOS_MAX_DEPTH || count.value > HISTOS_MAX_ITEMS) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 4096 && !HISTOS_CONTROL.test(value);
  if (Array.isArray(value)) return value.every((item) => histosJson(item, depth + 1, count));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(([key, item]) => histosString(key, 256) && histosJson(item, depth + 1, count));
}

function histosQuery(req) {
  if (!isPlainObject(req) || !isPlainObject(req.sourceSet) || !histosJson(req.sourceSet) || !HISTOS_LENSES.includes(req.lens) || !HISTOS_GRANULARITIES.includes(req.granularity)) return null;
  return { sourceSet: req.sourceSet, lens: req.lens, granularity: req.granularity };
}

function histosSelection(value) {
  if (typeof value === "string") return histosString(value, 512) ? value : null;
  if (!isPlainObject(value)) return null;
  const keys = ["nodeRevisionId", "edgeRevisionId", "id"].filter((key) => typeof value[key] === "string");
  if (keys.length !== 1 || Object.keys(value).some((key) => !["nodeRevisionId", "edgeRevisionId", "id"].includes(key)) || !histosString(value[keys[0]], 512)) return null;
  return { [keys[0]]: value[keys[0]] };
}

function invalidHistos(message) {
  return Promise.resolve({ ok: false, code: "invalid_args", message });
}

contextBridge.exposeInMainWorld("omega", {
  ...windowApi,
  // ----- legacy contract (unchanged) -----
  prompt: (text, behavior, images, clientMessageId, references) => {
    if (typeof text !== "string" || !text.trim()) return Promise.resolve({ ok: false, code: "invalid_prompt", message: "Prompt must be a non-empty string" });
    if (clientMessageId !== undefined && (typeof clientMessageId !== "string" || clientMessageId.length < 1 || clientMessageId.length > 128)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "clientMessageId must be a bounded string" });
    }
    if (references !== undefined) {
      const valid =
        Array.isArray(references) &&
        references.length <= 16 &&
        references.every((ref) => ref && typeof ref === "object" && typeof ref.targetSessionId === "string" && ref.targetSessionId.length >= 1 && ref.targetSessionId.length <= 128 && typeof ref.targetTitle === "string" && ref.targetTitle.length >= 1 && ref.targetTitle.length <= 256);
      if (!valid) return Promise.resolve({ ok: false, code: "invalid_args", message: "references must be <=16 {targetSessionId,targetTitle} entries" });
    }
    if (text.length > MAX_PROMPT_CHARS) return Promise.resolve({ ok: false, code: "prompt_too_large", message: `Prompt exceeds ${MAX_PROMPT_CHARS} characters` });
    if (behavior !== undefined && behavior !== "steer" && behavior !== "followUp") {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "behavior must be steer|followUp" });
    }
    if (images !== undefined) {
      if (!Array.isArray(images) || images.length === 0 || images.length > MAX_PROMPT_IMAGES || !images.every(validImage)) {
        return Promise.resolve({ ok: false, code: "invalid_args", message: `images must be 1-${MAX_PROMPT_IMAGES} {mimeType,data} entries` });
      }
    }
    return ipcRenderer.invoke("agent:prompt", text, behavior, images, clientMessageId?.slice(0, 128), references);
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
  onActivityChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      try { callback(data); } catch (error) { console.error("omega activity callback failed", error); }
    };
    ipcRenderer.on("activity:changed", handler);
    return () => ipcRenderer.removeListener("activity:changed", handler);
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
    runtimeEpoch: Number.isInteger(req?.runtimeEpoch) ? req.runtimeEpoch : 0,
    limit: Number.isInteger(req?.limit) ? req.limit : 300,
  }),
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
  configureCustomProvider: (req) => {
    if (!req || typeof req !== "object") return Promise.resolve({ ok: false, code: "invalid_args", message: "provider config is required" });
    return ipcRenderer.invoke("omega:configureCustomProvider", req);
  },
  histosGetGraph: (req) => {
    const query = histosQuery(req);
    return query ? ipcRenderer.invoke("omega:histosGetGraph", query) : invalidHistos("sourceSet, lens, and granularity are required");
  },
  histosCondenseGraph: (req) => {
    const query = histosQuery(req);
    if (!query || query.lens === "structural") return invalidHistos("semantic or mixed lens is required");
    const budget = req?.budget;
    if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 1 || budget > 32000)) return invalidHistos("budget is out of bounds");
    const parentSha = req?.parentSha;
    if (parentSha !== undefined && (typeof parentSha !== "string" || !HISTOS_SHA256.test(parentSha))) return invalidHistos("parentSha is invalid");
    const provider = req?.provider === undefined ? undefined : req.provider;
    const modelId = req?.modelId === undefined ? undefined : req.modelId;
    if (provider !== undefined && !histosString(provider, 256)) return invalidHistos("provider is invalid");
    if (modelId !== undefined && !histosString(modelId, 256)) return invalidHistos("modelId is invalid");
    return ipcRenderer.invoke("omega:histosCondenseGraph", { ...query, ...(budget === undefined ? {} : { budget }), ...(parentSha === undefined ? {} : { parentSha }), ...(provider === undefined ? {} : { provider }), ...(modelId === undefined ? {} : { modelId }) });
  },
  histosExecuteFlow: (req) => {
    const sha256 = req?.sha256;
    return typeof sha256 === "string" && HISTOS_SHA256.test(sha256) ? ipcRenderer.invoke("omega:histosExecuteFlow", { sha256 }) : invalidHistos("flow artifact sha256 is required");
  },
  histosSaveViewState: (req) => {
    const query = histosQuery(req);
    const positions = Array.isArray(req?.positions) ? req.positions.slice(0, 500).map((position) => typeof position?.id === "string" && Number.isFinite(position.x) && Number.isFinite(position.y) ? { id: position.id, x: position.x, y: position.y } : null) : [];
    if (!query || positions.some((position) => position === null) || (req?.positions?.length ?? 0) > 500) return invalidHistos("positions and query are required");
    return ipcRenderer.invoke("omega:histosSaveViewState", { ...query, positions });
  },
  histosGetViewState: (req) => {
    const query = histosQuery(req);
    return query ? ipcRenderer.invoke("omega:histosGetViewState", query) : invalidHistos("sourceSet, lens, and granularity are required");
  },
  histosRebuild: (req) => {
    const query = histosQuery(req);
    if (!query) return invalidHistos("sourceSet, lens, and granularity are required");
    const maxFiles = req?.maxFiles;
    if (maxFiles !== undefined && (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 100000)) return invalidHistos("maxFiles is out of bounds");
    return ipcRenderer.invoke("omega:histosRebuild", { ...query, ...(maxFiles === undefined ? {} : { maxFiles }) });
  },
  histosApplyWebResources: (req) => {
    const urls = Array.isArray(req?.urls) ? req.urls : undefined;
    const resources = Array.isArray(req?.resources) ? req.resources : undefined;
    if (!urls && !resources) return invalidHistos("urls or resources are required");
    const granularity = req?.granularity === "span" ? "span" : "entry";
    return ipcRenderer.invoke("omega:histosApplyWebResources", {
      granularity,
      ...(urls ? { urls } : {}),
      ...(resources ? { resources } : {}),
      ...(Number.isSafeInteger(req?.timeoutMs) ? { timeoutMs: req.timeoutMs } : {}),
      ...(Number.isSafeInteger(req?.chunkLength) ? { chunkLength: req.chunkLength } : {}),
    });
  },
  histosApplyAgentActivity: (req) => {
    const specs = Array.isArray(req?.specs) ? req.specs : [];
    const runs = Array.isArray(req?.runs) ? req.runs : [];
    if (specs.length === 0 && runs.length === 0) return invalidHistos("specs or runs are required");
    return ipcRenderer.invoke("omega:histosApplyAgentActivity", {
      ...(specs.length ? { specs } : {}),
      ...(runs.length ? { runs } : {}),
    });
  },
  histosApplyEvalResults: (req) => {
    const results = Array.isArray(req?.results) ? req.results : [];
    if (results.length === 0 || results.length > 256 || results.some((result) => !isPlainObject(result))) return invalidHistos("results are required");
    return ipcRenderer.invoke("omega:histosApplyEvalResults", { results });
  },
  histosListCapabilities: (req) => ipcRenderer.invoke("omega:histosListCapabilities", req && isPlainObject(req) ? { names: Array.isArray(req.names) ? req.names.slice(0, 64) : undefined } : {}),
  histosInvokeNode: (req) => {
    if (!isPlainObject(req) || !histosString(req.nodeId, 512)) return invalidHistos("nodeId is required");
    const payload = { nodeId: req.nodeId.slice(0, 512) };
    if (typeof req.revisionId === "string") payload.revisionId = req.revisionId;
    if (typeof req.prompt === "string") payload.prompt = req.prompt.slice(0, MAX_PROMPT_CHARS);
    if (req.args !== undefined && !histosJson(req.args)) return invalidHistos("args must be JSON values");
    if (req.args !== undefined) payload.args = req.args;
    if (req.dryRun === true) payload.dryRun = true;
    return ipcRenderer.invoke("omega:histosInvokeNode", payload);
  },
  histosGetNode: (req) => {
    const query = histosQuery(req);
    const nodeId = req?.nodeId ?? req?.id;
    return query && histosString(nodeId, 512) ? ipcRenderer.invoke("omega:histosGetNode", { ...query, nodeId }) : invalidHistos("nodeId and query are required");
  },
  histosFreezeContext: (req) => {
    const query = histosQuery(req);
    const selection = Array.isArray(req?.selection) ? req.selection.slice(0, 2000).map(histosSelection) : [];
    if (!query || selection.length === 0 || selection.some((item) => item === null)) return invalidHistos("selection and query are required");
    if (req?.selection?.length > 2000) return invalidHistos("selection is too large");
    if (req?.targetSessionId !== undefined && !histosString(req.targetSessionId, 128)) return invalidHistos("targetSessionId is invalid");
    if (req?.budget !== undefined && (!Number.isSafeInteger(req.budget) || req.budget < 1 || req.budget > 64000)) return invalidHistos("budget is out of bounds");
    return ipcRenderer.invoke("omega:histosFreezeContext", { ...query, selection, ...(req?.targetSessionId === undefined ? {} : { targetSessionId: req.targetSessionId }), ...(req?.budget === undefined ? {} : { budget: req.budget }) });
  },
  histosConvertToFlow: (req) => {
    const query = histosQuery(req);
    if (!query) return invalidHistos("sourceSet, lens, and granularity are required");
    const selectedNodeRevisionIds = Array.isArray(req?.selectedNodeRevisionIds) && req.selectedNodeRevisionIds.length > 0 && req.selectedNodeRevisionIds.length <= 2000
      ? req.selectedNodeRevisionIds.slice(0, 2000).filter((id) => histosString(id, 512))
      : undefined;
    if (selectedNodeRevisionIds !== undefined && selectedNodeRevisionIds.length === 0) return invalidHistos("selectedNodeRevisionIds contains invalid entries");
    const selectedEdgeRevisionIds = Array.isArray(req?.selectedEdgeRevisionIds) && req.selectedEdgeRevisionIds.length > 0 && req.selectedEdgeRevisionIds.length <= 2000
      ? req.selectedEdgeRevisionIds.slice(0, 2000).filter((id) => histosString(id, 512))
      : undefined;
    if (selectedEdgeRevisionIds !== undefined && selectedEdgeRevisionIds.length === 0) return invalidHistos("selectedEdgeRevisionIds contains invalid entries");
    const parentSha = req?.parentSha !== undefined && histosString(req.parentSha, 64) && HISTOS_SHA256.test(req.parentSha) ? req.parentSha : undefined;
    if (req?.parentSha !== undefined && parentSha === undefined) return invalidHistos("parentSha is invalid");
    return ipcRenderer.invoke("omega:histosConvertToFlow", { ...query, ...(selectedNodeRevisionIds === undefined ? {} : { selectedNodeRevisionIds }), ...(selectedEdgeRevisionIds === undefined ? {} : { selectedEdgeRevisionIds }), ...(parentSha === undefined ? {} : { parentSha }) });
  },
  histosGetArtifact: (req) => {
    const query = histosQuery(req);
    const sha256 = req?.sha256 ?? req?.hash;
    return query && typeof sha256 === "string" && HISTOS_SHA256.test(sha256) ? ipcRenderer.invoke("omega:histosGetArtifact", { ...query, sha256 }) : invalidHistos("sha256 and query are required");
  },
  histosDiffGraphs: (req) => {
    const prev = req && isPlainObject(req.prev) ? histosQuery(req.prev) : null;
    const next = req && isPlainObject(req.next) ? histosQuery(req.next) : null;
    const prevSha = req?.prev?.sha256 ?? req?.prev?.hash;
    const nextSha = req?.next?.sha256 ?? req?.next?.hash;
    if (!prev || !next || !HISTOS_SHA256.test(String(prevSha)) || !HISTOS_SHA256.test(String(nextSha))) {
      return invalidHistos("prev and next need a sha256 and a query");
    }
    return ipcRenderer.invoke("omega:histosDiffGraphs", { prev: { ...prev, sha256: prevSha }, next: { ...next, sha256: nextSha } });
  },
  setPermissionProfile: (req) => {
    const allowed = ["trusted", "workspace-only", "read-only", "ask-before-command"];
    if (!req || typeof req.profile !== "string" || !allowed.includes(req.profile)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "profile must be a supported permission profile" });
    }
    return ipcRenderer.invoke("omega:setPermissionProfile", { profile: req.profile });
  },
  histosDistillResource: (req) => {
    const allowed = ["skill", "extension", "prompt"];
    const kind = req && typeof req.kind === "string" ? req.kind : "";
    const name = req && typeof req.name === "string" ? req.name.trim() : "";
    const filePath = req && typeof req.filePath === "string" ? req.filePath.trim() : "";
    if (!allowed.includes(kind) || !name || name.length > 256 || !filePath || filePath.length > 1024) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "kind, name, and filePath are required" });
    }
    return ipcRenderer.invoke("omega:histosDistillResource", { kind, name, filePath });
  },
  histosSuggestContext: (req) => {
    const query = typeof req?.query === "string" ? req.query.trim().slice(0, 512) : "";
    const terms = Array.isArray(req?.terms) ? req.terms.filter((term) => typeof term === "string" && term.trim().length >= 2 && term.trim().length <= 64).slice(0, 8) : [];
    if (!query && terms.length === 0) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "query or terms are required" });
    }
    const limit = Number.isSafeInteger(req?.limit) && req.limit >= 1 && req.limit <= 16 ? req.limit : undefined;
    return ipcRenderer.invoke("omega:histosSuggestContext", query ? { query, ...(limit === undefined ? {} : { limit }) } : { terms, ...(limit === undefined ? {} : { limit }) });
  },
  histosQueryFacts: (req) => {
    const payload = req && typeof req === "object" ? req : {};
    return ipcRenderer.invoke("omega:histosQueryFacts", payload);
  },
  histosWriteFacts: (req) => {
    if (!req || !Array.isArray(req.triples) || req.triples.length === 0 || req.triples.length > 256) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "triples must be a non-empty array of at most 256 entries" });
    }
    return ipcRenderer.invoke("omega:histosWriteFacts", { triples: req.triples.slice(0, 256) });
  },
  histosFactStats: () => ipcRenderer.invoke("omega:histosFactStats", {}),
  histosClearFacts: () => ipcRenderer.invoke("omega:histosClearFacts", {}),
  histosArchive: (req) => {
    const kinds = ["triple", "node", "edge", "artifact", "session_index"];
    if (!req || !kinds.includes(req.kind) || !Array.isArray(req.ids) || req.ids.length === 0 || req.ids.length > 512) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "kind must be triple/node/edge/artifact/session_index with 1..512 ids" });
    }
    const ids = req.ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 512);
    if (ids.length !== req.ids.length) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "each id must be a string of at most 512 characters" });
    }
    if (req.reason !== undefined && req.reason !== null && (typeof req.reason !== "string" || req.reason.length === 0 || req.reason.length > 512)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "reason must be a string of at most 512 characters" });
    }
    return ipcRenderer.invoke("omega:histosArchive", { kind: req.kind, ids, ...(req.reason ? { reason: req.reason } : {}) });
  },
  histosRestore: (req) => {
    if (!req || !Array.isArray(req.tombstoneIds) || req.tombstoneIds.length === 0 || req.tombstoneIds.length > 512) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "tombstoneIds must be a non-empty array of at most 512 tombstone ids" });
    }
    const tombstoneIds = req.tombstoneIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64);
    if (tombstoneIds.length !== req.tombstoneIds.length) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "each tombstone id must be a string of at most 64 characters" });
    }
    return ipcRenderer.invoke("omega:histosRestore", { tombstoneIds });
  },
  histosListTombstones: (req) => {
    if (req !== undefined && req !== null) {
      if (typeof req !== "object" || req === null || Array.isArray(req)) {
        return Promise.resolve({ ok: false, code: "invalid_args", message: "request must be an object" });
      }
      if (req.limit !== undefined && (typeof req.limit !== "number" || !Number.isSafeInteger(req.limit) || req.limit < 1 || req.limit > 1000)) {
        return Promise.resolve({ ok: false, code: "invalid_args", message: "limit must be an integer between 1 and 1000" });
      }
      if (req.includeRevoked !== undefined && typeof req.includeRevoked !== "boolean") {
        return Promise.resolve({ ok: false, code: "invalid_args", message: "includeRevoked must be a boolean" });
      }
    }
    return ipcRenderer.invoke("omega:histosListTombstones", req ?? {});
  },
  histosPurge: (req) => {
    const kinds = ["triple", "node", "edge", "artifact", "session_index"];
    if (!req || !kinds.includes(req.kind) || !Array.isArray(req.ids) || req.ids.length === 0 || req.ids.length > 512) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "kind must be triple/node/edge/artifact/session_index with 1..512 ids" });
    }
    const ids = req.ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 512);
    if (ids.length !== req.ids.length) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "each id must be a string of at most 512 characters" });
    }
    if (req.reason !== undefined && req.reason !== null && (typeof req.reason !== "string" || req.reason.length === 0 || req.reason.length > 512)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "reason must be a string of at most 512 characters" });
    }
    return ipcRenderer.invoke("omega:histosPurge", { kind: req.kind, ids, ...(req.reason ? { reason: req.reason } : {}) });
  },
  histosIndexRepo: (req) => {
    const payload = req && typeof req === "object" ? req : {};
    const maxFiles = Number.isSafeInteger(payload.maxFiles) && payload.maxFiles >= 1 && payload.maxFiles <= 4000 ? payload.maxFiles : undefined;
    const maxDepth = Number.isSafeInteger(payload.maxDepth) && payload.maxDepth >= 1 && payload.maxDepth <= 12 ? payload.maxDepth : undefined;
    return ipcRenderer.invoke("omega:histosIndexRepo", { ...(maxFiles === undefined ? {} : { maxFiles }), ...(maxDepth === undefined ? {} : { maxDepth }) });
  },
  onHistosEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => {
      if (!data || typeof data !== "object" || typeof data.eventType !== "string") return;
      try { callback({ eventType: data.eventType, payload: data.payload ?? {} }); } catch (error) { console.error("omega histos event callback failed", error); }
    };
    ipcRenderer.on("histos:event", handler);
    return () => ipcRenderer.removeListener("histos:event", handler);
  },
  histosImportContext: (req) => {
    const sourceWorkspaceId = req && typeof req.sourceWorkspaceId === "string" ? req.sourceWorkspaceId.trim().slice(0, 128) : "";
    const sourceSha256 = req && typeof req.sourceSha256 === "string" ? req.sourceSha256.trim().toLowerCase() : "";
    if (!sourceWorkspaceId || !/^[0-9a-f]{64}$/.test(sourceSha256)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "sourceWorkspaceId and a 64-hex sourceSha256 are required" });
    }
    const budget = Number.isSafeInteger(req?.budget) && req.budget >= 1 && req.budget <= 64000 ? req.budget : undefined;
    return ipcRenderer.invoke("omega:histosImportContext", budget === undefined ? { sourceWorkspaceId, sourceSha256 } : { sourceWorkspaceId, sourceSha256, budget });
  },
  setModeProfile: (req) => {
    const allowed = ["default", "plan", "goal"];
    if (!req || typeof req.mode !== "string" || !allowed.includes(req.mode)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "mode must be a supported mode profile" });
    }
    return ipcRenderer.invoke("omega:setModeProfile", { mode: req.mode });
  },
  planReview: () => ipcRenderer.invoke("omega:planReview", {}),
  approvePlan: () => ipcRenderer.invoke("omega:approvePlan", {}),
  permissionRulesList: () => ipcRenderer.invoke("omega:permissionRulesList", {}),
  permissionRulesAdd: (req) => {
    const permission = req && typeof req.permission === "string" ? req.permission.trim().slice(0, 128) : "";
    const pattern = req && typeof req.pattern === "string" ? req.pattern.slice(0, 2048) : "*";
    const action = req && typeof req.action === "string" ? req.action : "";
    if (!permission || !["allow", "ask", "deny"].includes(action)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "permission and an allow/ask/deny action are required" });
    }
    return ipcRenderer.invoke("omega:permissionRulesAdd", { permission, pattern, action, project: req?.project === true });
  },
  permissionRulesRemove: (req) => {
    const id = req && typeof req.id === "string" ? req.id.trim().slice(0, 64) : "";
    const scope = req && req.scope === "project" ? "project" : "user";
    if (!/^(user|project):\d+$/.test(id)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "a user:N or project:N rule id is required" });
    }
    return ipcRenderer.invoke("omega:permissionRulesRemove", { id, scope });
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
  setSessionName: (req) => {
    if (!req || typeof req.name !== "string" || !req.name.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "name must be a non-empty string" });
    }
    const payload = { name: req.name.trim().slice(0, 256) };
    if (typeof req.sessionId === "string" && req.sessionId.trim()) payload.sessionId = req.sessionId.trim().slice(0, 128);
    return ipcRenderer.invoke("omega:setSessionName", payload);
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
  openFileDefault: (req) => {
    if (!req || typeof req.path !== "string" || !req.path.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "path is required" });
    return ipcRenderer.invoke("omega:openFileDefault", { path: req.path.slice(0, 4096) });
  },
  chooseFileForWorkspace: () => ipcRenderer.invoke("omega:chooseFileForWorkspace"),
  uploadFile: (req) => ipcRenderer.invoke("omega:uploadFile", { selectionId: safeString(req?.selectionId, 128) ?? "", path: safeString(req?.path, 4096) ?? "", conflict: req?.conflict, expectedToken: safeString(req?.expectedToken, 512) }),
  watchFile: (req) => {
    if (!req || typeof req.path !== "string" || !req.path.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "path is required" });
    return ipcRenderer.invoke("omega:watchFile", { path: req.path.slice(0, 4096) });
  },
  unwatchFile: (req) => {
    if (!req || typeof req.path !== "string" || !req.path.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "path is required" });
    return ipcRenderer.invoke("omega:unwatchFile", { path: req.path.slice(0, 4096) });
  },
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
  getToolDetail: (req) => {
    if (!req || typeof req.toolCallId !== "string" || !req.toolCallId.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "toolCallId is required" });
    return ipcRenderer.invoke("omega:getToolDetail", { toolCallId: req.toolCallId.slice(0, 256) });
  },
  telemetry: () => ipcRenderer.invoke("omega:telemetry"),
  projectSearch: (req) => {
    if (!req || typeof req.query !== "string" || !req.query.trim()) return Promise.resolve({ ok: false, code: "invalid_args", message: "query is required" });
    return ipcRenderer.invoke("omega:projectSearch", { query: req.query.slice(0, 256) });
  },
  checkpointList: () => ipcRenderer.invoke("omega:checkpointList"),
  checkpointCreate: (req) => {
    const label = req && typeof req.label === "string" ? req.label.trim().slice(0, 200) : "";
    return ipcRenderer.invoke("omega:checkpointCreate", { label });
  },
  checkpointRestore: (req) => {
    if (!req || typeof req.id !== "string" || !/^[0-9a-f]{40}$/.test(req.id)) return Promise.resolve({ ok: false, code: "invalid_args", message: "id is required" });
    return ipcRenderer.invoke("omega:checkpointRestore", { id: req.id });
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
  stageRemoteResource: (req) => {
    const url = req && typeof req.url === "string" ? req.url.trim() : "";
    if (!url || url.length > 2048 || !url.startsWith("https://")) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "https url is required" });
    }
    return ipcRenderer.invoke("omega:stageRemoteResource", { url });
  },
  registryFetch: (req) => {
    const url = req && typeof req.url === "string" ? req.url.trim() : "";
    if (!url || url.length > 2048 || !url.startsWith("https://")) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "https url is required" });
    }
    return ipcRenderer.invoke("omega:registryFetch", { url });
  },
  registryStage: (req) => {
    const url = req && typeof req.url === "string" ? req.url.trim() : "";
    if (!url || url.length > 2048 || !url.startsWith("https://")) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "https url is required" });
    }
    const names = Array.isArray(req?.names) ? req.names.filter((name) => typeof name === "string" && name.trim()).slice(0, 64).map((name) => name.slice(0, 64)) : null;
    return ipcRenderer.invoke("omega:registryStage", names ? { url, names } : { url });
  },
  flowScheduleCreate: (req) => {
    if (!isPlainObject(req) || typeof req.flowSha !== "string" || !/^[0-9a-f]{64}$/.test(req.flowSha)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "a 64-hex flowSha is required" });
    }
    const kind = req.kind === "daily" ? "daily" : req.kind === "interval" ? "interval" : null;
    if (!kind) return Promise.resolve({ ok: false, code: "invalid_args", message: "kind must be interval or daily" });
    const out = { flowSha: req.flowSha, kind, maxRuns: Number.isSafeInteger(req.maxRuns) ? req.maxRuns : undefined, project: req.project === true };
    if (kind === "interval") {
      if (!Number.isSafeInteger(req.intervalMinutes)) return Promise.resolve({ ok: false, code: "invalid_args", message: "intervalMinutes is required" });
      out.intervalMinutes = req.intervalMinutes;
    } else {
      if (typeof req.timeOfDay !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(req.timeOfDay)) {
        return Promise.resolve({ ok: false, code: "invalid_args", message: "timeOfDay must be HH:MM" });
      }
      out.timeOfDay = req.timeOfDay;
    }
    return ipcRenderer.invoke("omega:flowScheduleCreate", out);
  },
  flowScheduleList: () => ipcRenderer.invoke("omega:flowScheduleList", {}),
  flowScheduleRemove: (req) => {
    if (!isPlainObject(req) || typeof req.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(req.id)) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "a schedule id is required" });
    }
    return ipcRenderer.invoke("omega:flowScheduleRemove", { id: req.id });
  },
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
  mcpList: () => ipcRenderer.invoke("omega:mcpList", {}),
  mcpAdd: (req) => {
    if (!isPlainObject(req)) return Promise.resolve({ ok: false, code: "invalid_args", message: "req is required" });
    const auth = isPlainObject(req.auth)
      ? {
          authorizationUrl: safeString(req.auth.authorizationUrl, 2048),
          tokenUrl: safeString(req.auth.tokenUrl, 2048),
          clientId: safeString(req.auth.clientId, 256),
          ...(safeString(req.auth.clientSecret, 2048) ? { clientSecret: safeString(req.auth.clientSecret, 2048) } : {}),
          ...(Array.isArray(req.auth.scopes) ? { scopes: req.auth.scopes.slice(0, 16).map((scope) => safeString(scope, 128) ?? "") } : {}),
        }
      : undefined;
    return ipcRenderer.invoke("omega:mcpAdd", {
      name: safeString(req.name, 128)?.trim(),
      command: safeString(req.command, 4096),
      args: Array.isArray(req.args) ? req.args.slice(0, 64).map((arg) => safeString(arg, 4096) ?? "") : [],
      url: safeString(req.url, 2048),
      auth,
      project: req.project === true,
    });
  },
  mcpSetEnabled: (req) => {
    if (!isPlainObject(req) || typeof req.name !== "string") return Promise.resolve({ ok: false, code: "invalid_args", message: "name is required" });
    return ipcRenderer.invoke("omega:mcpSetEnabled", { name: req.name.slice(0, 128), enabled: req.enabled !== false, project: req.project === true });
  },
  mcpRemove: (req) => {
    if (!isPlainObject(req) || typeof req.name !== "string") return Promise.resolve({ ok: false, code: "invalid_args", message: "name is required" });
    return ipcRenderer.invoke("omega:mcpRemove", { name: req.name.slice(0, 128), project: req.project === true });
  },
  mcpLogin: (req) => {
    if (!isPlainObject(req) || typeof req.name !== "string" || !req.name.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "name is required" });
    }
    return ipcRenderer.invoke("omega:mcpLogin", { name: req.name.slice(0, 128), project: req.project === true });
  },

  ptyCreate: (req) => {
    const cols = req?.cols === undefined ? 80 : req.cols;
    const rows = req?.rows === undefined ? 24 : req.rows;
    if (!isPlainObject(req) || !validPtyString(req.sessionId, MAX_PTY_ID_LENGTH) || !validPtyString(req.cwd, MAX_PTY_CWD_LENGTH) || !validPtyDimensions(cols, rows)) return Promise.resolve({ ok: false, code: "invalid_args", message: "Invalid PTY create request" });
    return ipcRenderer.invoke("omega:ptyCreate", { sessionId: req.sessionId, cwd: req.cwd, cols, rows });
  },
  ptyWrite: (req) => {
    if (!isPlainObject(req) || !validPtyString(req.sessionId, MAX_PTY_ID_LENGTH) || typeof req.data !== "string" || CONTROL_CHARS.test(req.data) || Buffer.byteLength(req.data, "utf8") > MAX_PTY_WRITE_BYTES) return Promise.resolve({ ok: false, code: "invalid_args", message: "Invalid PTY write request" });
    return ipcRenderer.invoke("omega:ptyWrite", { sessionId: req.sessionId, data: req.data });
  },
  ptyResize: (req) => {
    if (!isPlainObject(req) || !validPtyString(req.sessionId, MAX_PTY_ID_LENGTH) || !validPtyDimensions(req.cols, req.rows)) return Promise.resolve({ ok: false, code: "invalid_args", message: "Invalid PTY resize request" });
    return ipcRenderer.invoke("omega:ptyResize", { sessionId: req.sessionId, cols: req.cols, rows: req.rows });
  },
  ptyKill: (req) => {
    if (!isPlainObject(req) || !validPtyString(req.sessionId, MAX_PTY_ID_LENGTH)) return Promise.resolve({ ok: false, code: "invalid_args", message: "Invalid PTY kill request" });
    return ipcRenderer.invoke("omega:ptyKill", { sessionId: req.sessionId });
  },
  onPtyData: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => { if (!validPtyData(data)) return; try { callback({ sessionId: data.sessionId, chunk: data.chunk, sequence: data.sequence, isFinal: data.isFinal }); } catch {} };
    ipcRenderer.on("pty:data", handler);
    return () => ipcRenderer.removeListener("pty:data", handler);
  },
  onPtyExit: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => { if (!validPtyExit(data)) return; try { callback({ sessionId: data.sessionId, exitCode: data.exitCode, signal: data.signal }); } catch {} };
    ipcRenderer.on("pty:exit", handler);
    return () => ipcRenderer.removeListener("pty:exit", handler);
  },

  // ----- sessions -----
  listSessions: (req) => ipcRenderer.invoke("omega:listSessions", {
    offset: Number.isInteger(req?.offset) ? req.offset : 0,
    limit: Number.isInteger(req?.limit) ? req.limit : 100,
  }),
  activitySnapshot: () => ipcRenderer.invoke("omega:activitySnapshot", {}),
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
  deleteSession: (req) => {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId.trim()) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "sessionId is required" });
    }
    return ipcRenderer.invoke("omega:deleteSession", { sessionId: req.sessionId });
  },

  // ----- diff + approval -----
  approveChange: (req) => {
    if (!req || (req.action !== "accept" && req.action !== "reject")) {
      return Promise.resolve({ ok: false, code: "invalid_args", message: "action must be accept|reject" });
    }
    const files = Array.isArray(req.files)
      ? req.files.filter((f) => typeof f === "string").map((f) => f.slice(0, 4096)).slice(0, 2000)
      : undefined;
    const items = Array.isArray(req.items)
      ? req.items
          .filter((item) => item && typeof item.path === "string")
          .map((item) => ({
            path: item.path.slice(0, 4096),
            ...(Array.isArray(item.hunks)
              ? { hunks: item.hunks.filter((hunk) => typeof hunk === "string").map((hunk) => hunk.slice(0, MAX_FIELD_CHARS)).slice(0, 200) }
              : {}),
          }))
          .slice(0, 2000)
      : undefined;
    return ipcRenderer.invoke("omega:approveChange", { action: req.action, snapshotToken: safeString(req.snapshotToken, 128), files, items });
  },
});
