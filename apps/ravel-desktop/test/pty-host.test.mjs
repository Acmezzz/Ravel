import test from "node:test";
import assert from "node:assert/strict";
import { PtyHost } from "../electron/pty-host.js";

class FakeChild {
  constructor() { this.listeners = new Map(); this.messages = []; this.killed = false; }
  on(event, listener) { this.listeners.set(event, listener); }
  postMessage(message) { this.messages.push(message); }
  emit(event, ...args) { this.listeners.get(event)?.(...args); }
  reply(data) { this.emit("message", data); }
  kill() { this.killed = true; this.emit("exit", 0); }
}

function harness() {
  const children = [];
  const outputs = [];
  const exits = [];
  const host = new PtyHost({
    fork: () => { const child = new FakeChild(); children.push(child); return child; },
    timeout: 100,
    initTimeout: 100,
    onOutput: (value) => outputs.push(value),
    onExit: (value) => exits.push(value),
  });
  return { host, children, outputs, exits };
}

async function initHarness() {
  const value = harness();
  const starting = value.host.start({ terminal: "test" });
  await new Promise((resolve) => setImmediate(resolve));
  const child = value.children[0];
  const request = child.messages[0];
  child.reply({ type: "pty:resp", id: request.id, generation: request.generation, data: { ok: true } });
  await starting;
  return value;
}

test("PTY host correlates requests and forwards only current-generation output and exit", async () => {
  const { host, children, outputs, exits } = await initHarness();
  const child = children[0];
  const call = host.call("write", { sessionId: "s1", data: "hello" });
  const request = child.messages.at(-1);
  child.reply({ type: "pty:resp", id: request.id, generation: request.generation, data: null });
  await call;
  child.emit("message", { type: "pty:data", sessionId: "s1", chunk: "ok", sequence: 0, isFinal: false, generation: host.generation });
  child.emit("message", { type: "pty:exit", sessionId: "s1", exitCode: 0, signal: null, generation: host.generation });
  assert.equal(outputs.length, 1);
  assert.equal(exits.length, 1);
  child.emit("message", { type: "pty:data", sessionId: "s1", chunk: "stale", sequence: 1, isFinal: false });
  child.emit("message", { type: "pty:data", sessionId: "s1", chunk: "stale-generation", sequence: 2, isFinal: false, generation: host.generation - 1 });
  assert.equal(outputs.length, 1);
  await host.kill();
});

test("PTY host rejects timed out requests and deterministically disposes", async () => {
  const { host, children } = await initHarness();
  await assert.rejects(host.call("resize", { sessionId: "s1", cols: 80, rows: 24 }), { code: "worker_timeout" });
  const child = children[0];
  await host.dispose();
  assert.equal(child.killed, true);
  assert.equal(host.state, "dead");
});

test("PTY host dispose waits for the child exit event before returning", async () => {
  const { host, children } = await initHarness();
  const child = children[0];
  let resolveExit;
  child.kill = function kill() {
    this.killed = true;
    resolveExit = () => this.emit("exit", 0);
  };
  let disposed = false;
  const disposing = host.dispose().then(() => { disposed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  const request = child.messages.at(-1);
  child.reply({ type: "pty:resp", id: request.id, generation: request.generation, data: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.killed, true);
  assert.equal(disposed, false);
  assert.equal(host.state, "stopping");
  resolveExit();
  await disposing;
  assert.equal(disposed, true);
  assert.equal(host.state, "dead");
});

test("PTY host treats a clean unexpected exit as death and reports a diagnostic", async () => {
  const value = harness();
  const errors = [];
  value.host.onError = (diagnostic) => errors.push(diagnostic);
  const starting = value.host.start({});
  await new Promise((resolve) => setImmediate(resolve));
  const child = value.children[0];
  child.reply({ type: "pty:resp", id: child.messages[0].id, generation: child.messages[0].generation, data: null });
  await starting;
  const call = value.host.call("write", { sessionId: "s1", data: "hello" });
  child.emit("exit", 0, null);
  await assert.rejects(call, { code: "worker_unavailable" });
  assert.equal(value.host.state, "dead");
  assert.equal(errors[0]?.type, "exit");
});

test("PTY host kills itself when sending to a dead child fails", async () => {
  const value = await initHarness();
  const child = value.children[0];
  child.postMessage = () => { throw new Error("closed"); };
  await assert.rejects(value.host.call("write", { sessionId: "s1", data: "hello" }), { code: "worker_unavailable" });
  assert.equal(value.host.state, "dead");
  assert.equal(child.killed, true);
});

test("PTY host rejects stale child responses after replacement", async () => {
  const value = harness();
  const firstStart = value.host.start({});
  await new Promise((resolve) => setImmediate(resolve));
  const first = value.children[0];
  first.reply({ type: "pty:resp", id: first.messages[0].id, generation: first.messages[0].generation, data: null });
  await firstStart;
  await value.host.kill();
  const secondStart = value.host.start({});
  await new Promise((resolve) => setImmediate(resolve));
  const second = value.children[1];
  first.emit("message", { type: "pty:resp", id: "pty-2", generation: 1, data: "wrong" });
  second.reply({ type: "pty:resp", id: second.messages[0].id, generation: second.messages[0].generation, data: null });
  await secondStart;
  assert.equal(value.host.state, "ready");
  await value.host.kill();
});
