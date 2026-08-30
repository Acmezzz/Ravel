/**
 * Host for the isolated Histos engine process.
 *
 * Production uses Electron utilityProcess.fork. Tests can inject a Node
 * child_process.fork-compatible factory; neither child handles nor filesystem
 * paths are part of the host's public result surface.
 */
import { fork as nodeFork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as electron from "electron";
import {
  HISTOS_METHODS,
  createHistosProviderResult,
  createHistosRequest,
  isHistosProviderRequest,
  isHistosResponse,
} from "./histos-protocol.js";
import { normalizeUtilityProcessError, utilityProcessError } from "./process-log.js";

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_INIT_TIMEOUT = 30_000;
const METHOD_SET = new Set(HISTOS_METHODS);

function hostError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

/**
 * Adapt the two child APIs used by Electron and Node. The returned adapter is
 * private and is intentionally never returned from HistosHost methods.
 */
function defaultFork(workerPath) {
  const utilityProcess = electron.utilityProcess ?? electron.default?.utilityProcess;
  if (utilityProcess && typeof utilityProcess.fork === "function") {
    return utilityProcess.fork(workerPath, [], { stdio: "ignore" });
  }
  return nodeFork(workerPath, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
}

function sendTo(child, message) {
  if (typeof child.postMessage === "function") {
    child.postMessage(message);
    return;
  }
  if (typeof child.send === "function") {
    child.send(message);
    return;
  }
  throw hostError("Histos child has no message transport", "worker_unavailable");
}

function killChild(child) {
  try {
    child?.kill?.();
  } catch {
    /* already gone */
  }
}

/**
 * Owns one Histos process and its request correlation map.
 *
 * `start` accepts the engine options (`workspaceId`, `databasePath`, and so
 * on). `switchWorkspace` drains the old process before starting a new
 * generation, so responses from the old process cannot resolve new calls.
 */
export class HistosHost {
  constructor({
    workerPath = join(MAIN_DIR, "histos-worker.mjs"),
    timeout = DEFAULT_TIMEOUT,
    initTimeout = DEFAULT_INIT_TIMEOUT,
    fork = defaultFork,
    timers = { setTimeout, clearTimeout },
    onError = null,
    onStateChange = null,
    onProviderRequest = null,
  } = {}) {
    if (typeof fork !== "function") throw hostError("fork must be a function", "invalid_args");
    if (onProviderRequest !== null && typeof onProviderRequest !== "function") throw hostError("onProviderRequest must be a function", "invalid_args");
    this.workerPath = workerPath;
    this.timeout = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT;
    this.initTimeout = Number.isFinite(initTimeout) && initTimeout > 0 ? initTimeout : DEFAULT_INIT_TIMEOUT;
    this.fork = fork;
    this.timers = timers;
    this.onError = onError;
    this.onStateChange = onStateChange;
    this.onProviderRequest = onProviderRequest;
    this.child = null;
    this.pending = new Map();
    this.seq = 0;
    this.generation = 0;
    this.state = "dead";
    this.workspaceId = null;
    this.startPromise = null;
    this.stopping = false;
  }

  _setState(state, detail) {
    this.state = state;
    this.onStateChange?.(state, detail);
  }

  _rejectPending(error, generation = null) {
    for (const [id, pending] of this.pending) {
      if (generation !== null && pending.generation !== generation) continue;
      this.pending.delete(id);
      this.timers.clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  _handleDeath(child, generation, error) {
    if (child !== this.child || generation !== this.generation) return;
    if (this.state === "dead") return;
    const failure = error instanceof Error ? error : hostError(String(error), "worker_unavailable");
    if (!failure.code) failure.code = "worker_unavailable";
    this._rejectPending(failure, generation);
    this.child = null;
    const intentional = this.stopping || this.state === "stopping";
    const diagnostic = normalizeUtilityProcessError(failure.diagnostic?.type ?? "error", failure.diagnostic?.location ?? "histos", failure.diagnostic?.report ?? failure.message);
    this._setState("dead", intentional ? undefined : { error: failure.message, diagnostic });
    if (!intentional) this.onError?.(diagnostic);
  }

  _handleMessage(child, generation, message) {
    if (child !== this.child || generation !== this.generation || !isHistosResponse(message)) return;
    const pending = this.pending.get(message.id);
    if (!pending || pending.generation !== generation) return;
    this.pending.delete(message.id);
    this.timers.clearTimeout(pending.timer);
    if (message.generation !== generation) {
      pending.reject(hostError("stale Histos response", "stale_generation"));
      return;
    }
    if (message.error !== undefined) {
      pending.reject(hostError(message.error, message.code));
    } else {
      pending.resolve(message.data ?? null);
    }
  }

  _attach(child, generation) {
    const onMessage = (message) => {
      const wireMessage = message && typeof message.type === "string" ? message : message?.data;
      if (isHistosProviderRequest(wireMessage)) {
        this._handleProviderRequest(child, wireMessage);
        return;
      }
      // Histos event bus push: relay every "histos-event" envelope to the
      // registered listener (Main → renderer). The host does not interpret
      // the payload, so future event types cost nothing.
      if (wireMessage && wireMessage.type === "histos-event" && typeof wireMessage.eventType === "string" && this.onHistosEvent) {
        try { this.onHistosEvent(wireMessage.eventType, wireMessage.payload, generation); }
        catch (error) { this.onError?.(normalizeUtilityProcessError("host_callback_error", "histos-host", error)); }
        return;
      }
      this._handleMessage(child, generation, wireMessage);
    };
    const onError = (type, location, report) => this._handleDeath(child, generation, utilityProcessError(type, location, report));
    const onExit = (code, signal) => {
      if (this.stopping) return;
      this._handleDeath(child, generation, utilityProcessError("exit", "histos", `code=${code ?? "unknown"}${signal ? ` signal=${signal}` : ""}`));
    };
    child.on?.("message", onMessage);
    child.on?.("error", onError);
    child.on?.("exit", onExit);
  }

  /**
   * Relay one provider request from the worker to Main's handler and post the
   * result back. Without a handler (or after the child was replaced) the
   * request fails closed with the canonical offline code, so a condensation
   * never fabricates summaries.
   */
  _handleProviderRequest(child, message) {
    if (child !== this.child) return;
    const handler = this.onProviderRequest;
    if (typeof handler !== "function") {
      sendTo(child, createHistosProviderResult(message.reqId, null, "Semantic provider is not configured", "semantic_provider_unavailable"));
      return;
    }
    let settled = false;
    const reply = (result) => {
      if (settled || child !== this.child) return;
      settled = true;
      try {
        sendTo(child, result);
      } catch {
        /* child transport is gone; the worker-side timeout will surface */
      }
    };
    Promise.resolve()
      .then(() => handler(message.request ?? {}))
      .then(
        (data) => reply(createHistosProviderResult(message.reqId, data)),
        (error) => reply(createHistosProviderResult(message.reqId, null, error instanceof Error ? error.message : String(error), error?.code)),
      );
  }

  _request(method, args, generation, timeout, allowedStates = ["ready"]) {
    if (!METHOD_SET.has(method)) return Promise.reject(hostError(`Unsupported Histos method: ${method}`, "unsupported_method"));
    if (!this.child || !allowedStates.includes(this.state) || generation !== this.generation) {
      return Promise.reject(hostError("Histos worker is not ready", "not_ready"));
    }
    const id = `histos-${++this.seq}`;
    const request = createHistosRequest(id, generation, method, args);
    const promise = new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        reject(hostError(`Histos RPC timeout: ${method}`, "worker_timeout"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, generation, method, promise: null });
      try {
        sendTo(this.child, request);
      } catch (error) {
        this.pending.delete(id);
        this.timers.clearTimeout(timer);
        const failure = error instanceof Error ? error : hostError(String(error), "worker_unavailable");
        if (!failure.code) failure.code = "worker_unavailable";
        reject(failure);
        this._handleDeath(this.child, generation, failure);
      }
    });
    this.pending.get(id).promise = promise;
    return promise;
  }

  async _start(options) {
    if (!isObject(options) || Array.isArray(options)) throw hostError("Histos start options must be an object", "invalid_args");
    if (this.child) await this.kill();
    this.stopping = false;
    const generation = ++this.generation;
    const child = this.fork(this.workerPath);
    this.child = child;
    this._setState("starting");
    this._attach(child, generation);
    try {
      const info = await this._request("init", options, generation, this.initTimeout, ["starting"]);
      if (child !== this.child || generation !== this.generation || this.state !== "starting") {
        throw hostError("stale Histos initialization", "stale_generation");
      }
      this.workspaceId = typeof info?.workspaceId === "string" ? info.workspaceId : options.workspaceId ?? null;
      this._setState("ready");
      return info;
    } catch (error) {
      if (child === this.child) {
        this.stopping = true;
        this._rejectPending(error, generation);
        killChild(child);
        this.child = null;
        this._setState("dead");
        this.stopping = false;
      }
      throw error;
    }
  }

  start(options) {
    if (this.startPromise) return this.startPromise;
    const operation = this._start(options);
    let tracked;
    tracked = operation.finally(() => {
      if (this.startPromise === tracked) this.startPromise = null;
    });
    this.startPromise = tracked;
    return tracked;
  }

  call(method, args = {}, timeout = this.timeout) {
    return this._request(method, args, this.generation, timeout);
  }

  /** Wait for all requests issued before this call to settle. */
  async flush() {
    if (!this.child || this.state !== "ready") return;
    const generation = this.generation;
    const before = [...this.pending.values()]
      .filter((pending) => pending.generation === generation)
      .map((pending) => pending.promise);
    if (before.length === 0) return;
    await Promise.all(before);
  }

  async dispose() {
    const child = this.child;
    if (!child) {
      this._setState("dead");
      return;
    }
    const generation = this.generation;
    this.stopping = true;
    this._setState("stopping");
    try {
      await this.flush();
      await this._request("dispose", {}, generation, this.timeout, ["stopping"]);
    } catch {
      /* disposal is best effort; kill below is the hard boundary */
    } finally {
      this._rejectPending(hostError("Histos worker disposed", "worker_disposed"), generation);
      killChild(child);
      if (this.child === child) this.child = null;
      this._setState("dead");
      this.stopping = false;
    }
  }

  /** Immediately terminate the process and reject all outstanding calls. */
  async kill() {
    const child = this.child;
    if (!child) {
      this._setState("dead");
      return;
    }
    this.stopping = true;
    this._setState("stopping");
    this._rejectPending(hostError("Histos worker killed", "worker_killed"));
    killChild(child);
    if (this.child === child) this.child = null;
    this._setState("dead");
    this.stopping = false;
  }

  async switchWorkspace(options) {
    await this.dispose();
    return this.start(options);
  }

  getSnapshot() {
    return Object.freeze({ state: this.state, generation: this.generation, workspaceId: this.workspaceId });
  }
}

export function createHistosHost(options) {
  return new HistosHost(options);
}

export { HISTOS_METHODS };
export default HistosHost;
