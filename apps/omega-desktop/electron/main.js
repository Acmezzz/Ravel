/**
 * Electron main process — UI host + IPC surface.
 *
 * R4: the agent runtime lives in a utilityProcess worker (electron/worker.mjs,
 * architecture ported from pi-app, MIT). Main owns the window, all privileged
 * fs/git operations, and proxies every agent RPC to the worker with
 * requestId correlation + timeouts. A crashing extension no longer kills the
 * window. Renderer-facing IPC contracts are unchanged.
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  screen,
  session as electronSession,
  shell,
  dialog,
  safeStorage,
} from "electron";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, watch } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat, writeFile as writeFileAsync } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { forgetSessionPath, piSessionsRoot, THINKING_LEVELS, resolveSessionPath } from "./agent-bridge.js";
import { buildSessionHtml } from "./export-html.js";
import * as stateReader from "./state-reader.js";
import * as diffService from "./diff-service.js";
import * as workspaceService from "./workspace-service.js";
import { createWorkspaceRegistry } from "./workspace-registry.js";
import { projectTrust } from "./project-trust.js";
import { canonicalInside, isInside, realRoot } from "./path-security.js";
import { appendSessionInfo, readSessionMessages, readSessionSummaries } from "./session-reader.js";
import { isIpcEnvelope } from "./ipc-contracts.js";
import { assertLocalSource } from "./resource-center.js";
import { isExtensionUIRequest, isExtensionUIResponse } from "./extension-ui-protocol.js";
import { CLOSE_DIALOG_BUTTONS, closeDecisionFromIndex } from "./close-lifecycle.js";
import { WorkerHost } from "./worker-host.js";
import { createWorkerSlotPool } from "./worker-pool.js";
import { createDesktopSettingsStore } from "./desktop-settings.js";
import { createCredentialStore } from "./credential-store.js";
import { PERMISSION_PROFILES, sanitizePermissionProfile, createPermissionGuard } from "./permission-profiles.js";
import { customProviderRequest, fileRequest, gitCommitRequest, gitStageRequest, replayRequest, sessionNameRequest, sessionRequest, workspaceRequest } from "./ipc-schemas.js";
import { sanitizeKeybindings } from "./keybindings.js";
import * as fileTransfer from "./file-transfer-service.js";

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = resolve(MAIN_DIR, "..", "..", "..");
const MAX_PROMPT_CHARS = 40_000;
const PROMPT_BEHAVIORS = ["steer", "followUp"];
const MAX_PROMPT_IMAGES = 4;
const MAX_IMAGE_CHARS = 8_000_000;
const WORKER_RPC_TIMEOUT = 120_000;
const CLOSE_FLUSH_TIMEOUT = 10_000;
const RECENT_EVENT_LIMIT = 300;
const RECENT_EVENT_MAX_BYTES = 4 * 1024 * 1024;
let win;
let worker = null;
let workerPool = createWorkerSlotPool();
let desktopSettings = null;
let credentialStore = null;
let bootstrapError = null;
let shuttingDown = false;
let quitRequested = false;
let activeCwd = null;
let agentReady = false;
let workspaceRegistry;
let closeDecision = null;
let closeHandling = false;
let closeApproved = false;
let singleInstancePrimary = true;
let startupRequest = { workspace: process.env.OMEGA_WORKSPACE ?? null, sessionId: null };
let persistBoundsTimer = null;
const fileSelections = new Map();
const fileWatchers = new Map();
const recentEventsBySession = new Map();
const recentEventBytesBySession = new Map();
const recentEventWrites = new Map();
const recentEventEpochs = new Map();

function parseStartupRequest(argv = process.argv) {
  const result = { workspace: process.env.OMEGA_WORKSPACE ?? null, sessionId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--workspace" && typeof argv[index + 1] === "string") result.workspace = argv[++index];
    else if (value === "--session" && typeof argv[index + 1] === "string") result.sessionId = argv[++index];
    else if (typeof value === "string" && value.startsWith("omega://")) {
      try {
        const url = new URL(value);
        result.workspace = url.searchParams.get("workspace") ?? result.workspace;
        result.sessionId = url.searchParams.get("session") ?? result.sessionId;
      } catch {
        /* ignore invalid deep links */
      }
    }
  }
  return result;
}

function rootOf() {
  return app.isPackaged ? (process.resourcesPath ? join(process.resourcesPath, "omega-runtime") : app.getAppPath()) : DEV_ROOT;
}

function extensionsRootOf() {
  return process.env.OMEGA_EXTENSIONS_ROOT ?? (app.isPackaged ? join(rootOf(), ".pi", "extensions") : join(DEV_ROOT, ".pi", "extensions"));
}

function workspaceRegistryFile() {
  return join(app.getPath("userData"), "omega", "workspaces.json");
}

function desktopSettingsFile() {
  return join(app.getPath("userData"), "omega", "desktop-settings.json");
}

function credentialStoreFile() {
  return join(app.getPath("userData"), "omega", "credentials.bin.json");
}

function recentEventsFile(sessionId) {
  return join(app.getPath("userData"), "omega", "event-cache", `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);
}

function parseRecentEventLines(raw) {
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-RECENT_EVENT_LIMIT)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((item) => item && item.event && item.meta);
}

async function trimRecentEventsFile(file) {
  try {
    const info = await stat(file);
    if (info.size <= RECENT_EVENT_MAX_BYTES) return;
    const lines = parseRecentEventLines(await readFile(file, "utf8"));
    const bounded = [];
    let bytes = 0;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = `${JSON.stringify(lines[index])}\n`;
      const size = Buffer.byteLength(line);
      if (bounded.length >= RECENT_EVENT_LIMIT || bytes + size > RECENT_EVENT_MAX_BYTES) break;
      bounded.unshift(line);
      bytes += size;
    }
    const temp = `${file}.tmp-${process.pid}`;
    await writeFileAsync(temp, bounded.join(""), "utf8");
    await rename(temp, file);
  } catch {
    /* cache trimming is best effort */
  }
}

function enqueueRecentEvent(sessionId, payload) {
  const file = recentEventsFile(sessionId);
  const epoch = recentEventEpochs.get(sessionId) ?? 0;
  const previous = recentEventWrites.get(sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      if ((recentEventEpochs.get(sessionId) ?? 0) !== epoch) return;
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(payload)}\n`, "utf8");
      await trimRecentEventsFile(file);
    })
    .catch(() => {})
    .finally(() => {
      if (recentEventWrites.get(sessionId) === next) recentEventWrites.delete(sessionId);
    });
  recentEventWrites.set(sessionId, next);
}

function authorizedWorkspace(value) {
  if (!workspaceRegistry) {
    const error = new Error("Workspace registry is not ready");
    error.code = "workspace_registry_unavailable";
    throw error;
  }
  return workspaceRegistry.resolveAuthorized(value);
}

/** Bounded flush; on timeout ("wait" path only) offer an explicit force-exit risk prompt. */
async function flushWithRiskPrompt(decision) {
  const hosts = workerPool.list().map((slot) => slot.host).filter(Boolean);
  for (;;) {
    try {
      await Promise.race([
        Promise.all(hosts.map((host) => host.call?.("flush").catch(() => {}))),
        new Promise((_, reject) => setTimeout(() => reject(new Error("close_flush_timeout")), CLOSE_FLUSH_TIMEOUT)),
      ]);
      return true;
    } catch {
      // Stop already aborted the run, so its flush is bounded — go through.
      if (decision === "stop") return true;
      if (!win || win.isDestroyed()) return false;
      const choice = await dialog.showMessageBox(win, {
        type: "warning",
        title: "保存超时",
        message: "会话保存超时，Agent 可能仍在生成。",
        detail: "强制退出可能丢失最后一条回复记录。",
        buttons: ["继续等待", "强制退出"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response === 1) return true;
    }
  }
}

async function runCloseSequence(finish) {
  const decision = await requestCloseDecision();
  if (decision === "cancel") return;
  sendTransportState("closing");
  if (decision === "stop") {
    for (const slot of workerPool.list()) {
      try {
        await slot.host?.call?.("abort");
      } catch {
        /* best effort */
      }
    }
  }
  sendTransportState("flushing");
  if (!(await flushWithRiskPrompt(decision))) return;
  sendTransportState("exiting");
  closeApproved = true;
  finish();
}

function sendTransportState(state, extra = {}) {
  if (win && !win.isDestroyed()) win.webContents.send("worker:transport", { state, ...extra });
}

function isAgentBusy() {
  return workerPool.hasRunning();
}

function isForegroundBusy() {
  return Boolean(workerPool.foreground()?.running);
}

async function requestCloseDecision() {
  if (!isAgentBusy()) return "wait";
  if (closeDecision) return closeDecision;
  closeDecision = dialog
    .showMessageBox(win, {
      type: "warning",
      title: "Omega 正在运行",
      message: "Agent 仍在生成回复。请选择关闭方式。",
      detail: "等待完成会保留当前会话；停止并退出会中止当前生成。",
      buttons: [...CLOSE_DIALOG_BUTTONS],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    .then((result) => closeDecisionFromIndex(result.response))
    .finally(() => {
      closeDecision = null;
    });
  return closeDecision;
}

function validWindowBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
  if (visible) return bounds;
  const primary = screen.getPrimaryDisplay().workArea;
  return { ...bounds, x: primary.x + 40, y: primary.y + 40, maximized: false };
}

function windowOptions() {
  const bounds = validWindowBounds(desktopSettings?.get()?.windowBounds);
  return {
    ...(bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : { width: 1180, height: 820 }),
    minWidth: 760,
    minHeight: 560,
    show: false,
  };
}

function stopFileWatch(filePath) {
  const watcher = fileWatchers.get(filePath);
  if (watcher) watcher.close();
  fileWatchers.delete(filePath);
}

function startFileWatch(filePath) {
  stopFileWatch(filePath);
  if (fileWatchers.size >= 16) {
    const oldest = fileWatchers.keys().next().value;
    if (oldest) stopFileWatch(oldest);
  }
  try {
    const watcher = watch(filePath, { persistent: false }, () => {
      if (win && !win.isDestroyed()) win.webContents.send("file:changed", { path: filePath });
    });
    watcher.on("error", () => stopFileWatch(filePath));
    fileWatchers.set(filePath, watcher);
  } catch {
    /* watching is best effort */
  }
}

function stopAllFileWatches() {
  for (const filePath of [...fileWatchers.keys()]) stopFileWatch(filePath);
}

function pruneFileSelections() {
  const now = Date.now();
  for (const [id, selection] of fileSelections) {
    if (!selection || now - selection.createdAt > 10 * 60_000) fileSelections.delete(id);
  }
  while (fileSelections.size > 32) {
    const oldest = fileSelections.keys().next().value;
    fileSelections.delete(oldest);
  }
}

function forgetSessionEvents(sessionId) {
  if (!sessionId) return;
  recentEventEpochs.set(sessionId, (recentEventEpochs.get(sessionId) ?? 0) + 1);
  recentEventWrites.delete(sessionId);
  recentEventBytesBySession.delete(sessionId);
  recentEventsBySession.delete(sessionId);
  try {
    const cacheFile = recentEventsFile(sessionId);
    if (existsSync(cacheFile)) unlinkSync(cacheFile);
  } catch {
    /* best effort */
  }
  forgetSessionPath(sessionId);
}

function persistWindowBounds() {
  if (!win || win.isDestroyed() || !desktopSettings) return;
  clearTimeout(persistBoundsTimer);
  persistBoundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    desktopSettings.update({ windowBounds: { ...bounds, maximized: win.isMaximized() } });
  }, 150);
}

function focusMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function rendererPath() {
  const candidate = app.isPackaged ? join(app.getAppPath(), "index.html") : join(MAIN_DIR, "..", "index.html");
  if (!existsSync(candidate)) throw new Error(`Renderer entry not found: ${candidate}`);
  return candidate;
}

function expectedPageUrl() {
  return pathToFileURL(rendererPath()).toString();
}

function senderAllowed(event) {
  return Boolean(win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
}

function errorResult(code, message) {
  return { ok: false, code, message };
}

function okResult(data) {
  return { ok: true, data: data };
}

function assertIpcResult(value) {
  if (!isIpcEnvelope(value)) throw new Error("invalid_ipc_envelope");
  return value;
}

function persistSessionRecovery(sessionId, patch) {
  if (!desktopSettings || !sessionId) return;
  const current = desktopSettings.get().sessionRecovery ?? {};
  desktopSettings.update({ sessionRecovery: { ...current, [sessionId]: { ...(current[sessionId] ?? {}), ...patch, updatedAt: new Date().toISOString() } } });
}

function bindHost(host) {
  host.onEvent = (event, meta) => {
    try {
      const sessionId = meta?.sessionId ?? host.sessionId;
      if (event?.type === "agent_start" || event?.type === "turn_start") {
        workerPool.markRunning(sessionId, true);
        persistSessionRecovery(sessionId, { state: "running", running: true, error: null });
      }
    if (event?.type === "agent_end" || event?.type === "turn_end" || event?.type === "agent_settled") {
      workerPool.markRunning(sessionId, false);
      persistSessionRecovery(sessionId, { state: "ready", running: false, error: null });
    }
    if (event?.type === "error") {
      workerPool.markRunning(sessionId, false);
      persistSessionRecovery(sessionId, { state: "error", running: false, error: typeof event.message === "string" ? event.message : "Agent error" });
    }
    if (event?.type === "auto_retry_start") persistSessionRecovery(sessionId, { state: "retrying", running: true, retryAttempt: event.attempt, retryMaxAttempts: event.maxAttempts, retryDelayMs: event.delayMs, error: event.errorMessage ?? null });
    if (event?.type === "auto_retry_end") persistSessionRecovery(sessionId, { state: event.status === "done" ? "ready" : "error", running: false, retryAttempt: event.attempt, error: event.finalError ?? null });
    if (meta?.sequence && sessionId) {
      const bucket = recentEventsBySession.get(sessionId) ?? [];
      const payload = { event, meta };
      bucket.push(payload);
      let bucketBytes = (recentEventBytesBySession.get(sessionId) ?? 0) + Buffer.byteLength(JSON.stringify(payload));
      while (bucket.length > RECENT_EVENT_LIMIT || bucketBytes > RECENT_EVENT_MAX_BYTES) {
        const removed = bucket.shift();
        bucketBytes -= removed ? Buffer.byteLength(JSON.stringify(removed)) : 0;
      }
      recentEventsBySession.set(sessionId, bucket);
      recentEventBytesBySession.set(sessionId, Math.max(0, bucketBytes));
      enqueueRecentEvent(sessionId, payload);
    }
      if (!win || win.isDestroyed()) return;
      win.webContents.send("agent:event", { event, meta });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendTransportState("diagnostic", { sessionId: host.sessionId, foreground: host === worker, error: message });
    }
  };
  host.onExtensionUIRequest = (request) => {
    if (!isExtensionUIRequest(request)) return;
    if (!win || win.isDestroyed()) return;
    win.webContents.send("extension-ui:request", request);
  };
  host.onTransport = (state, extra = {}) => {
    const foreground = host === worker;
    if (foreground) {
      agentReady = state === "ready";
    }
    persistSessionRecovery(host.sessionId, { state, running: Boolean(workerPool.get(host.sessionId)?.running), error: typeof extra.error === "string" ? extra.error : null });
    sendTransportState(state, { ...extra, sessionId: host.sessionId, foreground });
  };
  host.onSettled = () => {
    if (!win || win.isDestroyed() || win.isFocused()) return;
    if (!Notification.isSupported()) return;
    try {
      new Notification({ title: "Omega Desktop", body: "回复已完成，点击查看" }).show();
    } catch {
      /* best effort */
    }
  };
  return host;
}

function createBoundHost() {
  const host = new WorkerHost({ timeout: WORKER_RPC_TIMEOUT });
  if (credentialStore) {
    host.runtimeCredentials = Object.fromEntries(credentialStore.listIds().map((id) => [id, credentialStore.read(id)]).filter(([, value]) => typeof value === "string" && value.length > 0));
  }
  host.customProviders = desktopSettings?.get()?.customProviders ?? {};
  return bindHost(host);
}

async function sessionWorkspaceOf(sessionId) {
  try {
    const page = await readSessionSummaries(piSessionsRoot(), { offset: 0, limit: 5000 });
    return page.items.find((item) => item.id === sessionId)?.workspace ?? null;
  } catch {
    return null;
  }
}

async function reuseIdleWorkspaceSlot(sessionId, cwd) {
  const reusable = workerPool.reusableWorkspaceSlot(cwd, sessionId);
  if (!reusable) return null;
  const previousId = reusable.sessionId;
  await reusable.host.call("switchSession", { sessionId });
  workerPool.rekey(previousId, sessionId);
  const slot = workerPool.activate(sessionId);
  return adoptSlot(slot);
}

async function adoptSlot(slot) {
  worker = slot.host;
  activeCwd = slot.cwd ?? activeCwd;
  agentReady = slot.host?.state === "ready";
  return slot;
}

async function createNamedSession({ workspace, title } = {}) {
  if (isForegroundBusy() && worker?.state === "ready") return errorResult("session_busy", "生成中无法切换会话，请先停止或等待完成");
  let root;
  try {
    root = workspace ? authorizedWorkspace(workspace) : activeCwd ?? rootOf();
  } catch (error) {
    return errorResult(error?.code ?? "invalid_workspace", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("newSession", { workspace: root, title }, "write_failed");
  if (result.ok) rememberActive(result.data);
  return result;
}

async function loadNamedSession({ sessionId, workspace } = {}) {
  if (!sessionId) return errorResult("invalid_args", "sessionId is required");
  try {
    const existing = workerPool.get(sessionId);
    if (existing) {
      await adoptSlot(workerPool.activate(sessionId));
      const record = await worker.call("sessionRecord");
      rememberActive(record);
      return okResult(record);
    }
    if (isForegroundBusy() && worker?.state === "ready") {
      const nextWorkspace = workspace ? authorizedWorkspace(workspace) : (await sessionWorkspaceOf(sessionId)) ?? activeCwd ?? rootOf();
      const reused = await reuseIdleWorkspaceSlot(sessionId, nextWorkspace);
      if (reused) {
        const record = await worker.call("sessionRecord");
        rememberActive(record);
        return okResult(record);
      }
      await acquireSlot({ sessionId, cwd: nextWorkspace, projectTrusted: projectTrust.isTrusted(nextWorkspace) });
      const record = await worker.call("sessionRecord");
      rememberActive(record);
      return okResult(record);
    }
  } catch (error) {
    return errorResult(error?.code ?? "read_failed", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("switchSession", { sessionId }, "read_failed");
  if (result.ok) rememberActive(result.data);
  return result;
}

async function acquireSlot({ sessionId = null, cwd, projectTrusted, permissionProfile } = {}) {
  const slot = await workerPool.acquire({
    sessionId,
    cwd: cwd ?? activeCwd ?? rootOf(),
    extensionsRoot: extensionsRootOf(),
    projectTrusted: projectTrusted !== false,
    permissionProfile: permissionProfile ?? desktopSettings?.get()?.permissionProfile ?? "trusted",
    createHost: createBoundHost,
  });
  return adoptSlot(slot);
}

function rememberActive(record) {
  if (!record) return;
  if (record.id && worker) {
    const previousId = worker.sessionId;
    worker.sessionId = record.id;
    if (previousId && previousId !== record.id) workerPool.rekey(previousId, record.id);
    workerPool.activate(record.id);
  }
  if (record.workspace) {
    activeCwd = record.workspace;
    const slot = workerPool.foreground();
    if (slot) slot.cwd = record.workspace;
    if (worker) worker.cwd = record.workspace;
  }
  try {
    desktopSettings?.update({
      lastSessionId: record.id ?? null,
      lastWorkspace: record.workspace ?? activeCwd ?? null,
    });
  } catch {
    /* best effort */
  }
}

/** Wrap a worker RPC into an IpcResult, mapping worker error codes through. */
async function rpc(method, args, fallbackCode = "call_failed") {
  try {
    return assertIpcResult(okResult(await worker.call(method, args)));
  } catch (error) {
    return errorResult(error?.code ?? fallbackCode, error instanceof Error ? error.message : String(error));
  }
}

function authorizedRoots() {
  const roots = [];
  try {
    for (const item of workspaceRegistry?.list() ?? []) {
      if (item?.realRoot) roots.push(item.realRoot);
    }
  } catch {
    /* best effort */
  }
  if (activeCwd) roots.push(activeCwd);
  try {
    roots.push(rootOf());
  } catch {
    /* best effort */
  }
  return roots;
}

function isUnderAuthorizedRoot(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return false;
  const target = resolve(candidate);
  return authorizedRoots().some((root) => {
    try {
      return Boolean(canonicalInside(root, target));
    } catch {
      return false;
    }
  });
}

async function confirmPermission(title, message) {
  if (!win || win.isDestroyed()) return false;
  const choice = await dialog.showMessageBox(win, {
    type: "warning",
    title,
    message,
    buttons: ["拒绝", "允许"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return choice.response === 1;
}

async function assertBashAllowed(command) {
  const profile = desktopSettings?.get()?.permissionProfile ?? "trusted";
  const guard = createPermissionGuard({
    profile,
    cwd: activeCwd ?? rootOf(),
    confirm: confirmPermission,
  });
  await guard({ toolCall: { name: "bash" }, args: { command } });
}

async function bootstrap() {
  desktopSettings = createDesktopSettingsStore(desktopSettingsFile());
  startupRequest = parseStartupRequest();
  credentialStore = createCredentialStore(credentialStoreFile(), {
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (buffer) => safeStorage.decryptString(buffer),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    getSelectedStorageBackend: () => (typeof safeStorage.getSelectedStorageBackend === "function" ? safeStorage.getSelectedStorageBackend() : undefined),
  });
  const prefs = desktopSettings.get();
  workerPool = createWorkerSlotPool({ cap: prefs.workerCap, idleTtlMs: prefs.workerIdleTtlMs });
  workspaceRegistry = createWorkspaceRegistry(workspaceRegistryFile());
  const requested = startupRequest.workspace ? realRoot(resolve(startupRequest.workspace)) : realRoot(rootOf());
  const cwd = workspaceRegistry.has(requested) ? workspaceRegistry.resolveAuthorized(requested) : workspaceRegistry.add(requested);
  activeCwd = cwd;
  process.stdout.write(`[main] cwd=${cwd}\n`);
  const slot = await acquireSlot({ sessionId: startupRequest.sessionId, cwd, projectTrusted: projectTrust.isTrusted(cwd) });
  activeCwd = slot.cwd ?? cwd;
  agentReady = true;
  process.stdout.write("[main] agent worker ready\n");
}

function workspaceDto(workspace) {
  const trust = projectTrust.inspect(workspace.realRoot);
  return {
    ...workspace,
    active: Boolean(activeCwd && workspace.realRoot === activeCwd),
    trust: trust.decision,
    requiresTrust: trust.requiresTrust,
    resourcesDormant: trust.resourcesDormant,
  };
}

function listedWorkspaces() {
  return (workspaceRegistry?.prune() ?? []).map(workspaceDto);
}

function showBootstrapError(error) {
  bootstrapError = error instanceof Error ? error.stack ?? error.message : String(error);
}

function requireWorker() {
  if (!worker || shuttingDown) throw new Error("session not ready");
  return worker;
}

async function createWindow() {
  const frameless = process.platform === "win32";
  win = new BrowserWindow({
    ...windowOptions(),
    title: "Omega Desktop",
    frame: !frameless,
    webPreferences: {
      preload: join(MAIN_DIR, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      if (!app.isPackaged) win?.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === "F11") {
      if (win) win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.on("maximize", () => {
    persistWindowBounds();
    win?.webContents.send("window:maximizedChanged", true);
  });
  win.on("unmaximize", () => {
    persistWindowBounds();
    win?.webContents.send("window:maximizedChanged", false);
  });
  win.on("move", () => persistWindowBounds());
  win.on("resize", () => persistWindowBounds());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== expectedPageUrl()) event.preventDefault();
  });
  electronSession.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.on("console-message", (details) => {
    process.stdout.write(`[renderer] [${details.level}] ${details.message}\n`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    if (shuttingDown || !win || win.isDestroyed()) return;
    const reason = details?.reason ?? "unknown";
    sendTransportState("renderer-crashed", { reason, canRetry: true });
    void dialog.showMessageBox(win, { type: "error", title: "Omega 渲染器已停止", message: "界面进程已崩溃，可以重新加载界面。", detail: `原因：${reason}`, buttons: ["重新加载", "退出"] }).then(({ response }) => {
      if (!win || win.isDestroyed()) return;
      if (response === 0) win.webContents.reloadIgnoringCache();
      else void win.close();
    }).catch((error) => {
      process.stderr.write(`[main] crash dialog failed: ${String(error)}\n`);
    });
  });
  win.webContents.on("unresponsive", () => {
    if (!win || win.isDestroyed() || shuttingDown) return;
    sendTransportState("renderer-unresponsive", { canRetry: true });
  });
  win.on("focus", () => {
    if (!win || win.isDestroyed() || shuttingDown) return;
    win.webContents.send("worker:transport", { state: "reconcile", sessionId: worker?.sessionId ?? null, foreground: true });
  });
  win.on("close", (event) => {
    if (closeApproved) return;
    if (closeHandling || isAgentBusy()) {
      event.preventDefault();
      if (closeHandling) return;
      closeHandling = true;
      void runCloseSequence(() => win?.close()).catch((error) => {
        process.stderr.write(`[main] close sequence failed: ${String(error)}\n`);
      }).finally(() => {
        closeHandling = false;
      });
    }
  });
  win.on("closed", () => {
    persistWindowBounds();
    win = undefined;
  });
  if (desktopSettings?.get()?.windowBounds?.maximized) win.maximize();
  if (bootstrapError) {
    await win.loadFile(rendererPath());
    win.webContents.send("app:bootstrap-error", { message: bootstrapError.slice(0, 2_000) });
  } else {
    await win.loadFile(rendererPath());
  }
  win.show();
  if (process.env.OMEGA_AUTOTEST === "1" && worker) {
    setTimeout(() => {
      rpc("prompt", { text: "Reply with exactly: hello from omega-desktop" })
        .then(() => process.stdout.write("[main] autotest prompt: ok\n"))
        .then(() => rpc("sessionRecord"))
        .then((record) => {
          if (record.ok) process.stdout.write(`[main] autotest record: ${record.data.messages.length} messages\n`);
        })
        .catch((error) => process.stdout.write(`[main] autotest prompt failed: ${error instanceof Error ? error.message : String(error)}\n`));
    }, 500);
    setTimeout(async () => {
      if (process.env.OMEGA_DOMPROBE && win && !win.isDestroyed()) {
        try {
          const probe = await win.webContents.executeJavaScript(`(() => {
            const pick = (sel, props) => {
              const el = document.querySelector(sel);
              if (!el) return { sel, missing: true };
              const cs = getComputedStyle(el);
              return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
            };
            return JSON.stringify({
              htmlClass: document.documentElement.className,
              body: pick("body", ["color", "background-color"]),
              tab: pick(".MuiTab-root", ["color"]),
            });
          })()`);
          process.stdout.write(`[main] domprobe ${probe}\n`);
        } catch (error) {
          process.stdout.write(`[main] domprobe failed: ${String(error)}\n`);
        }
      }
      const forcedTheme = process.env.OMEGA_THEME;
      if (forcedTheme && win && !win.isDestroyed()) {
        try {
          await win.webContents.executeJavaScript(
            `localStorage.setItem("omega-theme", ${JSON.stringify(JSON.stringify(forcedTheme))})`,
          );
          await win.webContents.reload();
          await new Promise((resolveTimer) => setTimeout(resolveTimer, 4000));
        } catch (error) {
          process.stdout.write(`[main] theme force failed: ${String(error)}\n`);
        }
      }
      const screenshotPath = process.env.OMEGA_SCREENSHOT;
      if (screenshotPath && win && !win.isDestroyed()) {
        try {
          win.show();
          let saved = false;
          for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
            try {
              const image = await win.webContents.capturePage();
              if (!image.isEmpty()) {
                writeFileSync(screenshotPath, image.toPNG());
                saved = true;
              }
            } catch {
              /* capture can fail right after reload — retry */
            }
            if (!saved) await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
          }
          if (!saved) throw new Error("capturePage failed after retries");
          process.stdout.write(`[main] screenshot saved -> ${screenshotPath}\n`);
        } catch (error) {
          process.stdout.write(`[main] screenshot failed: ${String(error)}\n`);
        }
      }
      process.stdout.write("[main] autotest done, quitting\n");
      void shutdown().finally(() => app.quit());
    }, 25_000);
  }
}

// ---------------------------------------------------------------------------
// IPC: agent surface (proxied to the worker)
// ---------------------------------------------------------------------------

ipcMain.handle("omega:sessionReady", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return okResult({ ready: agentReady });
});

ipcMain.handle("window:minimize", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  win?.minimize();
  return okResult(undefined);
});

ipcMain.handle("window:toggleMaximize", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
  return okResult({ maximized: Boolean(win?.isMaximized()) });
});

ipcMain.handle("window:close", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  win?.close();
  return okResult(undefined);
});

ipcMain.handle("omega:listWorkspaces", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return okResult(listedWorkspaces());
});

ipcMain.handle("omega:removeWorkspace", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req?.workspace || typeof req.workspace !== "string") return errorResult("invalid_args", "workspace is required");
  if (isAgentBusy()) return errorResult("session_busy", "生成中无法移除工作区，请先停止或等待完成");
  let root;
  try {
    root = authorizedWorkspace(req.workspace);
  } catch (error) {
    return errorResult(error?.code ?? "workspace_not_authorized", error instanceof Error ? error.message : String(error));
  }
  if (activeCwd && root === activeCwd) {
    return errorResult("workspace_in_use", "不能移除当前正在使用的工作区");
  }
  workspaceRegistry.remove(root);
  return okResult(listedWorkspaces());
});

ipcMain.handle("omega:inspectProjectTrust", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const target = typeof req?.workspace === "string" && req.workspace.trim() ? req.workspace : activeCwd;
  if (!target) return errorResult("invalid_args", "workspace is required");
  try {
    const root = authorizedWorkspace(target);
    return okResult(projectTrust.inspect(root));
  } catch (error) {
    return errorResult(error?.code ?? "workspace_not_authorized", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:decideProjectTrust", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (isAgentBusy()) return errorResult("session_busy", "生成中无法更改项目信任，请先停止或等待完成");
  if (!req?.workspace || typeof req.workspace !== "string") return errorResult("invalid_args", "workspace is required");
  if (!["once", "always", "never"].includes(req?.decision)) {
    return errorResult("invalid_args", "decision must be once, always, or never");
  }
  try {
    const root = authorizedWorkspace(req.workspace);
    const trust = projectTrust.decide(root, req.decision);
    if (activeCwd && root === activeCwd) {
      const sessionId = worker?.sessionId ?? null;
      await workerPool.disposeAll();
      worker = null;
      const slot = await acquireSlot({ sessionId, cwd: root, projectTrusted: trust.decision === "trusted" });
      return okResult({ trust, reloaded: true, sessionId: slot.sessionId, workspaces: listedWorkspaces() });
    }
    return okResult({ trust, reloaded: false, workspaces: listedWorkspaces() });
  } catch (error) {
    return errorResult(error?.code ?? "invalid_args", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:retryWorker", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (worker && (worker.state === "ready" || worker.state === "starting" || worker.state === "restarting")) {
    return okResult({ state: worker.state });
  }
  const cwd = activeCwd ?? rootOf();
  const sessionId = worker?.sessionId ?? workerPool.foreground()?.sessionId ?? null;
  try {
    if (sessionId) await workerPool.dispose(sessionId);
    const slot = await acquireSlot({ sessionId, cwd, projectTrusted: projectTrust.isTrusted(cwd) });
    return okResult({ state: "ready", sessionId: slot.sessionId, cwd: activeCwd });
  } catch (error) {
    agentReady = false;
    return errorResult("worker_unavailable", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:chooseWorkspace", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (isForegroundBusy()) return errorResult("session_busy", "生成中无法切换工作区，请先停止或等待完成");
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory", "promptToCreate"] });
  if (result.canceled || !result.filePaths[0]) return errorResult("cancelled", "未选择工作区");
  try {
    const root = workspaceRegistry.add(result.filePaths[0]);
    const workspaces = listedWorkspaces();
    return okResult({
      root,
      workspace: workspaces.find((item) => item.realRoot === root),
      workspaces,
      trust: projectTrust.inspect(root),
    });
  } catch (error) {
    return errorResult(error?.code ?? "invalid_workspace", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:switchWorkspace", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = workspaceRequest(req);
  if (!normalized) return errorResult("invalid_args", "workspace is required");
  if (isForegroundBusy()) return errorResult("session_busy", "生成中无法切换工作区，请先停止或等待完成");
  let root;
  try {
    root = authorizedWorkspace(normalized.workspace);
  } catch (error) {
    return errorResult(error?.code ?? "workspace_not_authorized", error instanceof Error ? error.message : String(error));
  }
  const trust = projectTrust.inspect(root);
  if (trust.requiresTrust && trust.decision === "undecided") {
    return errorResult("trust_required", "打开该项目前需要确认是否信任其中的扩展和技能");
  }
  const result = await rpc("newSession", { workspace: root, projectTrusted: trust.decision === "trusted" }, "write_failed");
  if (result.ok) {
    stopAllFileWatches();
    rememberActive(result.data);
  }
  return result;
});

ipcMain.handle("omega:recentEvents", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = replayRequest(req);
  const sessionId = normalized.sessionId ?? worker?.sessionId;
  const after = normalized.after;
  const requestedEpoch = normalized.runtimeEpoch;
  const limit = normalized.limit;
  let bucket = sessionId ? recentEventsBySession.get(sessionId) ?? [] : [];
  if (sessionId && bucket.length === 0) {
    try {
      bucket = parseRecentEventLines(await readFile(recentEventsFile(sessionId), "utf8"));
      recentEventsBySession.set(sessionId, bucket);
      recentEventBytesBySession.set(sessionId, bucket.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item)), 0));
    } catch {
      bucket = [];
    }
  }
  const first = bucket[0]?.meta?.sequence ?? 0;
  const last = bucket.at(-1)?.meta?.sequence ?? 0;
  const firstMeta = bucket[0]?.meta;
  const afterEpoch = requestedEpoch;
  const events = bucket
    .filter((item) => {
      const sequence = item.meta?.sequence;
      const epoch = item.meta?.runtimeEpoch ?? 0;
      return epoch > afterEpoch || (epoch === afterEpoch && sequence > after);
    })
    .slice(0, limit);
  const gap = after > 0 && first > after + 1 && (firstMeta?.runtimeEpoch ?? 0) === afterEpoch;
  return okResult({ events, gap, first, last, nextAfter: events.at(-1)?.meta?.sequence ?? null, runtimeEpoch: events.at(-1)?.meta?.runtimeEpoch ?? firstMeta?.runtimeEpoch ?? 0 });
});

ipcMain.handle("window:isMaximized", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return okResult({ maximized: Boolean(win?.isMaximized()) });
});

function normalizePromptImages(images) {
  if (images === undefined) return undefined;
  if (!Array.isArray(images) || images.length === 0) return undefined;
  if (images.length > MAX_PROMPT_IMAGES) {
    throw new Error(`At most ${MAX_PROMPT_IMAGES} images per prompt`);
  }
  return images.map((image) => {
    if (
      !image ||
      typeof image !== "object" ||
      typeof image.mimeType !== "string" ||
      !image.mimeType.startsWith("image/") ||
      typeof image.data !== "string" ||
      !image.data
    ) {
      throw new Error("Each image needs an image/* mimeType and base64 data");
    }
    if (image.data.length > MAX_IMAGE_CHARS) {
      throw new Error("Image exceeds the size limit");
    }
    return { type: "image", data: image.data, mimeType: image.mimeType };
  });
}

ipcMain.handle("agent:prompt", async (event, text, behavior, images, clientMessageId) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (typeof text !== "string" || !text.trim()) return errorResult("invalid_prompt", "Prompt must be a non-empty string");
  if (text.length > MAX_PROMPT_CHARS) return errorResult("prompt_too_large", `Prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  if (behavior !== undefined && !PROMPT_BEHAVIORS.includes(behavior)) {
    return errorResult("invalid_args", "behavior must be 'steer' or 'followUp'");
  }
  if (clientMessageId !== undefined && (typeof clientMessageId !== "string" || clientMessageId.length < 1 || clientMessageId.length > 128)) {
    return errorResult("invalid_args", "clientMessageId must be a bounded string");
  }
  if (bootstrapError) return errorResult("bootstrap_failed", "Agent initialization failed");
  let imageContents;
  try {
    imageContents = normalizePromptImages(images);
  } catch (error) {
    return errorResult("invalid_args", error instanceof Error ? error.message : String(error));
  }
  return rpc("prompt", { text: text.trim(), behavior, images: imageContents, clientMessageId: clientMessageId?.slice(0, 128) }, "prompt_failed");
});

ipcMain.handle("agent:abort", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (bootstrapError) return errorResult("bootstrap_failed", "Agent initialization failed");
  return rpc("abort", {}, "abort_failed");
});

ipcMain.handle("omega:getState", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (bootstrapError) return errorResult("bootstrap_failed", "Agent initialization failed");
  return rpc("getState", {}, "read_failed");
});

ipcMain.handle("omega:listModels", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("listModels", {}, "read_failed");
});

ipcMain.handle("omega:setModel", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.provider !== "string" || typeof req.modelId !== "string") {
    return errorResult("invalid_args", "provider and modelId are required");
  }
  return rpc("setModel", { provider: req.provider, modelId: req.modelId }, "write_failed");
});

ipcMain.handle("omega:setThinkingLevel", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.level !== "string" || !THINKING_LEVELS.includes(req.level)) {
    return errorResult("invalid_args", "level must be a supported thinking level");
  }
  return rpc("setThinkingLevel", { level: req.level }, "write_failed");
});

ipcMain.handle("omega:listCommands", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("listCommands", {}, "read_failed");
});

ipcMain.handle("omega:compact", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("compact", {}, "compact_failed");
});

ipcMain.handle("omega:updateSettings", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const payload = {};
  if (req?.steeringMode === "all" || req?.steeringMode === "one-at-a-time") payload.steeringMode = req.steeringMode;
  if (req?.followUpMode === "all" || req?.followUpMode === "one-at-a-time") payload.followUpMode = req.followUpMode;
  if (typeof req?.autoCompaction === "boolean") payload.autoCompaction = req.autoCompaction;
  if (typeof req?.autoRetry === "boolean") payload.autoRetry = req.autoRetry;
  return rpc("updateSettings", payload, "write_failed");
});

ipcMain.handle("omega:clearQueue", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("clearQueue", {}, "write_failed");
});

ipcMain.handle("omega:getSessionTree", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("getSessionTree", {}, "read_failed");
});

ipcMain.handle("omega:fork", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.entryId !== "string" || !req.entryId.trim()) {
    return errorResult("invalid_args", "entryId is required");
  }
  const result = await rpc("fork", { entryId: req.entryId }, "write_failed");
  if (result.ok && result.data?.record) rememberActive(result.data.record);
  return result;
});

ipcMain.handle("omega:clone", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const result = await rpc("clone", {}, "write_failed");
  if (result.ok && result.data?.record) rememberActive(result.data.record);
  return result;
});

ipcMain.handle("omega:navigateTree", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.targetId !== "string" || !req.targetId.trim()) {
    return errorResult("invalid_args", "targetId is required");
  }
  return rpc("navigateTree", { targetId: req.targetId }, "write_failed");
});

ipcMain.handle("omega:authStatus", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("authStatus", {}, "read_failed");
});

ipcMain.handle("omega:getDesktopSettings", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return okResult(desktopSettings?.get() ?? null);
});

ipcMain.handle("omega:updateDesktopSettings", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!desktopSettings) return errorResult("unavailable", "Desktop settings are not ready");
  const patch = {};
  if (req?.themeMode === "system" || req?.themeMode === "light" || req?.themeMode === "dark") patch.themeMode = req.themeMode;
  if (req?.language === "zh-CN" || req?.language === "en-US") patch.language = req.language;
  if (Number.isInteger(req?.workerCap)) patch.workerCap = req.workerCap;
  if (Number.isInteger(req?.workerIdleTtlMs)) patch.workerIdleTtlMs = req.workerIdleTtlMs;
  if (typeof req?.rightPanelOpen === "boolean") patch.rightPanelOpen = req.rightPanelOpen;
  if (req?.keybindings && typeof req.keybindings === "object") {
    const normalized = sanitizeKeybindings(req.keybindings);
    if (normalized.conflicts.length > 0) return errorResult("invalid_args", `快捷键冲突：${normalized.conflicts.map((item) => item.binding).join(", ")}`);
    patch.keybindings = { commandPalette: normalized.commandPalette, newSession: normalized.newSession, abort: normalized.abort };
  }
  if (typeof req?.permissionProfile === "string" && PERMISSION_PROFILES.includes(req.permissionProfile)) patch.permissionProfile = sanitizePermissionProfile(req.permissionProfile);
  if (typeof req?.lastSessionId === "string" || req?.lastSessionId === null) patch.lastSessionId = req.lastSessionId;
  if (typeof req?.lastWorkspace === "string" || req?.lastWorkspace === null) patch.lastWorkspace = req.lastWorkspace;
  const next = desktopSettings.update(patch);
  workerPool.configure({ cap: next.workerCap, idleTtlMs: next.workerIdleTtlMs });
  return okResult(next);
});

ipcMain.handle("omega:configureCustomProvider", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = customProviderRequest(req);
  if (!normalized) return errorResult("invalid_args", "provider config is required");
  const result = await rpc("configureCustomProvider", normalized, "write_failed");
  if (!result.ok) return result;
  const current = desktopSettings.get().customProviders ?? {};
  desktopSettings.update({ customProviders: { ...current, [result.data.provider.id]: result.data.provider } });
  return result;
});

ipcMain.handle("omega:setPermissionProfile", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (typeof req?.profile !== "string" || !PERMISSION_PROFILES.includes(req.profile)) return errorResult("invalid_args", "Unsupported permission profile");
  const profile = sanitizePermissionProfile(req.profile);
  const previous = desktopSettings.get().permissionProfile;
  const next = desktopSettings.update({ permissionProfile: profile });
  const slots = workerPool.list().filter((slot) => slot.host?.state === "ready");
  const applied = [];
  const results = await Promise.all(slots.map(async (slot) => {
    const prior = slot.host.permissionProfile;
    try {
      await slot.host.call("setPermissionProfile", { profile });
      slot.host.permissionProfile = profile;
      applied.push({ slot, prior });
      return null;
    } catch (error) {
      return error;
    }
  }));
  const failed = results.find(Boolean);
  if (failed) {
    desktopSettings.update({ permissionProfile: previous });
    await Promise.all(applied.map(async ({ slot, prior }) => {
      try {
        await slot.host.call("setPermissionProfile", { profile: prior });
        slot.host.permissionProfile = prior;
      } catch {
        /* best effort rollback */
      }
    }));
    return errorResult(failed?.code ?? "write_failed", failed instanceof Error ? failed.message : String(failed));
  }
  return okResult(next);
});

ipcMain.handle("omega:setProviderApiKey", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.providerId !== "string" || !req.providerId.trim()) return errorResult("invalid_args", "providerId is required");
  if (typeof req.apiKey !== "string" || !req.apiKey.trim()) return errorResult("invalid_args", "apiKey is required");
  const providerId = req.providerId.trim().slice(0, 128);
  const apiKey = req.apiKey.trim().slice(0, 8192);
  try {
    credentialStore?.set(providerId, apiKey);
  } catch (error) {
    return errorResult(error?.code ?? "encryption_unavailable", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("setProviderApiKey", { providerId, apiKey }, "write_failed");
  if (!result.ok) {
    try {
      credentialStore?.remove(providerId);
    } catch {
      /* best effort */
    }
  }
  return result;
});

ipcMain.handle("omega:removeProviderApiKey", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.providerId !== "string" || !req.providerId.trim()) return errorResult("invalid_args", "providerId is required");
  const providerId = req.providerId.trim().slice(0, 128);
  try {
    credentialStore?.remove(providerId);
  } catch {
    /* best effort */
  }
  return rpc("removeProviderApiKey", { providerId }, "write_failed");
});

ipcMain.handle("omega:setSessionName", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = sessionNameRequest(req);
  if (!normalized) return errorResult("invalid_args", "name must be a non-empty string");
  const currentId = worker?.sessionId ?? null;
  const targetId = normalized.sessionId ?? currentId;
  if (!targetId) return errorResult("invalid_args", "sessionId is required");
  try {
    if (targetId === currentId) {
      return rpc("setSessionName", { name: normalized.name }, "write_failed");
    }
    const slot = workerPool.get(targetId);
    if (slot?.host?.state === "ready") {
      await slot.host.call("setSessionName", { name: normalized.name });
      return rpc("getState", undefined, "read_failed");
    }
    const sessionPath = await resolveSessionPath(targetId);
    if (!sessionPath) return errorResult("not_found", "Session not found");
    const root = resolve(piSessionsRoot()).toLowerCase();
    const resolved = resolve(String(sessionPath)).toLowerCase();
    const inRoot = resolved === root || resolved.startsWith(`${root}\\`) || resolved.startsWith(`${root}/`);
    if (!inRoot) return errorResult("forbidden", "Refusing to write a file outside the pi sessions directory");
    appendSessionInfo(sessionPath, normalized.name);
    return rpc("getState", undefined, "read_failed");
  } catch (error) {
    return errorResult(error?.code ?? "write_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:getToolDetail", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (typeof req?.toolCallId !== "string" || !req.toolCallId.trim()) return errorResult("invalid_args", "toolCallId is required");
  return rpc("getToolDetail", { toolCallId: req.toolCallId.slice(0, 256) }, "read_failed");
});

ipcMain.handle("omega:getThinking", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.entryId !== "string" || !req.entryId.trim()) {
    return errorResult("invalid_args", "entryId is required");
  }
  return rpc("getThinking", { entryId: req.entryId }, "read_failed");
});

ipcMain.handle("omega:listResources", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("listResources", {}, "read_failed");
});

ipcMain.handle("omega:reloadResources", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("reloadResources", {}, "write_failed");
});

ipcMain.handle("omega:installLocalResource", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    let source = typeof req?.source === "string" ? req.source.trim() : "";
    let pickedByDialog = false;
    if (!source && win) {
      const picked = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "openFile"],
        title: "选择本地扩展 / skill / prompt",
      });
      if (picked.canceled || !picked.filePaths[0]) return errorResult("cancelled", "未选择本地资源");
      source = picked.filePaths[0];
      pickedByDialog = true;
    }
    source = assertLocalSource(source);
    if (!pickedByDialog && !isUnderAuthorizedRoot(source)) {
      return errorResult("forbidden", "只能安装用户选择的目录或已授权工作区内的本地资源");
    }
    return rpc("installLocalResource", { source, project: req?.project === true }, "write_failed");
  } catch (error) {
    return errorResult(error?.code ?? "write_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:removeLocalResource", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const source = assertLocalSource(req?.source);
    if (!isUnderAuthorizedRoot(source)) return errorResult("forbidden", "只能移除已授权根目录内的本地资源");
    return rpc("removeLocalResource", { source, project: req?.project === true }, "write_failed");
  } catch (error) {
    return errorResult(error?.code ?? "write_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:setResourceEnabled", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.kind !== "string" || typeof req.path !== "string" || !req.path.trim()) {
    return errorResult("invalid_args", "kind and path are required");
  }
  return rpc("setResourceEnabled", {
    kind: req.kind,
    path: req.path,
    enabled: req.enabled !== false,
    project: req.project === true,
    baseDir: typeof req.baseDir === "string" ? req.baseDir : undefined,
  }, "write_failed");
});

ipcMain.handle("omega:setSkillModelInvocation", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.filePath !== "string" || !req.filePath.trim()) {
    return errorResult("invalid_args", "filePath is required");
  }
  if (!isUnderAuthorizedRoot(req.filePath)) return errorResult("forbidden", "只能修改已授权根目录内的 Skill");
  return rpc("setSkillModelInvocation", { filePath: req.filePath, disable: req.disable === true }, "write_failed");
});

ipcMain.handle("omega:setSkillCommandsEnabled", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("setSkillCommandsEnabled", { enabled: req?.enabled !== false }, "write_failed");
});

ipcMain.handle("omega:extensionUiResponse", (event, response) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!isExtensionUIResponse(response)) return errorResult("invalid_args", "Invalid extension UI response");
  return rpc("extensionUiResponse", response, "write_failed");
});

ipcMain.handle("omega:extensionUiCancel", (event, response) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!isExtensionUIResponse({ ...response, cancelled: true })) return errorResult("invalid_args", "Invalid extension UI cancellation");
  return rpc("extensionUiCancel", response, "write_failed");
});

ipcMain.handle("omega:getSystemPrompt", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("getSystemPrompt", {}, "read_failed");
});

ipcMain.handle("omega:exportHtml", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    requireWorker();
    const record = await worker.call("sessionRecord");
    const dir = join(app.getPath("userData"), "exports");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${record.id}-${Date.now()}.html`);
    writeFileSync(file, buildSessionHtml(record), "utf8");
    void Promise.resolve(shell.showItemInFolder(file)).catch(() => {});
    return okResult({ path: file });
  } catch (error) {
    return errorResult("write_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:bash", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const command = typeof req?.command === "string" ? req.command.trim() : "";
  if (!command) return errorResult("invalid_args", "command is required");
  if (command.length > 8192) return errorResult("invalid_args", "command too long");
  try {
    await assertBashAllowed(command);
  } catch (error) {
    return errorResult(error?.code ?? "permission_denied", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("bash", { command, excludeFromContext: req?.excludeFromContext === true }, "bash_failed");
  if (result.ok && result.data) {
    return okResult({ output: result.data.output, exitCode: result.data.exitCode, cancelled: result.data.cancelled });
  }
  return result;
});

ipcMain.handle("omega:queryExtensionState", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const bundle = stateReader.readExtensionState({
      scope: req?.scope ?? "all",
      projectKey: req?.projectKey,
      taskId: req?.taskId,
      cwd: activeCwd ?? undefined,
    });
    return okResult(bundle);
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:readSessionMessages", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = sessionRequest(req);
  if (!normalized) return errorResult("invalid_args", "sessionId is required");
  try {
    const sessionPath = await resolveSessionPath(normalized.sessionId);
    if (!sessionPath) return errorResult("not_found", "Session not found");
    return okResult(await readSessionMessages(sessionPath, { offset: req.offset, limit: req.limit }));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:listSessions", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const offset = Number.isInteger(req?.offset) && req.offset > 0 ? req.offset : 0;
    const limit = Number.isInteger(req?.limit) ? Math.max(1, Math.min(req.limit, 500)) : 100;
    const page = await readSessionSummaries(piSessionsRoot(), {
      allowedWorkspaces: (workspaceRegistry?.list() ?? []).map((item) => item.realRoot),
      offset,
      limit,
    });
    const workspaceMap = new Map((workspaceRegistry?.list() ?? []).map((item) => [resolve(item.realRoot), item]));
    return okResult({ ...page, items: page.items.map((item) => { const workspace = workspaceMap.get(resolve(item.workspace)); return workspace ? { ...item, workspaceId: workspace.workspaceId, workspaceLabel: workspace.displayPath } : item; }) });
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:newSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return createNamedSession(req);
});

ipcMain.handle("omega:loadSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return loadNamedSession(req);
});

ipcMain.handle("omega:deleteSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = sessionRequest(req);
  if (!normalized) return errorResult("invalid_args", "sessionId is required");
  try {
    const target = normalized.sessionId;
    if (workerPool.get(target)?.running) return errorResult("session_busy", "生成中无法删除会话，请先停止或等待完成");
    const state = await requireWorker().call("getState");
    if (state?.sessionId === target) {
      const result = await rpc("newSession", {}, "write_failed");
      if (!result.ok) return result;
      if (result.ok) rememberActive(result.data);
    }
    await workerPool.dispose(target);
    forgetSessionEvents(target);
    const sessionPath = await resolveSessionPath(target);
    if (sessionPath) {
      // Defense in depth: only ever delete files inside the pi sessions root.
      const root = resolve(piSessionsRoot()).toLowerCase();
      const resolved = resolve(String(sessionPath)).toLowerCase();
      const inRoot = resolved === root || resolved.startsWith(`${root}\\`) || resolved.startsWith(`${root}/`);
      if (!inRoot) return errorResult("forbidden", "Refusing to delete a file outside the pi sessions directory");
      if (existsSync(resolved)) unlinkSync(resolved);
    }
    return okResult(undefined);
  } catch (error) {
    return errorResult("write_failed", error instanceof Error ? error.message : String(error));
  }
});


function requireString(req, field, max = 4096) {
  if (typeof req?.[field] !== "string" || !req[field] || req[field].length > max) {
    throw new Error(`${field} is required`);
  }
  return req[field];
}

ipcMain.handle("omega:listDir", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const rel = typeof req?.path === "string" ? req.path : "";
    if (rel.length > 4096) return errorResult("invalid_args", "path too long");
    return okResult(workspaceService.listDir(activeCwd ?? rootOf(), rel));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:readFile", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = fileRequest(req);
  if (!normalized) return errorResult("invalid_args", "path is required");
  try {
    return okResult(workspaceService.readFile(activeCwd ?? rootOf(), normalized.path));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:readFilePage", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    return okResult(workspaceService.readFilePage(activeCwd ?? rootOf(), requireString(req, "path"), req?.offset, req?.limit));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:fileIndex", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const query = typeof req?.query === "string" ? req.query.slice(0, 256) : "";
    return okResult(workspaceService.fileIndex(activeCwd ?? rootOf(), query));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:openFileDefault", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = fileRequest(req);
  if (!normalized) return errorResult("invalid_args", "path is required");
  try {
    const revealed = workspaceService.revealPath(activeCwd ?? rootOf(), normalized.path);
    void Promise.resolve(shell.openPath(revealed.absolutePath)).catch(() => {});
    return okResult({ path: normalized.path });
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:chooseFileForWorkspace", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const picked = await dialog.showOpenDialog(win, { properties: ["openFile"], title: "选择要导入工作区的文件" });
  if (picked.canceled || !picked.filePaths[0]) return errorResult("cancelled", "未选择文件");
  pruneFileSelections();
  const selectionId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fileSelections.set(selectionId, { path: picked.filePaths[0], createdAt: Date.now() });
  return okResult({ selectionId, name: basename(picked.filePaths[0]) });
});

ipcMain.handle("omega:uploadFile", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  pruneFileSelections();
  const selection = fileSelections.get(req?.selectionId);
  if (!selection) return errorResult("not_found", "文件选择已过期");
  try {
    const result = fileTransfer.uploadFile(activeCwd ?? rootOf(), selection.path, req.path, { conflict: req.conflict, expectedToken: req.expectedToken });
    fileSelections.delete(req.selectionId);
    return okResult(result);
  } catch (error) { return errorResult(error?.code ?? "write_failed", error instanceof Error ? error.message : String(error)); }
});

ipcMain.handle("omega:watchFile", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = fileRequest(req);
  if (!normalized) return errorResult("invalid_args", "path is required");
  try {
    const revealed = workspaceService.revealPath(activeCwd ?? rootOf(), normalized.path);
    startFileWatch(revealed.absolutePath);
    return okResult({ path: normalized.path, watching: true });
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:unwatchFile", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = fileRequest(req);
  if (!normalized) return errorResult("invalid_args", "path is required");
  try {
    const revealed = workspaceService.revealPath(activeCwd ?? rootOf(), normalized.path);
    stopFileWatch(revealed.absolutePath);
    return okResult({ path: normalized.path, watching: false });
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:revealInFolder", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const rel = typeof req?.path === "string" ? req.path : "";
    if (rel.length > 4096) return errorResult("invalid_args", "path too long");
    const revealed = workspaceService.revealPath(activeCwd ?? rootOf(), rel);
    void Promise.resolve(shell.showItemInFolder(revealed.absolutePath)).catch(() => {});
    return okResult({ path: revealed.path });
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:listWorktrees", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    return okResult(diffService.listWorktrees(activeCwd ?? rootOf()));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:addWorktree", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const cwd = activeCwd ?? rootOf();
    let path = typeof req?.path === "string" ? req.path.trim() : "";
    if (!path && win) {
      const picked = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory", "promptToCreate"] });
      if (picked.canceled || !picked.filePaths[0]) return errorResult("cancelled", "未选择 worktree 目录");
      path = picked.filePaths[0];
    }
    return okResult(diffService.addWorktree(cwd, {
      path,
      branch: typeof req?.branch === "string" ? req.branch : "",
      createBranch: req?.createBranch !== false,
      allowedRoots: authorizedRoots(),
    }));
  } catch (error) {
    return errorResult(error?.code ?? "write_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:removeWorktree", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.path !== "string" || !req.path.trim()) return errorResult("invalid_args", "path is required");
  try {
    return okResult(diffService.removeWorktree(activeCwd ?? rootOf(), { path: req.path, force: req.force === true }));
  } catch (error) {
    return errorResult(error?.code ?? "write_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:gitSnapshot", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    return okResult(diffService.computeSnapshot(activeCwd ?? rootOf()));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:gitStage", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const normalized = gitStageRequest(req);
    if (!normalized) return errorResult("invalid_args", "snapshotToken and items are required");
    return okResult(diffService.stageItems(activeCwd ?? rootOf(), normalized.items, normalized.snapshotToken));
  } catch (error) {
    return errorResult("git_unavailable", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:gitUnstage", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const normalized = gitStageRequest(req);
    if (!normalized) return errorResult("invalid_args", "snapshotToken and items are required");
    return okResult(diffService.unstageItems(activeCwd ?? rootOf(), normalized.items, normalized.snapshotToken));
  } catch (error) {
    return errorResult("git_unavailable", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:gitCommit", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const normalized = gitCommitRequest(req);
  if (!normalized) return errorResult("invalid_args", "message is required");
  const message = normalized.message;
  try {
    return okResult(diffService.commitIndexed(activeCwd ?? rootOf(), message));
  } catch (error) {
    return errorResult("git_unavailable", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:approveChange", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || (req.action !== "accept" && req.action !== "reject")) {
    return errorResult("invalid_args", "action must be 'accept' or 'reject'");
  }
  try {
    const cwd = activeCwd ?? rootOf();
    if (req.action === "reject" && (typeof req.snapshotToken !== "string" || !req.snapshotToken)) {
      return errorResult("invalid_args", "snapshotToken is required");
    }
    const result =
      req.action === "accept"
        ? diffService.acceptChanges()
        : diffService.revertFiles(Array.isArray(req.files) ? req.files : [], cwd, req.snapshotToken);
    return okResult(result);
  } catch (error) {
    return errorResult("git_unavailable", error instanceof Error ? error.message : String(error));
  }
});

// ---------------------------------------------------------------------------

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  agentReady = false;
  worker = null;
  stopAllFileWatches();
  await workerPool.disposeAll();
}

singleInstancePrimary = app.requestSingleInstanceLock();
if (!singleInstancePrimary) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    startupRequest = parseStartupRequest(commandLine);
    focusMainWindow();
    if (startupRequest.workspace && workspaceRegistry) {
      void (async () => {
        try {
          const root = authorizedWorkspace(startupRequest.workspace);
          if (!isForegroundBusy() && root !== activeCwd) {
            const trust = projectTrust.inspect(root);
            if (!trust.requiresTrust || trust.decision === "trusted") {
              const result = await rpc("newSession", { workspace: root, projectTrusted: trust.decision === "trusted" }, "write_failed");
              if (result.ok) rememberActive(result.data);
            }
          }
        } catch {
          /* startup deep-link is best effort; keep the existing window usable */
        }
      })();
    }
  });
}

app
  .whenReady()
  .then(async () => {
    if (!singleInstancePrimary) return;
    try {
      await bootstrap();
    } catch (error) {
      showBootstrapError(error);
      agentReady = false;
      try {
        await workerPool.disposeAll();
      } catch {
        /* best effort */
      }
      worker = null;
      process.stderr.write(`[main] bootstrap failed: ${bootstrapError}\n`);
    }
    try {
      await createWindow();
    } catch (error) {
      process.stderr.write(`[main] window failed: ${String(error)}\n`);
      await shutdown();
      app.exit(1);
    }
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) {
        void createWindow().catch((error) => {
          process.stderr.write(`[main] recreate window failed: ${String(error)}\n`);
        });
      }
    });
  })
  .catch((error) => {
    process.stderr.write(`[main] startup failed: ${String(error)}\n`);
    app.exit(1);
  });

app.on("before-quit", (event) => {
  if (quitRequested) return;
  event.preventDefault();
  if (closeHandling) return;
  if (closeApproved || !isAgentBusy()) {
    quitRequested = true;
    void shutdown().catch((error) => {
      process.stderr.write(`[main] shutdown failed: ${String(error)}\n`);
    }).finally(() => app.exit(0));
    return;
  }
  closeHandling = true;
  void runCloseSequence(() => app.quit()).catch((error) => {
    process.stderr.write(`[main] quit sequence failed: ${String(error)}\n`);
  }).finally(() => {
    closeHandling = false;
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
