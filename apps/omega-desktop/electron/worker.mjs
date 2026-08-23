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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** @type {import("./agent-bridge.js").ReturnType<typeof bridge.createRuntime> | null} */
let runtime = null;
let extensionsRoot = null;
let unsubscribe = null;
let generation = 0;
let disposed = false;
let eventSequence = 0;
let activeRunId = null;
/** Serializes non-streaming prompts; streaming prompts bypass it (steer). */
let promptQueue = Promise.resolve();

function post(message) {
  process.parentPort.postMessage(message);
}

function attach(session) {
  try {
    unsubscribe?.();
  } catch {
    /* best effort */
  }
  unsubscribe = session.subscribe((event) => {
    if (event?.type === "agent_start" || event?.type === "turn_start") activeRunId = activeRunId ?? `run-${Date.now()}-${eventSequence + 1}`;
    if (event?.type === "agent_end" || event?.type === "turn_end" || event?.type === "agent_settled") activeRunId = null;
    const meta = {
      sequence: ++eventSequence,
      sessionId: runtime?.session?.sessionId ?? session?.sessionId,
      runId: activeRunId,
      generation,
    };
    if (event?.type === "agent_settled") post({ type: "settled", meta });
    for (const projected of bridge.toRendererEvent(event)) {
      if (projected) post({ type: "app-event", event: projected, meta });
    }
  });
}

let projectTrusted = true;

async function init({ cwd, extensionsRoot: root, sessionId, generation: nextGeneration, projectTrusted: trusted }) {
  generation = Number.isInteger(nextGeneration) ? nextGeneration : generation + 1;
  eventSequence = 0;
  activeRunId = null;
  disposed = false;
  extensionsRoot = root;
  projectTrusted = trusted !== false;
  runtime = await bridge.createRuntime({ cwd, extensionsRoot: root, projectTrusted });
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
  runtime.setRebindSession(async (session) => attach(session));
  attach(runtime.session);
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

async function prompt({ text, behavior, images, generation: requestGeneration }) {
  if (disposed || requestGeneration !== generation) {
    const error = new Error("stale worker generation");
    error.code = "stale_generation";
    throw error;
  }
  const session = runtime.session;
  const options = { streamingBehavior: behavior ?? "followUp" };
  if (images) options.images = images;
  if (session.isStreaming) {
    await session.prompt(text, options);
    autoTitleFor(text);
    return undefined;
  }
  const queuedGeneration = generation;
  const run = promptQueue.then(async () => {
    if (disposed || queuedGeneration !== generation) {
      const error = new Error("stale worker generation");
      error.code = "stale_generation";
      throw error;
    }
    await runtime.session.prompt(text, options);
    autoTitleFor(text);
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
  try {
    unsubscribe?.();
  } catch {
    /* best effort */
  }
  unsubscribe = undefined;
  await runtime.dispose();
  runtime = await bridge.createRuntime({ cwd: workspace, extensionsRoot, projectTrusted });
  runtime.setRebindSession(async (session) => attach(session));
  attach(runtime.session);
}

const methods = {
  flush: async () => {
    if (!runtime?.session?.agent?.waitForIdle) return;
    await runtime.session.agent.waitForIdle();
  },
  prompt,
  abort: () => runtime.session.abort(),
  getState: () => bridge.snapshotOf(runtime),
  listModels: () => bridge.listModels(runtime),
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
  compact: () => runtime.session.compact().then(() => bridge.snapshotOf(runtime)),
  authStatus: () => bridge.authStatusOf(runtime),
  listPiSessions: ({ cwd }) => bridge.listPiSessions(cwd),
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
  getForkCandidates: () => bridge.forkCandidatesOf(runtime),
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
  getSystemPrompt: () => ({ systemPrompt: runtime.session.systemPrompt ?? "" }),
  bash: ({ command, excludeFromContext }) =>
    runtime.session.executeBash(command, undefined, {
      excludeFromContext: excludeFromContext === true,
      id: `user-bash-${Date.now()}`,
    }),
  resolveSessionPath: ({ sessionId }) => bridge.resolveSessionPath(sessionId),
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
    const current = readFileSync(filePath, "utf8");
    writeFileSync(filePath, setDisableModelInvocationFrontmatter(current, disable === true), "utf8");
    await runtime.session.reload();
    return listResourceBundle();
  },
  setSkillCommandsEnabled: async ({ enabled }) => {
    runtime.session.settingsManager.setEnableSkillCommands(enabled !== false);
    await runtime.session.reload();
    return listResourceBundle();
  },
  dispose: async () => {
    disposed = true;
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
  if (message.type === "init") {
    try {
      await init(message);
    } catch (error) {
      post({ type: "init-error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
    return;
  }
  if (message.type === "req") {
    if (message.generation !== generation || !METHOD_NAMES.has(message.method) || (disposed && message.method !== "dispose")) {
      post({ type: "resp", id: message.id, error: "stale or unsupported worker request", code: "stale_generation" });
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
  post({ type: "worker-error", error: error instanceof Error ? error.stack ?? error.message : String(error) });
});
