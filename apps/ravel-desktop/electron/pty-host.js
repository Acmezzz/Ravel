import { fork as nodeFork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as electron from "electron";
import { PTY_METHODS, createPtyRequest, isPtyResponse, isPtyOutputEvent, isPtyExitEvent } from "./pty-protocol.js";

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
const METHODS = new Set(PTY_METHODS);
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_INIT_TIMEOUT = 10_000;
const hostError = (message, code) => Object.assign(new Error(message), { code });

function defaultFork(path) {
  const utilityProcess = electron.utilityProcess ?? electron.default?.utilityProcess;
  if (utilityProcess?.fork) return utilityProcess.fork(path, [], { stdio: "ignore" });
  return nodeFork(path, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
}
function send(child, message) {
  if (child.postMessage) child.postMessage(message);
  else if (child.send) child.send(message);
  else throw hostError("PTY child has no message transport", "worker_unavailable");
}
function terminate(child) { try { child?.kill?.(); } catch { /* already gone */ } }

export class PtyHost {
  constructor({ workerPath = join(MAIN_DIR, "pty-worker.mjs"), fork = defaultFork, timeout = DEFAULT_TIMEOUT, initTimeout = DEFAULT_INIT_TIMEOUT, timers = { setTimeout, clearTimeout }, onOutput = null, onExit = null, onError = null } = {}) {
    if (typeof fork !== "function") throw hostError("fork must be a function", "invalid_args");
    this.workerPath = workerPath; this.fork = fork; this.timeout = timeout > 0 ? timeout : DEFAULT_TIMEOUT; this.initTimeout = initTimeout > 0 ? initTimeout : DEFAULT_INIT_TIMEOUT; this.timers = timers; this.onOutput = onOutput; this.onExit = onExit; this.onError = onError;
    this.child = null; this.generation = 0; this.sequence = 0; this.pending = new Map(); this.state = "dead"; this.nextId = 0; this.stopping = false;
  }
  _reject(error, generation = null) { for (const [id, item] of this.pending) { if (generation !== null && item.generation !== generation) continue; this.pending.delete(id); this.timers.clearTimeout(item.timer); item.reject(error); } }
  _death(child, generation, cause) { if (child !== this.child || generation !== this.generation) return; const e = cause instanceof Error ? cause : hostError("PTY worker unavailable", "worker_unavailable"); this._reject(e, generation); this.child = null; this.state = "dead"; if (!this.stopping) this.onError?.(e); }
  _attach(child, generation) {
    const receive = (message) => { const value = typeof message?.type === "string" ? message : message?.data; if (value?.type === "pty:data") { if (generation === this.generation && child === this.child && isPtyOutputEvent(value) && value.generation === generation) this.onOutput?.(value); return; } if (value?.type === "pty:exit") { if (generation === this.generation && child === this.child && isPtyExitEvent(value) && value.generation === generation) this.onExit?.(value); return; } if (!isPtyResponse(value) || child !== this.child || generation !== this.generation) return; const item = this.pending.get(value.id); if (!item || item.generation !== generation) return; this.pending.delete(value.id); this.timers.clearTimeout(item.timer); if (value.generation !== generation) item.reject(hostError("stale PTY response", "stale_generation")); else if (value.error !== undefined) item.reject(hostError(value.error, value.code)); else item.resolve(value.data ?? null); };
    child.on?.("message", receive); child.on?.("error", (e) => this._death(child, generation, e)); child.on?.("exit", (code) => { if (code !== 0) this._death(child, generation, hostError(`PTY worker exited (${code ?? "unknown"})`, "worker_unavailable")); });
  }
  _request(method, args, generation, timeout, states = ["ready"]) { if (!METHODS.has(method)) return Promise.reject(hostError("Unsupported PTY method", "unsupported_method")); if (!this.child || generation !== this.generation || !states.includes(this.state)) return Promise.reject(hostError("PTY worker is not ready", "not_ready")); const id = `pty-${++this.nextId}`; return new Promise((resolve, reject) => { const timer = this.timers.setTimeout(() => { if (!this.pending.delete(id)) return; reject(hostError(`PTY RPC timeout: ${method}`, "worker_timeout")); }, timeout); this.pending.set(id, { resolve, reject, timer, generation }); try { send(this.child, createPtyRequest(id, generation, method, args)); } catch (e) { this.pending.delete(id); this.timers.clearTimeout(timer); reject(e); } }); }
  async start(options = {}) { await this.kill(); const generation = ++this.generation; const child = this.fork(this.workerPath); this.child = child; this.state = "starting"; this._attach(child, generation); try { const result = await this._request("init", options, generation, this.initTimeout, ["starting"]); if (child !== this.child) throw hostError("stale PTY initialization", "stale_generation"); this.state = "ready"; return result; } catch (e) { terminate(child); this._reject(e, generation); if (this.child === child) this.child = null; this.state = "dead"; throw e; } }
  call(method, args = {}) { return this._request(method, args, this.generation, this.timeout); }
  async dispose() { const child = this.child; if (!child) return; const generation = this.generation; this.stopping = true; this.state = "stopping"; try { await this._request("dispose", {}, generation, this.timeout, ["stopping"]); } catch { /* hard kill below */ } this._reject(hostError("PTY worker disposed", "worker_disposed"), generation); terminate(child); if (this.child === child) this.child = null; this.state = "dead"; this.stopping = false; }
  async kill() { const child = this.child; if (!child) return; this.stopping = true; this._reject(hostError("PTY worker killed", "worker_killed")); terminate(child); if (this.child === child) this.child = null; this.generation += 1; this.state = "dead"; this.stopping = false; }
}
export const createPtyHost = (options) => new PtyHost(options);
export default PtyHost;
