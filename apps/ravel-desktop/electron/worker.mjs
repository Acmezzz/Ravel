/**
 * Agent worker — hosts the AgentSessionRuntime inside an Electron
 * utilityProcess (architecture ported from pi-app's worker, MIT).
 *
 * Protocol (process.parentPort):
 *   main -> worker: {type:"init", cwd, extensionsRoot}
 *                     {type:"req", id, method, args}
 *                     {type:"dispose"}
 *   worker -> main: {type:"init-done", sessionId, cwd} | {type:"init-error", error}
 *                     {type:"app-event", event}          (projected renderer event)
 *                     {type:"settled"}                   (agent_settled -> notification)
 *                     {type:"resp", id, data?, error?, code?}
 *
 * A crash or hang in the agent/extension code no longer takes down the
 * window: the main process owns the UI and proxies every omega:* RPC here.
 */
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import * as bridge from "./agent-bridge.js";
import {
  RESOURCE_ARRAY_KEYS,
  RESOURCE_KINDS,
  assertLocalSource,
  buildResourceBundle,
  nextScopedPaths,
  setDisableModelInvocationFrontmatter,
} from "./resource-center.js";
import { isExtensionUIResponse } from "./extension-ui-protocol.js";
import { isWorkerRequest } from "./worker-protocol.js";
import { createPermissionGuard, sanitizePermissionProfile } from "./permission-profiles.js";
import { validateCustomProvider } from "./custom-providers.js";
import {
  appendCheckpointFacts,
  appendFact,
  appendContextAttachedFact,
  setFactsAppendedListener,
  appendSessionReferenceFacts,
  buildSessionReferenceBlock,
  closeStaleApprovals,
  closeStaleOperations,
  resolveSourceEntryId,
} from "./session-facts.js";
import { createCheckpoint } from "./checkpoint-service.js";

/** @type {import("./agent-bridge.js").ReturnType<typeof bridge.createRuntime> | null} */
let runtime = null;
let extensionsRoot = null;
let unsubscribe = null;
let unsubscribeFacts = null;
let generation = 0;
let disposed = false;
let eventSequence = 0;
let runtimeEpoch = 0;
let activeRunId = null;
const activeClientMessageIds = new Set();
const pendingExtensionUI = new Map();
/** Serializes non-streaming prompts; streaming prompts bypass it (steer). */
let promptQueue = Promise.resolve();

function post(message) {
  process.parentPort.postMessage(message);
}

function extensionMeta() {
  return {
    sessionId: runtime?.session?.sessionId ?? null,
    runId: activeRunId,
    generation,
    runtimeEpoch,
    clientMessageId: activeClientMessageIds.size === 1 ? activeClientMessageIds.values().next().value : null,
  };
}

function settleExtensionUI(id, value) {
  const pending = pendingExtensionUI.get(id);
  if (!pending) return false;
  pendingExtensionUI.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(value);
  return true;
}

function cancelAllExtensionUI() {
  for (const pending of pendingExtensionUI.values()) {
    clearTimeout(pending.timer);
    pending.resolve({ cancelled: true });
  }
  pendingExtensionUI.clear();
}

function createDesktopExtensionUIContext() {
	const request = (payload, timeout, onIssued) => {
		const id = randomUUID();
		const meta = extensionMeta();
		const requestPayload = { type: "extension_ui_request", id, ...payload, ...meta };
		const effectiveTimeout = Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 10 * 60 * 1000) : 5 * 60 * 1000;
		onIssued?.(id);
		return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingExtensionUI.delete(id);
        // Sentinel (not a default value) so approval flows can distinguish
        // "no answerer" (unavailable) from an explicit deny.
        resolve({ timedOut: true });
      }, effectiveTimeout);
      pendingExtensionUI.set(id, { resolve, timer, ...meta });
      post({ type: "extension-ui-request", request: requestPayload });
    });
  };

  return {
    select: (title, options, opts) => request({ method: "select", title, options, timeout: opts?.timeout }, opts?.timeout),
    confirm: (title, message, opts) => request({ method: "confirm", title, message, timeout: opts?.timeout }, opts?.timeout, opts?.onIssued),
    input: (title, placeholder, opts) => request({ method: "input", title, placeholder, timeout: opts?.timeout }, opts?.timeout),
    editor: (title, prefill) => request({ method: "editor", title, prefill }),
    notify: (message, notifyType) => {
      post({ type: "extension-ui-request", request: { type: "extension_ui_request", id: randomUUID(), method: "notify", message, notifyType, ...extensionMeta() } });
    },
    onTerminalInput: () => () => {},
    setStatus: (statusKey, statusText) => {
      post({ type: "extension-ui-request", request: { type: "extension_ui_request", id: randomUUID(), method: "setStatus", statusKey, statusText, ...extensionMeta() } });
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: (widgetKey, widgetLines, options) => {
      if (widgetLines !== undefined && !Array.isArray(widgetLines)) return;
      post({ type: "extension-ui-request", request: { type: "extension_ui_request", id: randomUUID(), method: "setWidget", widgetKey, widgetLines, widgetPlacement: options?.placement, ...extensionMeta() } });
    },
    setFooter: () => {},
    setHeader: () => {},
    setTitle: (title) => {
      post({ type: "extension-ui-request", request: { type: "extension_ui_request", id: randomUUID(), method: "setTitle", title, ...extensionMeta() } });
    },
    custom: async () => undefined,
    pasteToEditor: (text) => {
      post({ type: "extension-ui-request", request: { type: "extension_ui_request", id: randomUUID(), method: "set_editor_text", text, ...extensionMeta() } });
    },
    setEditorText: (text) => {
      post({ type: "extension-ui-request", request: { type: "extension_ui_request", id: randomUUID(), method: "set_editor_text", text, ...extensionMeta() } });
    },
    getEditorText: () => "",
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() { return undefined; },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Theme switching is not supported" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

async function bindSession(session) {
  const uiContext = createDesktopExtensionUIContext();
  await session.bindExtensions({
    uiContext,
    mode: "rpc",
    toolCallGuard: createPermissionGuard({
      profile: permissionProfile,
      cwd: runtime.cwd,
      confirm: (title, message, onIssued) => uiContext.confirm(title, message, { onIssued }),
      facts: {
        runId: () => activeRunId ?? "",
        appendAsked: (asked) => appendFact(session.sessionManager, asked),
        appendDecided: (decided) => appendFact(session.sessionManager, decided),
      },
      // Shadow snapshot before every approved mutation (C4-lite). Best effort.
      snapshot: async ({ toolName }) => {
        try {
          const created = await createCheckpoint(runtime.cwd, `auto ${toolName}`);
          try {
            appendCheckpointFacts(session.sessionManager, { checkpointId: created.id, label: created.label });
          } catch (error) {
            console.error("checkpoint fact failed", error);
          }
        } catch (error) {
          console.error("auto checkpoint failed", error);
        }
      },
    }),
  });
}

/**
 * Durable operation bookkeeping around one prompt. The first prompt of a run
 * opens an `operation_started` fact; steering/followUp prompts join the open
 * operation instead of opening a second one (two open operations would be
 * reducer-level corruption). Best effort: fact failures never block prompts.
 */
function beginOperationFact(session, operationId, text) {
  activeRunId = operationId;
  try {
    appendFact(session.sessionManager, {
      type: "operation_started",
      id: operationId,
      lane: "main",
      sourceLeafId: session.sessionManager.getLeafId(),
      intent: {
        kind: "run",
        originalPrompt: [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }],
        initialMessages: [],
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("operation_started fact failed", error);
  }
}

function endOperationFact(session, operationId, outcome, error) {
  try {
    appendFact(session.sessionManager, {
      type: "operation_finished",
      id: `finish-${operationId}`,
      lane: "main",
      runId: operationId,
      outcome,
      ...(outcome === "failed" && error
        ? { error: { code: String(error.code ?? error.name ?? "error"), message: String(error.message ?? error).slice(0, 500) } }
        : {}),
      timestamp: Date.now(),
    });
  } catch (factError) {
    console.error("operation_finished fact failed", factError);
  }
}

/**
 * Record a compaction as an operation fact pair. The Pi compact API only
 * reveals its compaction entry afterwards, so both records are appended once
 * the outcome is known — still truthful, still append-only.
 */
function recordCompactionFact(sessionManager, knownIds, error) {
  const newest = [...sessionManager.getEntries()]
    .reverse()
    .find((entry) => entry.type === "compaction" && !knownIds.has(entry.id));
  if (!newest && !error) return;
  const operationId = `op-${randomUUID()}`;
  try {
    appendFact(sessionManager, {
      type: "operation_started",
      id: operationId,
      lane: "main",
      sourceLeafId: null,
      intent: { kind: "compaction", resultEntryId: newest ? newest.id : `missing-${operationId}` },
      timestamp: Date.now(),
    });
    endOperationFact({ sessionManager }, operationId, error ? "failed" : "completed", error ?? undefined);
  } catch (factError) {
    console.error("compaction facts failed", factError);
  }
}

/** Close approval asks and open operations left behind by a previous worker's death. */
function settleSessionFacts() {
	try {
		closeStaleApprovals(runtime.session.sessionManager);
	} catch (error) {
		console.error("stale approval recovery failed", error);
	}
	try {
		closeStaleOperations(runtime.session.sessionManager);
	} catch (error) {
		console.error("stale operation recovery failed", error);
	}
}

function bindFacts(session) {
  unsubscribeFacts?.();
  unsubscribeFacts = setFactsAppendedListener(session.sessionManager, (item) => {
    if (!item?.entryId || !item.fact) return;
    post({ type: "facts-appended", sessionId: session.sessionId, generation, facts: [{ entryId: item.entryId, fact: item.fact }] });
  });
}

function attach(session) {
  try {
    unsubscribe?.();
  } catch {
    /* best effort */
  }
  unsubscribe = session.subscribe((event) => {
    const meta = {
      sequence: ++eventSequence,
      sessionId: runtime?.session?.sessionId ?? session?.sessionId,
      runId: activeRunId,
      generation,
      runtimeEpoch,
      clientMessageId: activeClientMessageIds.size === 1 ? activeClientMessageIds.values().next().value : null,
    };
    if (event?.type === "agent_settled") post({ type: "settled", meta });
    for (const projected of bridge.toRendererEvent(event)) {
      if (projected) post({ type: "app-event", event: projected, meta });
    }
  });
}

let projectTrusted = true;
let permissionProfile = "trusted";

async function init({ cwd, extensionsRoot: root, sessionId, generation: nextGeneration, projectTrusted: trusted, permissionProfile: profile, runtimeCredentials = {}, customProviders = {} }) {
  permissionProfile = sanitizePermissionProfile(profile);
  generation = Number.isInteger(nextGeneration) ? nextGeneration : generation + 1;
  eventSequence = 0;
  activeRunId = null;
  activeClientMessageIds.clear();
  disposed = false;
  runtimeEpoch = 0;
  extensionsRoot = root;
  projectTrusted = trusted !== false;
  runtime = await bridge.createRuntime({ cwd, extensionsRoot: root, projectTrusted });
  for (const [providerId, apiKey] of Object.entries(runtimeCredentials ?? {})) {
    if (typeof apiKey === "string" && apiKey.length > 0) await runtime.session.modelRuntime.setRuntimeApiKey(providerId, apiKey);
  }
  for (const provider of Object.values(customProviders ?? {})) {
    try { runtime.session.modelRuntime.registerProvider(provider.id, { name: provider.name, baseUrl: provider.baseUrl, api: provider.api, headers: provider.headers, authHeader: provider.authHeader, models: provider.models }); } catch { /* invalid persisted provider is ignored; builtin providers remain usable */ }
  }
  if (sessionId && sessionId !== runtime.session.sessionId) {
    const sessionPath = await bridge.resolveSessionPath(sessionId);
    if (!sessionPath) {
      const error = new Error("Session not found during worker recovery");
      error.code = "session_recovery_failed";
      throw error;
    }
    const cancelled = await runtime.switchSession(sessionPath);
    if (cancelled.cancelled) {
      const error = new Error("Session recovery cancelled");
      error.code = "session_recovery_cancelled";
      throw error;
    }
  }
  runtime.setRebindSession(async (session) => {
    attach(session);
    await bindSession(session);
    bindFacts(session);
  });
  attach(runtime.session);
  await bindSession(runtime.session);
  bindFacts(runtime.session);
  settleSessionFacts();
  post({ type: "init-done", sessionId: runtime.session.sessionId, cwd: runtime.cwd });
}

function autoTitleFor(text) {
  if (!text || text.startsWith("/") || text === "（请查看图片）") return;
  try {
    if (!runtime.session.sessionName) {
      const name = text.replace(/\s+/g, " ").trim().slice(0, 40);
      if (name) runtime.session.setSessionName(name);
    }
  } catch {
    /* best effort */
  }
}

/**
 * Best-effort @session reference facts: resolve the persisted user entry that
 * carried this prompt, then append one typed edge per mention. Retried briefly
 * because a steering prompt's entry can land a moment after session.prompt
 * resolves; failures never block the run.
 */
function recordReferenceFacts(sessionManager, { leafBefore, promptText, clientMessageId, references }) {
  let attempts = 0;
  const tryOnce = () => {
    attempts += 1;
    try {
      const sourceEntryId = resolveSourceEntryId(sessionManager.getEntries(), { leafBefore, promptText });
      if (!sourceEntryId) return false;
      appendSessionReferenceFacts(sessionManager, {
        clientMessageId,
        references: references.map((ref) => ({ ...ref, sourceEntryId })),
      });
      return true;
    } catch (error) {
      console.error("session_reference fact failed", error);
      return true;
    }
  };
  if (tryOnce()) return;
  const timer = setInterval(() => {
    if (tryOnce() || attempts >= 10) clearInterval(timer);
  }, 300);
  timer.unref?.();
}

/** Bounded reference payload; invalid entries are dropped, not rejected. */
function sanitizeReferences(references) {
  if (!Array.isArray(references)) return [];
  const seen = new Set();
  const out = [];
  for (const ref of references) {
    if (!ref || typeof ref !== "object") continue;
    const targetSessionId = typeof ref.targetSessionId === "string" ? ref.targetSessionId.trim().slice(0, 128) : "";
    const targetTitle = typeof ref.targetTitle === "string" ? ref.targetTitle.trim().slice(0, 256) : "";
    if (!targetSessionId || !targetTitle || seen.has(targetSessionId)) continue;
    seen.add(targetSessionId);
    out.push({ targetSessionId, targetTitle });
  }
  return out.slice(0, 16);
}

async function prompt({ text, behavior, images, clientMessageId, generation: requestGeneration, references }) {
  if (disposed || requestGeneration !== generation) {
    const error = new Error("stale worker generation");
    error.code = "stale_generation";
    throw error;
  }
  const session = runtime.session;
  const promptEpoch = runtimeEpoch;
  const options = { streamingBehavior: behavior ?? "followUp" };
  if (images) options.images = images;
  const refs = sanitizeReferences(references);
  const trackedClientMessageId = typeof clientMessageId === "string" ? clientMessageId : null;
  // The model-visible prompt carries the delimited routing block; the JSONL
  // user entry therefore holds exactly what the model saw, and the renderer
  // strips it for display.
  const referenceBlock = buildSessionReferenceBlock(refs);
  const fullText = referenceBlock ? `${text}${referenceBlock}` : text;
  let leafBefore = null;
  if (refs.length > 0 && typeof session.sessionManager?.getLeafId === "function") {
    leafBefore = session.sessionManager.getLeafId();
  }
  const runPrompt = async () => {
    if (disposed || requestGeneration !== generation || promptEpoch !== runtimeEpoch) {
      const error = new Error("stale worker runtime");
      error.code = "stale_runtime";
      throw error;
    }
    // A prompt issued while a run is streaming steers that run: it joins the
    // open operation instead of opening a second one.
    let operationId = null;
    if (!session.isStreaming && !activeRunId) {
      operationId = `op-${randomUUID()}`;
      beginOperationFact(session, operationId, text);
    }
    if (trackedClientMessageId) activeClientMessageIds.add(trackedClientMessageId);
    try {
      await session.prompt(fullText, options);
      autoTitleFor(text);
      if (operationId) {
        endOperationFact(session, operationId, "completed");
        if (activeRunId === operationId) activeRunId = null;
      }
    } catch (error) {
      if (operationId) {
        const aborted = error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
        endOperationFact(session, operationId, aborted ? "aborted" : "failed", error);
        if (activeRunId === operationId) activeRunId = null;
      }
      throw error;
    } finally {
      if (trackedClientMessageId) activeClientMessageIds.delete(trackedClientMessageId);
      if (refs.length > 0 && trackedClientMessageId) {
        recordReferenceFacts(session.sessionManager, { leafBefore, promptText: fullText, clientMessageId: trackedClientMessageId, references: refs });
      }
    }
  };
  if (session.isStreaming) {
    await runPrompt();
    return undefined;
  }
  const queuedGeneration = generation;
  const run = promptQueue.then(async () => {
    if (disposed || queuedGeneration !== generation || promptEpoch !== runtimeEpoch) {
      const error = new Error("stale worker runtime");
      error.code = "stale_runtime";
      throw error;
    }
    await runPrompt();
  });
  promptQueue = run.catch(() => {});
  return run;
}

/** Map SDK "busy" throws (fork/navigate during a run) to a stable code. */
function withBusyCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/current response|is streaming|wait/i.test(message)) {
    error.code = "session_busy";
    error.message = "生成中无法切换分支或会话，请先停止或等待完成";
  }
  throw error;
}

function packageManagerOf() {
  const session = runtime.session;
  return new DefaultPackageManager({
    cwd: runtime.cwd,
    agentDir: session.settingsManager?.agentDir ?? bridge.AGENT_DIR,
    settingsManager: session.settingsManager,
  });
}

function knownResourcePath(kind, path) {
  const loader = runtime.session.resourceLoader;
  if (kind === "extension") {
    return loader.getExtensions().extensions.some((extension) => (extension.sourceInfo?.path ?? extension.path) === path);
  }
  if (kind === "skill") {
    return loader.getSkills().skills.some((skill) => skill.filePath === path);
  }
  return loader.getPrompts().prompts.some((prompt) => prompt.filePath === path);
}

async function listResourceBundle() {
  const session = runtime.session;
  const loader = session.resourceLoader;
  const manager = packageManagerOf();
  const resolved = await manager.resolve(async () => "skip");
  return buildResourceBundle({
    resolved,
    extensions: loader.getExtensions().extensions.filter((extension) => !extension.hidden),
    skills: loader.getSkills().skills,
    prompts: loader.getPrompts().prompts,
    packages: manager.listConfiguredPackages(),
    projectTrusted: session.settingsManager?.isProjectTrusted?.() !== false,
    skillCommandsEnabled: session.settingsManager?.getEnableSkillCommands?.() !== false,
  });
}

async function recreateForWorkspace(workspace) {
  const replacementEpoch = ++runtimeEpoch;
  promptQueue = Promise.resolve();
  activeClientMessageIds.clear();
  cancelAllExtensionUI();
  try {
    unsubscribe?.();
  } catch {
    /* best effort */
  }
  unsubscribe = undefined;
  await runtime.dispose();
  try {
    runtime = await bridge.createRuntime({ cwd: workspace, extensionsRoot, projectTrusted });
  } catch (error) {
    runtime = null;
    disposed = true;
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.code = wrapped.code ?? "runtime_replacement_failed";
    throw wrapped;
  }
  if (replacementEpoch !== runtimeEpoch) {
    const error = new Error("stale runtime replacement");
    error.code = "stale_runtime";
    throw error;
  }
  runtime.setRebindSession(async (session) => {
    attach(session);
    await bindSession(session);
    bindFacts(session);
  });
  attach(runtime.session);
  await bindSession(runtime.session);
  bindFacts(runtime.session);
  settleSessionFacts();
}

const methods = {
  flush: async () => {
    if (!runtime?.session?.agent?.waitForIdle) return;
    await runtime.session.agent.waitForIdle();
  },
  prompt,
  abort: () => runtime.session.abort(),
  recordCheckpoint: async ({ checkpointId, label, outcome, error }) => {
    try {
      const operationId = appendCheckpointFacts(runtime.session.sessionManager, { checkpointId, label, outcome, error });
      return { operationId };
    } catch (factError) {
      console.error("checkpoint fact failed", factError);
      return { operationId: null };
    }
  },
  appendContextAttached: async ({ targetSessionId, contextSha, lane = "main" }) => {
    if (targetSessionId !== runtime.session.sessionId) {
      const error = new Error("context attachment target must be the active session");
      error.code = "invalid_args";
      throw error;
    }
    appendContextAttachedFact(runtime.session.sessionManager, { targetSessionId, contextSha, lane });
    return { targetSessionId, contextSha };
  },
  getState: () => bridge.snapshotOf(runtime),
  listModels: () => bridge.listModels(runtime),
  configureCustomProvider: async (input) => {
    const provider = validateCustomProvider(input);
    const config = { name: provider.name, baseUrl: provider.baseUrl, api: provider.api, headers: provider.headers, authHeader: provider.authHeader, models: provider.models };
    runtime.session.modelRuntime.registerProvider(provider.id, config);
    return { provider: { ...provider, headers: Object.keys(provider.headers) }, models: bridge.listModels(runtime) };
  },
  setPermissionProfile: async ({ profile }) => {
    permissionProfile = sanitizePermissionProfile(profile);
    await bindSession(runtime.session);
    return { profile: permissionProfile };
  },
  setProviderApiKey: async ({ providerId, apiKey }) => {
    if (typeof providerId !== "string" || !providerId.trim()) {
      const error = new Error("providerId is required");
      error.code = "invalid_args";
      throw error;
    }
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      const error = new Error("apiKey is required");
      error.code = "invalid_args";
      throw error;
    }
    await runtime.session.modelRuntime.setRuntimeApiKey(providerId.trim(), apiKey.trim());
    return bridge.authStatusOf(runtime);
  },
  removeProviderApiKey: async ({ providerId }) => {
    if (typeof providerId !== "string" || !providerId.trim()) {
      const error = new Error("providerId is required");
      error.code = "invalid_args";
      throw error;
    }
    await runtime.session.modelRuntime.removeRuntimeApiKey(providerId.trim());
    return bridge.authStatusOf(runtime);
  },
  setModel: ({ provider, modelId }) => {
    const model = bridge.findModel(runtime, provider, modelId);
    if (!model) {
      const error = new Error(`Model ${provider}/${modelId} is not available`);
      error.code = "not_found";
      throw error;
    }
    return runtime.session.setModel(model).then(() => bridge.snapshotOf(runtime));
  },
  setThinkingLevel: ({ level }) => {
    runtime.session.setThinkingLevel(level);
    return bridge.snapshotOf(runtime);
  },
  listCommands: () => bridge.listCommands(runtime),
  compact: async () => {
    const sessionManager = runtime.session.sessionManager;
    const knownIds = new Set(sessionManager.getEntries().map((entry) => entry.id));
    try {
      await runtime.session.compact();
    } catch (error) {
      recordCompactionFact(sessionManager, knownIds, error);
      throw error;
    }
    recordCompactionFact(sessionManager, knownIds, null);
    return bridge.snapshotOf(runtime);
  },
  authStatus: () => bridge.authStatusOf(runtime),
  newSession: async ({ workspace, title, projectTrusted: trusted }) => {
    const nextTrusted = typeof trusted === "boolean" ? trusted : projectTrusted;
    const trustChanged = nextTrusted !== projectTrusted;
    projectTrusted = nextTrusted;
    if ((workspace && workspace !== runtime.cwd) || trustChanged) {
      await recreateForWorkspace(workspace || runtime.cwd);
    }
    const cancelled = await runtime.newSession();
    if (cancelled.cancelled) {
      const error = new Error("Session switch cancelled");
      error.code = "cancelled";
      throw error;
    }
    if (title) runtime.session.setSessionName(String(title).slice(0, 256));
    return bridge.sessionRecordOf(runtime);
  },
  switchSession: async ({ sessionId }) => {
    const sessionPath = await bridge.resolveSessionPath(sessionId);
    if (!sessionPath) {
      const error = new Error("Session not found");
      error.code = "not_found";
      throw error;
    }
    const cancelled = await runtime.switchSession(sessionPath);
    if (cancelled.cancelled) {
      const error = new Error("Session switch cancelled");
      error.code = "cancelled";
      throw error;
    }
    settleSessionFacts();
    return bridge.sessionRecordOf(runtime);
  },
  fork: async ({ entryId }) => {
    try {
      const result = await runtime.fork(entryId, { position: "before" });
      if (result.cancelled) {
        const error = new Error("Fork cancelled");
        error.code = "cancelled";
        throw error;
      }
      return { record: bridge.sessionRecordOf(runtime), selectedText: result.selectedText ?? "" };
    } catch (error) {
      throw withBusyCode(error);
    }
  },
  clone: async () => {
    const leafId = runtime.session.sessionManager.getLeafId();
    if (!leafId) {
      const error = new Error("当前会话还没有可复制的内容");
      error.code = "not_found";
      throw error;
    }
    try {
      const result = await runtime.fork(leafId, { position: "at" });
      if (result.cancelled) {
        const error = new Error("Clone cancelled");
        error.code = "cancelled";
        throw error;
      }
      return { record: bridge.sessionRecordOf(runtime) };
    } catch (error) {
      throw withBusyCode(error);
    }
  },
  navigateTree: ({ targetId }) =>
    runtime.session
      .navigateTree(targetId)
      .then(() => bridge.sessionRecordOf(runtime))
      .catch((error) => {
        throw withBusyCode(error);
      }),
  clearQueue: () => runtime.session.clearQueue(),
  getSessionTree: () => bridge.sessionTreeOf(runtime),
  setSessionName: ({ name }) => {
    runtime.session.setSessionName(String(name).slice(0, 256));
    return bridge.snapshotOf(runtime);
  },
  updateSettings: ({ steeringMode, followUpMode, autoCompaction, autoRetry }) => {
    const session = runtime.session;
    if (steeringMode === "all" || steeringMode === "one-at-a-time") session.setSteeringMode(steeringMode);
    if (followUpMode === "all" || followUpMode === "one-at-a-time") session.setFollowUpMode(followUpMode);
    if (typeof autoCompaction === "boolean") session.setAutoCompactionEnabled(autoCompaction);
    if (typeof autoRetry === "boolean") session.setAutoRetryEnabled(autoRetry);
    return bridge.snapshotOf(runtime);
  },
  getThinking: ({ entryId }) => ({ text: bridge.getThinking(runtime, entryId) }),
  getToolDetail: ({ toolCallId }) => bridge.getToolDetail(runtime, toolCallId),
  telemetry: () => bridge.telemetryOf(runtime),
  getSystemPrompt: () => ({ systemPrompt: runtime.session.systemPrompt ?? "" }),
  bash: ({ command, excludeFromContext }) =>
    runtime.session.executeBash(command, undefined, {
      excludeFromContext: excludeFromContext === true,
      id: `user-bash-${Date.now()}`,
    }),
  sessionRecord: () => bridge.sessionRecordOf(runtime),
  /** Extensions / skills / prompt templates discovered for the active cwd. */
  listResources: async () => listResourceBundle(),
  reloadResources: async () => {
    if (runtime.session.isStreaming) {
      const error = new Error("生成中无法重载资源，请先停止或等待完成");
      error.code = "session_busy";
      throw error;
    }
    await runtime.session.reload();
    return listResourceBundle();
  },
  installLocalResource: async ({ source, project }) => {
    const localSource = assertLocalSource(source);
    const manager = packageManagerOf();
    await manager.installAndPersist(localSource, { local: project === true });
    await runtime.session.reload();
    return listResourceBundle();
  },
  removeLocalResource: async ({ source, project }) => {
    const localSource = assertLocalSource(source);
    const manager = packageManagerOf();
    await manager.removeAndPersist(localSource, { local: project === true });
    await runtime.session.reload();
    return listResourceBundle();
  },
  setResourceEnabled: async ({ kind, path, enabled, project, baseDir }) => {
    if (!RESOURCE_KINDS.includes(kind)) {
      const error = new Error("kind must be extension|skill|prompt");
      error.code = "invalid_args";
      throw error;
    }
    if (typeof path !== "string" || !path.trim()) {
      const error = new Error("path is required");
      error.code = "invalid_args";
      throw error;
    }
    if (!knownResourcePath(kind, path)) {
      const error = new Error("未知资源，无法修改启用状态");
      error.code = "not_found";
      throw error;
    }
    const settings = runtime.session.settingsManager;
    const arrayKey = RESOURCE_ARRAY_KEYS[kind];
    const useProject = project === true;
    if (useProject && settings.isProjectTrusted?.() === false) {
      const error = new Error("当前项目未信任，无法修改项目资源");
      error.code = "trust_required";
      throw error;
    }
    const current = useProject
      ? [...(settings.getProjectSettings()?.[arrayKey] ?? [])]
      : [...(settings.getGlobalSettings()?.[arrayKey] ?? [])];
    const next = nextScopedPaths(current, path, typeof baseDir === "string" ? baseDir : undefined, enabled !== false);
    if (useProject) {
      if (kind === "extension") settings.setProjectExtensionPaths(next);
      else if (kind === "skill") settings.setProjectSkillPaths(next);
      else settings.setProjectPromptTemplatePaths(next);
    } else if (kind === "extension") settings.setExtensionPaths(next);
    else if (kind === "skill") settings.setSkillPaths(next);
    else settings.setPromptTemplatePaths(next);
    await runtime.session.reload();
    return listResourceBundle();
  },
  setSkillModelInvocation: async ({ filePath, disable }) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      const error = new Error("filePath is required");
      error.code = "invalid_args";
      throw error;
    }
    if (!knownResourcePath("skill", filePath) || !existsSync(filePath)) {
      const error = new Error("Skill 文件不存在");
      error.code = "not_found";
      throw error;
    }
    if (!lstatSync(filePath).isFile()) {
      const error = new Error("Skill 必须是普通文件");
      error.code = "invalid_resource";
      throw error;
    }
    const current = readFileSync(filePath, "utf8");
    const temp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(temp, setDisableModelInvocationFrontmatter(current, disable === true), { encoding: "utf8", mode: 0o600 });
    renameSync(temp, filePath);
    await runtime.session.reload();
    return listResourceBundle();
  },
  setSkillCommandsEnabled: async ({ enabled }) => {
    runtime.session.settingsManager.setEnableSkillCommands(enabled !== false);
    await runtime.session.reload();
    return listResourceBundle();
  },
  extensionUiResponse: async (response) => {
    if (!isExtensionUIResponse(response)) {
      const error = new Error("invalid extension UI response");
      error.code = "invalid_args";
      throw error;
    }
    const pending = pendingExtensionUI.get(response.id);
    if (!pending || pending.sessionId !== response.sessionId || pending.generation !== response.generation || (pending.runId ?? null) !== (response.runId ?? null)) {
      const error = new Error("stale extension UI response");
      error.code = "stale_generation";
      throw error;
    }
    settleExtensionUI(response.id, response.cancelled === true ? { cancelled: true } : ("confirmed" in response ? { confirmed: response.confirmed } : { value: response.value }));
    return { accepted: true };
  },
  extensionUiCancel: async (response) => {
    if (!isExtensionUIResponse({ ...response, cancelled: true })) {
      const error = new Error("invalid extension UI cancellation");
      error.code = "invalid_args";
      throw error;
    }
    const pending = pendingExtensionUI.get(response.id);
    if (!pending || pending.sessionId !== response.sessionId || pending.generation !== response.generation || (pending.runId ?? null) !== (response.runId ?? null)) {
      const error = new Error("stale extension UI cancellation");
      error.code = "stale_generation";
      throw error;
    }
    settleExtensionUI(response.id, { cancelled: true });
    return { accepted: true };
  },
  dispose: async () => {
    disposed = true;
    activeClientMessageIds.clear();
    cancelAllExtensionUI();
    promptQueue = Promise.resolve();
    try {
      unsubscribe?.();
    } catch {
      /* best effort */
    }
    unsubscribe = null;
    if (runtime) {
      await runtime.dispose();
      runtime = null;
    }
  },
};

const METHOD_NAMES = new Set(Object.keys(methods));

process.parentPort.on("message", async (event) => {
  const message = event?.data && typeof event.data === "object" ? event.data : event;
  if (!message || typeof message !== "object") return;
  if (message.type === "extension-ui-response") {
    try {
      await methods.extensionUiResponse(message.response ?? {});
    } catch {
      /* stale UI responses are intentionally ignored */
    }
    return;
  }
  if (message.type === "extension-ui-cancel") {
    try {
      await methods.extensionUiCancel(message.response ?? {});
    } catch {
      /* stale UI cancellations are intentionally ignored */
    }
    return;
  }
  if (message.type === "init") {
    try {
      await init(message);
    } catch (error) {
      post({ type: "init-error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
    return;
  }
  if (message.type === "req") {
    if (!isWorkerRequest(message)) {
      post({ type: "resp", id: typeof message.id === "string" ? message.id : "invalid", error: "invalid worker request", code: "invalid_request" });
      return;
    }
    const requestEpoch = message.args?.runtimeEpoch;
    if (message.generation !== generation || (requestEpoch !== undefined && requestEpoch !== runtimeEpoch) || !METHOD_NAMES.has(message.method) || (disposed && message.method !== "dispose")) {
      post({ type: "resp", id: message.id, error: "stale or unsupported worker request", code: requestEpoch !== undefined && requestEpoch !== runtimeEpoch ? "stale_runtime" : "stale_generation" });
      return;
    }
    try {
      const data = await methods[message.method](message.args ?? {});
      post({ type: "resp", id: message.id, data: data === undefined ? null : data });
    } catch (error) {
      post({
        type: "resp",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code,
      });
    }
    return;
  }
  if (message.type === "dispose") {
    try {
      await methods.dispose();
    } catch {
      /* best effort */
    }
  }
});

process.on("uncaughtException", (error) => {
  try {
    post({ type: "worker-error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
  } catch {
    /* best effort */
  }
  process.exit(1);
});
