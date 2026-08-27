import test from "node:test";
import assert from "node:assert/strict";
import { createPtyWorkerHandler } from "../electron/pty-worker.mjs";
import { createPtyRequest } from "../electron/pty-protocol.js";

function fakeTerminal({ autoExitOnKill = true } = {}) {
  const dataListeners = [];
  const exitListeners = [];
  return {
    pid: 4242,
    writes: [],
    resizes: [],
    killed: false,
    onData(listener) { dataListeners.push(listener); },
    onExit(listener) { exitListeners.push(listener); },
    write(data) { this.writes.push(data); },
    resize(cols, rows) { this.resizes.push({ cols, rows }); },
    kill() {
      this.killed = true;
      if (autoExitOnKill) this.emitExit(0);
    },
    emitData(chunk) { for (const listener of dataListeners) listener(chunk); },
    emitExit(exitCode = 0) {
      for (const listener of [...exitListeners]) listener({ exitCode, signal: null });
    },
  };
}

test("PTY worker waits for native onExit before answering kill and dispose", async () => {
  const messages = [];
  let terminal;
  const handler = createPtyWorkerHandler({
    send: (message) => messages.push(message),
    pty: {
      spawn: () => {
        terminal = fakeTerminal({ autoExitOnKill: false });
        return terminal;
      },
    },
    killWaitMs: 5_000,
  });
  await handler.handle(createPtyRequest("1", 1, "init", {}));
  await handler.handle(createPtyRequest("2", 1, "spawn", {
    sessionId: "s1", file: "shell", args: [], cols: 80, rows: 24,
  }));
  assert.equal(handler.getSessionCount(), 1);

  let killSettled = false;
  const killing = handler.handle(createPtyRequest("3", 1, "kill", { sessionId: "s1" })).then((value) => {
    killSettled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminal.killed, true);
  assert.equal(killSettled, false);
  assert.equal(messages.some((item) => item.id === "3"), false);

  terminal.emitExit(0);
  await killing;
  assert.equal(killSettled, true);
  assert.equal(handler.getSessionCount(), 0);
  const killReply = messages.find((item) => item.id === "3");
  assert.equal(killReply?.type, "pty:resp");
  assert.equal(killReply?.error, undefined);

  let disposeSettled = false;
  const disposing = handler.handle(createPtyRequest("4", 1, "dispose", {})).then((value) => {
    disposeSettled = true;
    return value;
  });
  await disposing;
  assert.equal(disposeSettled, true);
  assert.equal(handler.getGeneration(), -1);
});

test("PTY worker still answers kill if native onExit never fires", async () => {
  const messages = [];
  const handler = createPtyWorkerHandler({
    send: (message) => messages.push(message),
    pty: {
      spawn: () => fakeTerminal({ autoExitOnKill: false }),
    },
    killWaitMs: 20,
  });
  await handler.handle(createPtyRequest("1", 1, "init", {}));
  await handler.handle(createPtyRequest("2", 1, "spawn", {
    sessionId: "s1", file: "shell", args: [], cols: 80, rows: 24,
  }));
  await handler.handle(createPtyRequest("3", 1, "kill", { sessionId: "s1" }));
  assert.equal(handler.getSessionCount(), 0);
  assert.equal(messages.find((item) => item.id === "3")?.type, "pty:resp");
});
