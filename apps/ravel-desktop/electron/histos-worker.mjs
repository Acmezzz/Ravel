/**
 * Histos engine worker. It supports Electron utilityProcess.parentPort and
 * Node child_process IPC so the host can be tested without Electron.
 */
import { createHistosEngine } from "./histos-engine.js";
import { processLog } from "./process-log.js";
import {
  createHistosErrorResponse,
  createHistosResponse,
  isHistosProviderResult,
  isHistosRequest,
} from "./histos-protocol.js";
import { createHistosEventBus, boundEventPayload } from "./histos-event-bus.js";

let engine = null;
let generation = -1;
let disposed = false;
let providerSeq = 0;
const pendingProviderRequests = new Map();
const PROVIDER_CALL_TIMEOUT_MS = 240_000;
const PROVIDER_MAX_TOKENS = 1024;
/** Missing-model failures collapse to the canonical offline code; the cause stays visible. */
const PROVIDER_UNAVAILABLE_CODES = new Set(["no_model", "no_api_key", "oauth_unavailable", "auth_required"]);

/**
 * Compile one engine condensation call (node + evidence) into the standalone
 * LLM prompt. The engine caps node+evidence JSON well below the protocol's
 * prompt bound, so no further trimming is needed here.
 */
function buildCondensePrompt(request) {
  return [
    "Summarize the following knowledge-graph node as one concise title (max 120 characters).",
    "Reply with the title text only, no quotes, no explanation.",
    `NODE: ${JSON.stringify(request.node ?? null)}`,
    `EVIDENCE: ${JSON.stringify(request.evidence ?? [])}`,
  ].join("\n");
}

function post(message) {
  if (process.parentPort) {
    process.parentPort.postMessage(message);
  } else if (typeof process.send === "function") {
    process.send(message);
  }
}

const bus = createHistosEventBus({
  onSubscriberError({ eventType, error }) {
    processLog("histos-worker", "bus_subscriber_error", error, { eventType });
  },
});

function emitToHost(eventType, payload) {
  post({ type: "histos-event", eventType, payload: boundEventPayload(payload ?? {}) });
}

for (const eventType of bus.eventTypes) {
  bus.add(eventType, (payload) => emitToHost(eventType, payload));
}

function receive(handler) {
  if (process.parentPort) {
    process.parentPort.on("message", (event) => handler(event?.data ?? event));
  } else {
    process.on("message", handler);
  }
}

/**
 * Build the engine's semanticProvider over the host relay. Each condensation
 * node becomes one provider round trip; failures are honest errors so the
 * engine never writes nodes without real summaries.
 */
function createRelayedSemanticProvider() {
  return (request) => {
    const reqId = `prov-${++providerSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingProviderRequests.delete(reqId);
        reject(Object.assign(new Error("Semantic provider request timed out"), { code: "provider_timeout" }));
      }, PROVIDER_CALL_TIMEOUT_MS);
      timer.unref?.();
      pendingProviderRequests.set(reqId, {
        resolve: (value) => {
          clearTimeout(timer);
          pendingProviderRequests.delete(reqId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          pendingProviderRequests.delete(reqId);
          reject(error);
        },
      });
      post({
        type: "histos-provider",
        reqId,
        // The engine may pass a ready-made prompt (resource distillation) or
        // raw condensation input that we compile here.
        request: {
          prompt: typeof request.prompt === "string" ? request.prompt : buildCondensePrompt(request),
          maxTokens: Number.isSafeInteger(request.maxTokens) ? request.maxTokens : PROVIDER_MAX_TOKENS,
        },
      });
    });
  };
}

function settleProviderResult(message) {
  const pending = pendingProviderRequests.get(message.reqId);
  if (!pending) return;
  if (message.error !== undefined) {
    const error = new Error(message.error);
    if (PROVIDER_UNAVAILABLE_CODES.has(message.code)) {
      error.code = "semantic_provider_unavailable";
      error.message = `Semantic condensation unavailable: ${message.error}`;
    } else if (message.code) {
      error.code = message.code;
    }
    pending.reject(error);
    return;
  }
  pending.resolve(message.data?.text);
}

async function init(options, requestGeneration) {
  if (engine) engine.close();
  const engineOptions = { ...(options ?? {}) };
  if (engineOptions.providerRelay === true) {
    engineOptions.semanticProvider = createRelayedSemanticProvider();
  }
  engine = createHistosEngine({ ...engineOptions, eventBus: bus });
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
  if (method === "condenseGraph") return current.condenseGraph(args ?? {});
  if (method === "saveViewState") return current.saveViewState(args ?? {});
  if (method === "getViewState") return current.getViewState(args ?? {});
  if (method === "executeFlow") return current.executeFlow(args ?? {});
  if (method === "getNode") return current.getNode(args);
  if (method === "getArtifact") return current.getArtifact(args);
  if (method === "rebuild") return current.rebuild(args ?? {});
  if (method === "freezeContext") return current.freezeContext(args ?? {});
  if (method === "convertToFlow") return current.convertToFlow(args ?? {});
  if (method === "applySessionFacts") return current.applySessionFacts(args ?? {});
  if (method === "applyWebResources") return current.applyWebResources(args ?? {});
  if (method === "applyAgentActivity") return current.applyAgentActivity(args ?? {});
  if (method === "applyEvalResults") return current.applyEvalResults(args ?? {});
    if (method === "listCapabilities") return current.listCapabilities(args ?? {});
    if (method === "invokeNode") return current.invokeNode(args ?? {});
    if (method === "distillResource") return current.distillResource(args ?? {});
    if (method === "suggestContext") return current.suggestContext(args ?? {});
    if (method === "importContext") return current.importContext(args ?? {});
    if (method === "queryFacts") return current.queryFacts(args?.query ?? args ?? {});
    if (method === "writeFacts") return current.writeFacts(args?.triples ?? []);
    if (method === "factStats") return current.factStats();
    if (method === "clearFacts") return current.clearFacts();
    if (method === "archiveEntries") return current.archiveEntries(args?.kind, args?.ids ?? [], args?.reason ?? null);
    if (method === "restoreEntries") return current.restoreEntries(args?.tombstoneIds ?? []);
    if (method === "listTombstones") return current.listTombstones(args ?? {});
    if (method === "purgeEntries") return current.purgeEntries(args?.kind, args?.ids ?? [], args?.reason ?? null);
    if (method === "applyMcpConfigs") return current.applyMcpConfigs(args ?? {});
    if (method === "applyRepoIndex") return current.applyRepoIndex(args ?? {});
    if (method === "applyDiagnostics") return current.applyDiagnostics(args ?? {});
    if (method === "ftsSearch") return current.ftsSearch(args ?? {});
    if (method === "applyCapabilityFlows") return current.applyCapabilityFlows(args ?? {});
    if (method === "applyProjectKnowledge") return current.applyProjectKnowledge(args ?? {});
    if (method === "createHandoff") return current.createHandoff(args ?? {});
    if (method === "listArtifacts") return current.listArtifacts();
    if (method === "createStrategyDraft") return current.createStrategyDraft(args ?? {});
    if (method === "approveStrategyDraft") return current.approveStrategyDraft(args ?? {});
    throw Object.assign(new Error("unsupported Histos method"), { code: "unsupported_method" });
}

receive(async (message) => {
  if (isHistosProviderResult(message)) {
    settleProviderResult(message);
    return;
  }
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
  processLog("histos-worker", "uncaught_exception", error);
  try { post({ type: "error", error: "Histos worker failed" }); } catch { /* best effort */ }
  process.exit(1);
});
