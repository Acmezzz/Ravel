/** Isolated node-pty worker. The node-pty dependency is intentionally confined here. */
import { createRequire } from "node:module";
import { processLog } from "./process-log.js";
import {
  MAX_PTY_SESSIONS,
  createPtyErrorResponse,
  createPtyResponse,
  isPtyRequest,
  chunkPtyOutput,
  sanitizePtyOutputDTO,
} from "./pty-protocol.js";

const require = createRequire(import.meta.url);
let nodePty;
try { nodePty = require("node-pty"); } catch { nodePty = null; }

const KILL_WAIT_MS = 2_000;

let sendMessage = (message) => {
  if (process.parentPort) process.parentPort.postMessage(message);
  else if (typeof process.send === "function") process.send(message);
};

function error(message, code = "pty_error") {
  return Object.assign(new Error(message), { code });
}

export function createPtyWorkerHandler({ pty = nodePty, send = sendMessage, killWaitMs = KILL_WAIT_MS } = {}) {
  const active = new Map();
  let generation = -1;
  const post = (message) => send(message);
  const close = (sessionId) => {
    const session = active.get(sessionId);
    if (!session) return Promise.resolve();
    if (session.closing) return session.closing;
    session.closing = new Promise((resolveClose) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active.delete(sessionId);
        resolveClose();
      };
      const timer = setTimeout(done, killWaitMs);
      // Intentionally not unref'd: a pending kill/dispose RPC must be
      // answered even without other loop handles. The dispose path exits via
      // process.exit(0) after replying, so a ref'd timer cannot hang shutdown.
      try { session.terminal.onExit(() => done()); } catch { /* already exited */ }
      try { session.terminal.kill(); } catch { done(); }
    });
    return session.closing;
  };
  const closeAll = async () => {
    await Promise.all([...active.keys()].map((id) => close(id)));
  };
  const handle = async (message) => {
    if (!isPtyRequest(message)) return null;
    if (message.method !== "init" && message.generation !== generation) {
      post(createPtyErrorResponse(message.id, message.generation, "stale PTY generation", "stale_generation"));
      return null;
    }
    try {
      let data = null;
      if (message.method === "init") {
        await closeAll();
        generation = message.generation;
      } else if (message.method === "spawn") {
        if (active.size >= MAX_PTY_SESSIONS) throw error("PTY session limit exceeded", "session_limit");
        const args = message.args;
        if (active.has(args.sessionId)) throw error("PTY session already exists", "session_exists");
        if (!pty?.spawn) throw error("node-pty is unavailable", "pty_unavailable");
        const terminal = pty.spawn(args.file, args.args, {
          name: args.name ?? "xterm-256color", cols: args.cols ?? 80, rows: args.rows ?? 24,
          cwd: args.cwd, env: args.env,
        });
        const session = { terminal, generation, sequence: 0, closing: null };
        active.set(args.sessionId, session);
        terminal.onData((output) => {
          if (active.get(args.sessionId) !== session || session.generation !== generation) return;
          for (const chunk of chunkPtyOutput(output)) {
            post({ type: "pty:data", ...sanitizePtyOutputDTO(args.sessionId, chunk, session.sequence++), generation });
          }
        });
        terminal.onExit(({ exitCode, signal }) => {
          if (session.generation !== generation) return;
          if (active.get(args.sessionId) === session) active.delete(args.sessionId);
          post({ type: "pty:exit", sessionId: args.sessionId, exitCode: Number.isInteger(exitCode) ? exitCode : null, signal: typeof signal === "number" ? signal : null, generation });
        });
        data = { sessionId: args.sessionId, pid: terminal.pid };
      } else if (message.method === "write") {
        const session = active.get(message.args.sessionId);
        if (!session) throw error("PTY session not found", "session_not_found");
        session.terminal.write(message.args.data);
      } else if (message.method === "resize") {
        const session = active.get(message.args.sessionId);
        if (!session) throw error("PTY session not found", "session_not_found");
        session.terminal.resize(message.args.cols, message.args.rows);
      } else if (message.method === "kill") {
        await close(message.args.sessionId);
      } else if (message.method === "dispose") {
        await closeAll();
        generation = -1;
      }
      post(createPtyResponse(message.id, message.generation, data));
      return data;
    } catch (cause) {
      post(createPtyErrorResponse(message.id, message.generation, cause?.message ?? String(cause), cause?.code));
      return null;
    }
  };
  return Object.freeze({ handle, getGeneration: () => generation, getSessionCount: () => active.size });
}

process.on("uncaughtException", (error) => {
  processLog("pty-worker", "uncaught_exception", error);
  process.exit(1);
});

const handler = createPtyWorkerHandler();
async function onWorkerMessage(message) {
  await handler.handle(message);
  if (isPtyRequest(message) && message.method === "dispose") setImmediate(() => process.exit(0));
}
if (process.parentPort) process.parentPort.on("message", (event) => void onWorkerMessage(event?.data ?? event));
else if (typeof process.on === "function") process.on("message", (message) => void onWorkerMessage(message));
