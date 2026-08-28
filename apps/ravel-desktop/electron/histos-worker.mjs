/**
 * Histos engine worker. It supports Electron utilityProcess.parentPort and
 * Node child_process IPC so the host can be tested without Electron.
 */
import { createHistosEngine } from "./histos-engine.js";
import { createHistosErrorResponse, createHistosResponse, isHistosRequest } from "./histos-protocol.js";

let engine = null;
let generation = -1;
let disposed = false;

function post(message) {
  if (process.parentPort) {
    process.parentPort.postMessage(message);
  } else if (typeof process.send === "function") {
    process.send(message);
  }
}

function receive(handler) {
  if (process.parentPort) {
    process.parentPort.on("message", (event) => handler(event?.data ?? event));
  } else {
    process.on("message", handler);
  }
}

async function init(options, requestGeneration) {
  if (engine) engine.close();
  engine = createHistosEngine(options ?? {});
  generation = requestGeneration;
  disposed = false;
  return { workspaceId: engine.workspaceId };
}

function requireEngine() {
  if (!engine || disposed) throw Object.assign(new Error("Histos worker is not initialized"), { code: "not_ready" });
  return engine;
}

async function invoke(method, args) {
  if (method === "init") return init(args, generation);
  if (method === "dispose") {
    disposed = true;
    const current = engine;
    engine = null;
    current?.close();
    return null;
  }
  const current = requireEngine();
  if (method === "getGraph") return current.getGraph(args?.query ?? args);
  if (method === "getNode") return current.getNode(args);
  if (method === "getArtifact") return current.getArtifact(args);
  if (method === "rebuild") return current.rebuild(args ?? {});
  if (method === "freezeContext") return current.freezeContext(args ?? {});
  if (method === "convertToFlow") return current.convertToFlow(args ?? {});
  if (method === "applySessionFacts") return current.applySessionFacts(args ?? {});
  throw Object.assign(new Error("unsupported Histos method"), { code: "unsupported_method" });
}

receive(async (message) => {
  if (!isHistosRequest(message)) {
    if (message?.type === "req" && typeof message.id === "string") {
      post(createHistosErrorResponse(message.id, Number.isSafeInteger(message.generation) ? message.generation : generation, "invalid Histos request", "invalid_request"));
    }
    return;
  }
  if (message.method !== "init" && message.generation !== generation) {
    post(createHistosErrorResponse(message.id, message.generation, "stale Histos generation", "stale_generation"));
    return;
  }
  try {
    const data = message.method === "init"
      ? await init(message.args ?? {}, message.generation)
      : await invoke(message.method, message.args ?? {});
    post(createHistosResponse(message.id, message.generation, data));
    if (message.method === "dispose") setImmediate(() => process.exit(0));
  } catch (error) {
    post(createHistosErrorResponse(message.id, message.generation, error instanceof Error ? error.message : String(error), error?.code));
  }
});

process.on("uncaughtException", (error) => {
  console.error("histos worker crashed", error);
  try { post({ type: "error", error: "Histos worker failed" }); } catch { /* best effort */ }
  process.exit(1);
});
