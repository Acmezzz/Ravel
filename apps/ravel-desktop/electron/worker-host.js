/**
 * Single utilityProcess worker host. Session-keyed pooling lives in
 * worker-pool.js; this class only owns one child, generation, and RPC map.
 */
import { utilityProcess } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isWorkerEvent, isWorkerFactsAppended, isWorkerResponse } from "./worker-protocol.js";
import { DEFAULT_PERMISSION_PROFILE } from "./permission-profiles.js";
import { normalizeUtilityProcessError, utilityProcessError } from "./process-log.js";

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RPC_TIMEOUT = 120_000;
const PROMPT_RPC_TIMEOUT = 30 * 60_000;

export class WorkerHost {
  constructor({ workerPath = join(MAIN_DIR, "worker.mjs"), timeout = DEFAULT_RPC_TIMEOUT } = {}) {
    this.workerPath = workerPath;
    this.timeout = timeout;
    this.child = null;
    this.pending = new Map();
    this.seq = 0;
    this.generation = 0;
    this.state = "dead";
    this.restartCount = 0;
    this.stopping = false;
    this.cwd = null;
    this.extensionsRoot = null;
    this.sessionId = null;
    this.projectTrusted = true;
    this.permissionProfile = DEFAULT_PERMISSION_PROFILE;
    this.modeProfile = "default";
    this.runtimeCredentials = {};
    this.mcpCredentials = {};
    this.customProviders = {};
    this.activating = false;
    this.onEvent = null;
    this.onFactsAppended = null;
    this.onExtensionUIRequest = null;
    this.onSettled = null;
    this.onError = null;
    this.onTransport = null;
    this._initResolve = null;
    this._initReject = null;
    this._initTimer = null;
  }

  async start(cwd, extensionsRoot, sessionId = this.sessionId, projectTrusted = this.projectTrusted, permissionProfile = this.permissionProfile, modeProfile = this.modeProfile) {
    this.cwd = cwd;
    this.extensionsRoot = extensionsRoot;
    this.sessionId = sessionId ?? null;
    this.projectTrusted = projectTrusted !== false;
    this.permissionProfile = permissionProfile ?? this.permissionProfile;
    this.modeProfile = typeof modeProfile === "string" ? modeProfile : this.modeProfile;
    this.stopping = false;
    this.state = "starting";
    const generation = ++this.generation;
    const child = utilityProcess.fork(this.workerPath, [], { stdio: "ignore" });
    this.child = child;
    child.on("message", (message) => this._handle(message, generation));
    child.on("error", (type, location, report) => this._handleDeath(generation, utilityProcessError(type, location, report)));
    child.on("exit", (code, signal) => {
      if (this.stopping) return;
      this._handleDeath(generation, utilityProcessError("exit", "worker", `code=${code ?? "unknown"}${signal ? ` signal=${signal}` : ""}`));
    });
    const done = new Promise((resolvePromise, rejectPromise) => {
      this._initResolve = resolvePromise;
      this._initReject = rejectPromise;
      this._initTimer = setTimeout(() => rejectPromise(new Error("Worker init timeout (60s)")), 60_000);
    });
    this.onTransport?.("starting");
    child.postMessage({
      type: "init",
      cwd,
      extensionsRoot,
      sessionId: this.sessionId,
      generation,
      projectTrusted: this.projectTrusted,
      permissionProfile: this.permissionProfile,
      modeProfile: this.modeProfile,
      runtimeCredentials: this.runtimeCredentials,
      mcpCredentials: this.mcpCredentials,
      customProviders: this.customProviders,
    });
    try {
      const info = await done;
      if (generation === this.generation && this.state === "starting") {
        this.sessionId = info.sessionId ?? this.sessionId;
        this.restartCount = 0;
        this.state = "ready";
        this.onTransport?.("ready");
      }
      return info;
    } catch (error) {
      if (generation === this.generation) this._handleDeath(generation, error);
      throw error;
    }
  }

  _rejectInit(error) {
    clearTimeout(this._initTimer);
    this._initTimer = null;
    const reject = this._initReject;
    this._initResolve = null;
    this._initReject = null;
    reject?.(error);
  }

  _handleDeath(generation, error) {
    if (generation !== this.generation || this.state === "dead" || this.state === "stopping") return;
    this.state = "dead";
    this._rejectInit(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("worker unavailable"), { code: "worker_unavailable" }));
    }
    this.pending.clear();
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = normalizeUtilityProcessError(error?.diagnostic?.type ?? "error", error?.diagnostic?.location ?? "worker", error?.diagnostic?.report ?? message);
    this.onError?.(diagnostic);
    try {
      this.child?.kill();
    } catch {
      /* already gone */
    }
    if (this.child && generation === this.generation) this.child = null;
    const canAutoRestart = !this.stopping && this.restartCount < 1 && this.cwd && this.extensionsRoot && !this.activating;
    if (canAutoRestart) {
      this.restartCount += 1;
      this.state = "restarting";
      this.onTransport?.("restarting", { error: message, diagnostic: normalizeUtilityProcessError(error?.diagnostic?.type ?? "error", error?.diagnostic?.location ?? "worker", error?.diagnostic?.report ?? message) });
      setTimeout(() => {
        if (this.stopping) return;
        void this.start(this.cwd, this.extensionsRoot, this.sessionId, this.projectTrusted, this.permissionProfile, this.modeProfile).catch((restartError) => {
          const restartMessage = restartError instanceof Error ? restartError.message : String(restartError);
          this.onTransport?.("dead", { error: restartMessage, canRetry: true, diagnostic: normalizeUtilityProcessError("restart_failed", "worker", restartMessage) });
        });
      }, 250);
      return;
    }
    this.onTransport?.("dead", { error: message, canRetry: !this.stopping, diagnostic: normalizeUtilityProcessError(error?.diagnostic?.type ?? "error", error?.diagnostic?.location ?? "worker", error?.diagnostic?.report ?? message) });
  }

  _handle(message, generation) {
    if (generation !== this.generation || !message || typeof message !== "object") return;
    if (message.type === "init-done") {
      clearTimeout(this._initTimer);
      this._initTimer = null;
      this._initResolve?.(message);
      this._initResolve = null;
      this._initReject = null;
      return;
    }
    if (message.type === "init-error") {
      this._rejectInit(new Error(message.error));
      return;
    }
    if (message.type === "facts-appended") {
      if (!isWorkerFactsAppended(message) || message.generation !== generation || message.sessionId !== this.sessionId) return;
      this.onFactsAppended?.(message);
      return;
    }
    if (message.type === "app-event") {
      if (!isWorkerEvent(message)) return;
      this.onEvent?.(message.event, message.meta);
      return;
    }
    if (message.type === "extension-ui-request") {
      if (!isWorkerEvent(message)) return;
      this.onExtensionUIRequest?.(message.request);
      return;
    }
    if (message.type === "settled") {
      this.onSettled?.(message.meta);
      return;
    }
    if (message.type === "worker-error") {
      const diagnostic = normalizeUtilityProcessError("worker-error", "worker", message.error);
      process.stderr.write(`[worker] ${diagnostic.report}\n`);
      this.onError?.(diagnostic);
      return;
    }
    if (message.type === "resp") {
      if (!isWorkerResponse(message)) return;
      const pending = this.pending.get(message.id);
      if (!pending || pending.generation !== generation) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(message.error);
        if (message.code) error.code = message.code;
        pending.reject(error);
      } else {
        pending.resolve(message.data ?? null);
      }
    }
  }

  call(method, args) {
    if (!this.child || (this.state !== "ready" && !(this.state === "stopping" && (method === "dispose" || method === "flush"))) || (this.stopping && method !== "dispose" && method !== "flush")) {
      return Promise.reject(new Error("session not ready"));
    }
    const id = `req-${++this.seq}`;
    const generation = this.generation;
    // `bash` can block on a durable approval dialog like `prompt` can.
    const timeout = method === "prompt" || method === "bash" ? PROMPT_RPC_TIMEOUT : this.timeout;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(Object.assign(new Error(`Worker RPC timeout: ${method}`), { code: "worker_timeout" }));
      }, timeout);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer, generation });
      const wireArgs = { ...(args ?? {}), generation };
      try {
        this.child.postMessage({ type: "req", id, method, args: wireArgs, generation });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        const failure = error instanceof Error ? error : new Error(String(error));
        failure.code = "worker_unavailable";
        rejectPromise(failure);
        this._handleDeath(generation, failure);
      }
    });
  }

  async kill() {
    if (!this.child && this.state === "dead") return;
    this.stopping = true;
    const child = this.child;
    const canDispose = Boolean(child && this.state === "ready");
    this.state = "stopping";
    this._rejectInit(Object.assign(new Error("worker disposed"), { code: "worker_disposed" }));
    this.onTransport?.("stopping");
    if (canDispose) {
      try {
        await this.call("flush");
      } catch {
        /* best effort: dispose still has a bounded path */
      }
      try {
        await this.call("dispose");
      } catch {
        /* best effort */
      }
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("worker disposed"), { code: "worker_disposed" }));
    }
    this.pending.clear();
    try {
      child?.kill();
    } catch {
      /* already gone */
    }
    this.child = null;
    this.state = "dead";
    this.onTransport?.("dead");
  }
}
