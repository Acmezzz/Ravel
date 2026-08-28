import test from "node:test";
import assert from "node:assert/strict";
import { createHistosFactForwarder } from "../electron/histos-fact-forwarder.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("forwarder ignores malformed batches without touching the host", () => {
  let calls = 0;
  const forwarder = createHistosFactForwarder({ ensureHost: () => { calls += 1; return Promise.resolve({ call: async () => ({}) }); } });
  forwarder(null);
  forwarder({ sessionId: "s" });
  forwarder({ sessionId: "s", facts: [] });
  assert.equal(calls, 0);
});

test("forwarder serializes batches per forwarder and passes them to the engine in order", async () => {
  const applied = [];
  const gates = [deferred(), deferred()];
  let index = 0;
  const forwarder = createHistosFactForwarder({
    ensureHost: async () => ({
      call: async (method, args) => {
        assert.equal(method, "applySessionFacts");
        applied.push(args);
        await gates[index++].promise;
        return { nodeCount: 1 };
      },
    }),
  });
  forwarder({ sessionId: "s1", facts: [{ entryId: "e1", fact: { type: "operation_finished" } }] });
  forwarder({ sessionId: "s2", facts: [{ entryId: "e2", fact: { type: "approval_asked" } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 1);
  assert.equal(applied[0].sessionId, "s1");
  gates[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 2);
  assert.equal(applied[1].sessionId, "s2");
  gates[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
});

test("forwarder reports engine failures as diagnostics and keeps accepting later batches", async () => {
  const diagnostics = [];
  let fail = true;
  const forwarder = createHistosFactForwarder({
    ensureHost: async () => ({
      call: async () => {
        if (fail) throw Object.assign(new Error("engine offline"), { code: "not_ready" });
        return { nodeCount: 1 };
      },
    }),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  forwarder({ sessionId: "s1", facts: [{ entryId: "e1", fact: { type: "operation_finished" } }] });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "not_ready");
  assert.equal(diagnostics[0].sessionId, "s1");
  assert.match(diagnostics[0].error, /engine offline/);

  fail = false;
  forwarder({ sessionId: "s1", facts: [{ entryId: "e2", fact: { type: "operation_finished" } }] });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(diagnostics.length, 1, "a healthy batch must not emit a diagnostic");
});

test("forwarder rejects construction without an ensureHost function", () => {
  assert.throws(() => createHistosFactForwarder({}), (error) => error.code === "invalid_args");
});
