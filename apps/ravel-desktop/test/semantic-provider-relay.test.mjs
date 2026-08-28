import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHistosProviderResult,
  createHistosRequest,
  isHistosProviderRequest,
  isHistosProviderResult,
} from "../electron/histos-protocol.js";
import { HistosHost } from "../electron/histos-host.js";

const WORKER_PATH = fileURLToPath(new URL("../electron/histos-worker.mjs", import.meta.url));

class FakeChild {
  constructor() { this.listeners = new Map(); this.messages = []; this.killed = false; }
  on(event, listener) { this.listeners.set(event, listener); }
  postMessage(message) { this.messages.push(message); }
  emit(event, ...args) { this.listeners.get(event)?.(...args); }
  reply(data) { this.emit("message", data); }
  kill() { this.killed = true; }
}

async function startHost(child, options = {}) {
  const host = new HistosHost({ fork: () => child, initTimeout: 2_000, timeout: 2_000, ...options });
  const starting = host.start({ workspaceId: "ws", providerRelay: true });
  await new Promise((resolve) => setImmediate(resolve));
  const initRequest = child.messages.find((message) => message.type === "req" && message.method === "init");
  child.reply({ type: "resp", id: initRequest.id, generation: initRequest.generation, data: { workspaceId: "ws" } });
  await starting;
  return host;
}

function providerResultsOf(child) {
  return child.messages.filter((message) => isHistosProviderResult(message));
}

test("provider relay protocol validators accept well-formed envelopes and reject malformed ones", () => {
  const request = { type: "histos-provider", reqId: "prov-1", request: { prompt: "summarize", maxTokens: 1024 } };
  assert.equal(isHistosProviderRequest(request), true);
  assert.equal(isHistosProviderRequest({ type: "histos-provider", reqId: "prov-1" }), false);
  assert.equal(isHistosProviderRequest({ type: "histos-provider", reqId: "prov-1", request: { prompt: "" } }), false);
  assert.equal(isHistosProviderRequest({ type: "histos-provider", reqId: "prov-1", request: { prompt: "ok", maxTokens: 0 } }), false);

  const dataResult = createHistosProviderResult("prov-1", { text: "标题" });
  assert.equal(isHistosProviderResult(dataResult), true);
  assert.equal(dataResult.data.text, "标题");
  const errorResult = createHistosProviderResult("prov-1", null, "no model", "no_model");
  assert.equal(isHistosProviderResult(errorResult), true);
  assert.equal(errorResult.code, "no_model");
  assert.equal(isHistosProviderResult({ type: "histos-provider-result", reqId: "prov-1" }), false);
  assert.equal(isHistosProviderResult({ type: "histos-provider-result", reqId: "prov-1", data: { text: "" } }), false);
});

test("HistosHost relays provider requests to its handler and posts the result back", async () => {
  const child = new FakeChild();
  const seen = [];
  const host = await startHost(child, { onProviderRequest: async (request) => { seen.push(request); return { text: `summary:${request.prompt}` }; } });
  const getGraph = host.call("getGraph", { sourceSet: {}, lens: "structural", granularity: "entry" });
  const pendingGetGraph = child.messages.find((message) => message.type === "req" && message.method === "getGraph");

  child.reply({ type: "histos-provider", reqId: "prov-1", request: { prompt: "node", maxTokens: 1024 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [{ prompt: "node", maxTokens: 1024 }]);
  const results = providerResultsOf(child);
  assert.equal(results.length, 1);
  assert.equal(results[0].reqId, "prov-1");
  assert.equal(results[0].data.text, "summary:node");
  assert.equal(results[0].error, undefined);

  child.reply({ type: "resp", id: pendingGetGraph.id, generation: pendingGetGraph.generation, data: { nodes: [] } });
  await getGraph;
  await host.kill();
});

test("HistosHost fails provider requests closed without a handler", async () => {
  const child = new FakeChild();
  const host = await startHost(child);
  child.reply({ type: "histos-provider", reqId: "prov-2", request: { prompt: "node" } });
  await new Promise((resolve) => setImmediate(resolve));
  const results = providerResultsOf(child);
  assert.equal(results[0].reqId, "prov-2");
  assert.equal(results[0].code, "semantic_provider_unavailable");
  await host.kill();
});

test("HistosHost converts a throwing handler into a provider error result", async () => {
  const child = new FakeChild();
  const host = await startHost(child, { onProviderRequest: async () => { throw Object.assign(new Error("worker died"), { code: "worker_unavailable" }); } });
  child.reply({ type: "histos-provider", reqId: "prov-3", request: { prompt: "node" } });
  await new Promise((resolve) => setImmediate(resolve));
  const results = providerResultsOf(child);
  assert.equal(results[0].code, "worker_unavailable");
  assert.match(results[0].error, /worker died/);
  await host.kill();
});

/**
 * Real-worker harness over node IPC: the test plays the HistosHost role,
 * answering init/req envelopes and any provider round trip the worker posts.
 */
function startWorkerEngine(options) {
  const child = fork(WORKER_PATH, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const pending = new Map();
  const providerRequests = [];
  let providerResponder = null;
  let seq = 0;
  const generation = 1;
  child.on("message", (message) => {
    if (isHistosProviderRequest(message)) {
      providerRequests.push(message);
      providerResponder?.(message);
      return;
    }
    if (message?.type === "resp" && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error !== undefined) {
        const error = new Error(message.error);
        error.code = message.code;
        reject(error);
      } else {
        resolve(message.data);
      }
    }
  });
  const call = (method, args) => new Promise((resolve, reject) => {
    const request = createHistosRequest(`req-${++seq}`, generation, method, args);
    pending.set(request.id, { resolve, reject });
    child.send(request);
  });
  const worker = {
    child,
    call,
    providerRequests,
    setProviderResponder: (responder) => { providerResponder = responder; },
    dispose: () => call("dispose", {}).finally(() => child.disconnect()),
  };
  return call("init", options).then(() => worker);
}

test("histos-worker bridges semantic condensation through the provider relay end to end", async (t) => {
  const root = await fs.mkdtemp(join(os.tmpdir(), "ravel-histos-relay-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const sessionFile = join(root, "session.jsonl");
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session", version: 3, id: "session-relay", cwd: root }),
    JSON.stringify({ type: "message", id: "entry-1", parentId: null, message: { role: "user", content: "selected evidence" } }),
    JSON.stringify({ type: "message", id: "entry-2", parentId: "entry-1", message: { role: "assistant", content: "neighbor summary" } }),
    "",
  ].join("\n"), "utf8");

  const worker = await startWorkerEngine({
    workspaceId: "workspace-relay",
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
    providerRelay: true,
  });
  try {
    await worker.call("applySessionFacts", { file: sessionFile });
    worker.setProviderResponder((message) => {
      assert.match(message.request.prompt, /NODE:/);
      assert.match(message.request.prompt, /EVIDENCE:/);
      worker.child.send(createHistosProviderResult(message.reqId, { text: "汇聚节点标题" }));
    });
    const condensed = await worker.call("condenseGraph", { sourceSet: {}, lens: "semantic", granularity: "entry" });
    assert.equal(condensed.ok, true);
    assert.match(condensed.sha256, /^[0-9a-f]{64}$/);
    assert.ok(condensed.artifact.nodes.length > 0);
    assert.equal(condensed.artifact.nodes[0].title, "汇聚节点标题");
    assert.ok(worker.providerRequests.length > 0);

    worker.setProviderResponder((message) => {
      worker.child.send(createHistosProviderResult(message.reqId, null, "No model is selected for this workspace", "no_model"));
    });
    await assert.rejects(
      () => worker.call("condenseGraph", { sourceSet: {}, lens: "semantic", granularity: "entry", parentSha: condensed.sha256 }),
      (error) => error.code === "semantic_provider_unavailable",
    );
  } finally {
    await worker.dispose().catch(() => {});
  }
});
