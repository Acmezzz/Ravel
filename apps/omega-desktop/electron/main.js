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
  session as electronSession,
  shell,
  dialog,
  safeStorage,
} from "electron";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { piSessionsRoot, THINKING_LEVELS, resolveSessionPath } from "./agent-bridge.js";
import { buildSessionHtml } from "./export-html.js";
import * as persistence from "./persistence.js";
import * as stateReader from "./state-reader.js";
import * as diffService from "./diff-service.js";
import * as workspaceService from "./workspace-service.js";
import { createWorkspaceRegistry } from "./workspace-registry.js";
import { projectTrust } from "./project-trust.js";
import { realRoot } from "./path-security.js";
import { readSessionSummaries } from "./session-reader.js";
import { isIpcEnvelope } from "./ipc-contracts.js";
import { CLOSE_DIALOG_BUTTONS, closeDecisionFromIndex } from "./close-lifecycle.js";
import { WorkerHost } from "./worker-host.js";
import { createWorkerSlotPool } from "./worker-pool.js";
import { createDesktopSettingsStore } from "./desktop-settings.js";
import { createCredentialStore } from "./credential-store.js";

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = resolve(MAIN_DIR, "..", "..", "..");
const MAX_PROMPT_CHARS = 40_000;
const PROMPT_BEHAVIORS = ["steer", "followUp"];
const MAX_PROMPT_IMAGES = 4;
const MAX_IMAGE_CHARS = 8_000_000;
const WORKER_RPC_TIMEOUT = 120_000;
const CLOSE_FLUSH_TIMEOUT = 10_000;
const RECENT_EVENT_LIMIT = 300;
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
let agentRunning = false;
let workspaceRegistry;
let closeDecision = null;
let closeHandling = false;
let closeApproved = false;
const recentEventsBySession = new Map();

function rootOf() {
  return app.isPackaged ? (process.resourcesPath ? join(process.resourcesPath, "omega-runtime") : app.getAppPath()) : DEV_ROOT;
}

function extensionsRootOf() {
  return process.env.OMEGA_EXTENSIONS_ROOT ?? (app.isPackaged ? join(rootOf(), ".pi", "extensions") : join(DEV_ROOT, ".pi", "extensions"));
}

function sessionsRoot() {
  return join(app.getPath("userData"), "omega", "sessions");
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

function bindHost(host) {
  host.onEvent = (event, meta) => {
    const sessionId = meta?.sessionId ?? host.sessionId;
    if (event?.type === "agent_start" || event?.type === "turn_start") workerPool.markRunning(sessionId, true);
    if (event?.type === "agent_end" || event?.type === "turn_end" || event?.type === "agent_settled") workerPool.markRunning(sessionId, false);
    if (event?.type === "error") workerPool.markRunning(sessionId, false);
    agentRunning = Boolean(workerPool.foreground()?.running);
    if (meta?.sequence && sessionId) {
      const bucket = recentEventsBySession.get(sessionId) ?? [];
      bucket.push({ event, meta });
      if (bucket.length > RECENT_EVENT_LIMIT) bucket.splice(0, bucket.length - RECENT_EVENT_LIMIT);
      recentEventsBySession.set(sessionId, bucket);
    }
    if (!win || win.isDestroyed()) return;
    win.webContents.send("agent:event", { event, meta });
  };
  host.onTransport = (state, extra = {}) => {
    const foreground = host === worker;
    if (foreground) {
      agentReady = state === "ready";
      if (state !== "ready") agentRunning = Boolean(workerPool.foreground()?.running);
    }
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
  return bindHost(new WorkerHost({ timeout: WORKER_RPC_TIMEOUT }));
}

async function adoptSlot(slot) {
  worker = slot.host;
  activeCwd = slot.cwd ?? activeCwd;
  agentReady = slot.host?.state === "ready";
  agentRunning = Boolean(slot.running);
  return slot;
}

async function acquireSlot({ sessionId = null, cwd, projectTrusted } = {}) {
  const slot = await workerPool.acquire({
    sessionId,
    cwd: cwd ?? activeCwd ?? rootOf(),
    extensionsRoot: extensionsRootOf(),
    projectTrusted: projectTrusted !== false,
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

async function bootstrap() {
  desktopSettings = createDesktopSettingsStore(desktopSettingsFile());
  credentialStore = createCredentialStore(credentialStoreFile(), {
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (buffer) => safeStorage.decryptString(buffer),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  });
  const prefs = desktopSettings.get();
  workerPool = createWorkerSlotPool({ cap: prefs.workerCap, idleTtlMs: prefs.workerIdleTtlMs });
  workspaceRegistry = createWorkspaceRegistry(workspaceRegistryFile());
  const requested = process.env.OMEGA_WORKSPACE ? realRoot(resolve(process.env.OMEGA_WORKSPACE)) : realRoot(rootOf());
  const cwd = workspaceRegistry.has(requested) ? workspaceRegistry.resolveAuthorized(requested) : workspaceRegistry.add(requested);
  activeCwd = cwd;
  process.stdout.write(`[main] cwd=${cwd}\n`);
  const slot = await acquireSlot({ cwd, projectTrusted: projectTrust.isTrusted(cwd) });
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
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
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
      win?.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === "F11") {
      if (win) win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.on("maximize", () => win?.webContents.send("window:maximizedChanged", true));
  win.on("unmaximize", () => win?.webContents.send("window:maximizedChanged", false));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== expectedPageUrl()) event.preventDefault();
  });
  electronSession.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.on("console-message", (details) => {
    process.stdout.write(`[renderer] [${details.level}] ${details.message}\n`);
  });
  win.on("close", (event) => {
    if (closeApproved || closeHandling || !isAgentBusy()) return;
    event.preventDefault();
    closeHandling = true;
    void runCloseSequence(() => win?.close()).finally(() => {
      closeHandling = false;
    });
  });
  win.on("closed", () => {
    win = undefined;
  });
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
  if (!req?.workspace || typeof req.workspace !== "string") return errorResult("invalid_args", "workspace is required");
  if (isForegroundBusy()) return errorResult("session_busy", "生成中无法切换工作区，请先停止或等待完成");
  let root;
  try {
    root = authorizedWorkspace(req.workspace);
  } catch (error) {
    return errorResult(error?.code ?? "workspace_not_authorized", error instanceof Error ? error.message : String(error));
  }
  const trust = projectTrust.inspect(root);
  if (trust.requiresTrust && trust.decision === "undecided") {
    return errorResult("trust_required", "打开该项目前需要确认是否信任其中的扩展和技能");
  }
  const result = await rpc("newSession", { workspace: root, projectTrusted: trust.decision === "trusted" }, "write_failed");
  if (result.ok) rememberActive(result.data);
  return result;
});

ipcMain.handle("omega:recentEvents", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const sessionId = typeof req?.sessionId === "string" ? req.sessionId : worker?.sessionId;
  const after = typeof req?.after === "number" && Number.isFinite(req.after) ? req.after : 0;
  const bucket = sessionId ? recentEventsBySession.get(sessionId) ?? [] : [];
  const first = bucket[0]?.meta?.sequence ?? 0;
  const last = bucket.at(-1)?.meta?.sequence ?? 0;
  return okResult({ events: bucket.filter((item) => item.meta?.sequence > after), gap: after > 0 && first > after + 1, first, last });
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

ipcMain.handle("agent:prompt", async (event, text, behavior, images) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (typeof text !== "string" || !text.trim()) return errorResult("invalid_prompt", "Prompt must be a non-empty string");
  if (text.length > MAX_PROMPT_CHARS) return errorResult("prompt_too_large", `Prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  if (behavior !== undefined && !PROMPT_BEHAVIORS.includes(behavior)) {
    return errorResult("invalid_args", "behavior must be 'steer' or 'followUp'");
  }
  if (bootstrapError) return errorResult("bootstrap_failed", "Agent initialization failed");
  let imageContents;
  try {
    imageContents = normalizePromptImages(images);
  } catch (error) {
    return errorResult("invalid_args", error instanceof Error ? error.message : String(error));
  }
  return rpc("prompt", { text: text.trim(), behavior, images: imageContents }, "prompt_failed");
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

ipcMain.handle("omega:getForkCandidates", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  return rpc("getForkCandidates", {}, "read_failed");
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
  if (Number.isInteger(req?.workerCap)) patch.workerCap = req.workerCap;
  if (Number.isInteger(req?.workerIdleTtlMs)) patch.workerIdleTtlMs = req.workerIdleTtlMs;
  if (typeof req?.rightPanelOpen === "boolean") patch.rightPanelOpen = req.rightPanelOpen;
  if (typeof req?.lastSessionId === "string" || req?.lastSessionId === null) patch.lastSessionId = req.lastSessionId;
  if (typeof req?.lastWorkspace === "string" || req?.lastWorkspace === null) patch.lastWorkspace = req.lastWorkspace;
  const next = desktopSettings.update(patch);
  workerPool.configure({ cap: next.workerCap, idleTtlMs: next.workerIdleTtlMs });
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

ipcMain.handle("omega:listPiSessions", async (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const result = await rpc("listPiSessions", { cwd: activeCwd ?? rootOf() }, "read_failed");
  if (!result.ok) return result;
  return okResult(result.data.filter((session) => {
    try {
      return workspaceRegistry.has(session.workspace);
    } catch {
      return false;
    }
  }));
});

ipcMain.handle("omega:newPiSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (isForegroundBusy() && worker?.state === "ready") return errorResult("session_busy", "生成中无法切换会话，请先停止或等待完成");
  let workspace;
  try {
    workspace = req?.workspace ? authorizedWorkspace(req.workspace) : activeCwd ?? rootOf();
  } catch (error) {
    return errorResult(error?.code ?? "invalid_workspace", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("newSession", { workspace, title: req?.title }, "write_failed");
  if (result.ok) rememberActive(result.data);
  return result;
});

ipcMain.handle("omega:switchPiSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req?.sessionId) return errorResult("invalid_args", "sessionId is required");
  try {
    const existing = workerPool.get(req.sessionId);
    if (existing) {
      await adoptSlot(workerPool.activate(req.sessionId));
      const record = await worker.call("sessionRecord");
      rememberActive(record);
      return okResult(record);
    }
    if (isForegroundBusy() && worker?.state === "ready") {
      const workspace = req?.workspace ? authorizedWorkspace(req.workspace) : activeCwd ?? rootOf();
      await acquireSlot({ sessionId: req.sessionId, cwd: workspace, projectTrusted: projectTrust.isTrusted(workspace) });
      const record = await worker.call("sessionRecord");
      rememberActive(record);
      return okResult(record);
    }
  } catch (error) {
    return errorResult(error?.code ?? "read_failed", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("switchSession", { sessionId: req.sessionId }, "read_failed");
  if (result.ok) rememberActive(result.data);
  return result;
});

ipcMain.handle("omega:setSessionName", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req || typeof req.name !== "string" || !req.name.trim()) {
    return errorResult("invalid_args", "name must be a non-empty string");
  }
  return rpc("setSessionName", { name: req.name.trim() }, "write_failed");
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
    void shell.showItemInFolder(file);
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
    return okResult(page);
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:newSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (isForegroundBusy() && worker?.state === "ready") return errorResult("session_busy", "生成中无法切换会话，请先停止或等待完成");
  let workspace;
  try {
    workspace = req?.workspace ? authorizedWorkspace(req.workspace) : activeCwd ?? rootOf();
  } catch (error) {
    return errorResult(error?.code ?? "invalid_workspace", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("newSession", { workspace, title: req?.title }, "write_failed");
  if (result.ok) rememberActive(result.data);
  return result;
});

ipcMain.handle("omega:loadSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req?.sessionId) return errorResult("invalid_args", "sessionId is required");
  try {
    const existing = workerPool.get(req.sessionId);
    if (existing) {
      await adoptSlot(workerPool.activate(req.sessionId));
      const record = await worker.call("sessionRecord");
      rememberActive(record);
      return okResult(record);
    }
    if (isForegroundBusy() && worker?.state === "ready") {
      const workspace = activeCwd ?? rootOf();
      await acquireSlot({ sessionId: req.sessionId, cwd: workspace, projectTrusted: projectTrust.isTrusted(workspace) });
      const record = await worker.call("sessionRecord");
      rememberActive(record);
      return okResult(record);
    }
  } catch (error) {
    return errorResult(error?.code ?? "read_failed", error instanceof Error ? error.message : String(error));
  }
  const result = await rpc("switchSession", { sessionId: req.sessionId }, "read_failed");
  if (result.ok) rememberActive(result.data);
  return result;
});

ipcMain.handle("omega:saveSession", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req?.sessionId || !req?.transcript) return errorResult("invalid_args", "sessionId and transcript are required");
  return errorResult("unsupported", "Pi JSONL is the session authority; transcript cache writes are disabled");
});

ipcMain.handle("omega:deleteSession", async (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  if (!req?.sessionId || typeof req.sessionId !== "string") return errorResult("invalid_args", "sessionId is required");
  try {
    const target = req.sessionId;
    if (workerPool.get(target)?.running) return errorResult("session_busy", "生成中无法删除会话，请先停止或等待完成");
    const state = await requireWorker().call("getState");
    if (state?.sessionId === target) {
      const result = await rpc("newSession", {}, "write_failed");
      if (!result.ok) return result;
      if (result.ok) rememberActive(result.data);
    }
    await workerPool.dispose(target);
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

ipcMain.handle("omega:diffWorkspace", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    return okResult(diffService.computeDiff(activeCwd ?? rootOf()));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
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
  try {
    return okResult(workspaceService.readFile(activeCwd ?? rootOf(), requireString(req, "path")));
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

ipcMain.handle("omega:gitSnapshot", (event) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    return okResult(diffService.computeSnapshot(activeCwd ?? rootOf()));
  } catch (error) {
    return errorResult("read_failed", error instanceof Error ? error.message : String(error));
  }
});

function normalizeGitItems(req) {
  if (!Array.isArray(req?.items)) throw new Error("items[] is required");
  if (typeof req.snapshotToken !== "string" || !req.snapshotToken) throw new Error("snapshotToken is required");
  return {
    snapshotToken: req.snapshotToken.slice(0, 128),
    items: req.items.slice(0, 200).map((item) => ({
      path: typeof item?.path === "string" ? item.path.slice(0, 4096) : "",
      hunks: Array.isArray(item?.hunks) ? item.hunks.filter((hunk) => typeof hunk === "string").slice(0, 100) : undefined,
    })),
  };
}

ipcMain.handle("omega:gitStage", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const normalized = normalizeGitItems(req);
    return okResult(diffService.stageItems(activeCwd ?? rootOf(), normalized.items, normalized.snapshotToken));
  } catch (error) {
    return errorResult("git_unavailable", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:gitUnstage", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  try {
    const normalized = normalizeGitItems(req);
    return okResult(diffService.unstageItems(activeCwd ?? rootOf(), normalized.items, normalized.snapshotToken));
  } catch (error) {
    return errorResult("git_unavailable", error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("omega:gitCommit", (event, req) => {
  if (!senderAllowed(event)) return errorResult("forbidden", "Invalid renderer sender");
  const message = typeof req?.message === "string" ? req.message.trim() : "";
  if (!message) return errorResult("invalid_args", "message is required");
  if (message.length > 8000) return errorResult("invalid_args", "message too long");
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
  agentRunning = false;
  worker = null;
  await workerPool.disposeAll();
}

app
  .whenReady()
  .then(async () => {
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
      if (!BrowserWindow.getAllWindows().length) void createWindow();
    });
  })
  .catch((error) => {
    process.stderr.write(`[main] startup failed: ${String(error)}\n`);
    app.exit(1);
  });

app.on("before-quit", (event) => {
  if (quitRequested) return;
  if (closeApproved || !isAgentBusy()) {
    event.preventDefault();
    quitRequested = true;
    void shutdown().finally(() => app.exit(0));
    return;
  }
  event.preventDefault();
  if (closeHandling) return;
  closeHandling = true;
  void runCloseSequence(() => app.quit()).finally(() => {
    closeHandling = false;
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
