import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerSlotPool } from "../electron/worker-pool.js";

function fakeHost(id) {
  const host = {
    sessionId: id,
    state: "dead",
    killed: 0,
    startCalls: 0,
    async start(cwd, _extensionsRoot, sessionId, _projectTrusted, permissionProfile) {
      host.startCalls += 1;
      host.state = "ready";
      host.sessionId = sessionId ?? id ?? `created-${host.startCalls}`;
      host.cwd = cwd;
      host.permissionProfile = permissionProfile ?? "trusted";
      return { sessionId: host.sessionId, cwd };
    },
    async kill() {
      host.killed += 1;
      host.state = "dead";
    },
  };
  return host;
}

test("worker slot pool reuses a live session and parks the previous foreground", async () => {
  const pool = createWorkerSlotPool({ cap: 3, idleTtlMs: 0 });
  const first = await pool.acquire({
    cwd: "/one",
    permissionProfile: "read-only",
    createHost: () => fakeHost("a"),
  });
  assert.equal(first.sessionId, "a");
  assert.equal(first.host.permissionProfile, "read-only");
  pool.markRunning("a", true);
  const second = await pool.acquire({
    sessionId: "b",
    cwd: "/two",
    createHost: () => fakeHost("b"),
  });
  assert.equal(second.sessionId, "b");
  assert.equal(pool.foreground().sessionId, "b");
  assert.equal(pool.get("a").running, true);
  assert.equal(pool.snapshots().length, 2);
  const reused = await pool.acquire({ sessionId: "a", cwd: "/one", createHost: () => fakeHost("should-not") });
  assert.equal(reused.sessionId, "a");
  assert.equal(reused.host.startCalls, 1);
  assert.equal(pool.foreground().sessionId, "a");
});

test("worker slot pool evicts idle slots and refuses when all slots are busy", async () => {
  const pool = createWorkerSlotPool({ cap: 2, idleTtlMs: 0 });
  await pool.acquire({ sessionId: "a", cwd: "/a", createHost: () => fakeHost("a") });
  pool.markRunning("a", true);
  await pool.acquire({ sessionId: "b", cwd: "/b", createHost: () => fakeHost("b") });
  pool.markRunning("a", false);
  const third = await pool.acquire({ sessionId: "c", cwd: "/c", createHost: () => fakeHost("c") });
  assert.equal(third.sessionId, "c");
  assert.equal(pool.get("a"), null);
  pool.markRunning("b", true);
  pool.markRunning("c", true);
  await assert.rejects(
    () => pool.acquire({ sessionId: "d", cwd: "/d", createHost: () => fakeHost("d") }),
    (error) => error.code === "worker_cap_exceeded",
  );
});

test("worker slot pool kills a host when startup fails", async () => {
  const host = fakeHost("pending");
  host.start = async () => {
    host.startCalls += 1;
    throw new Error("startup failed");
  };
  await assert.rejects(
    () => createWorkerSlotPool({ idleTtlMs: 0 }).acquire({ cwd: "/broken", createHost: () => host }),
    /startup failed/,
  );
  assert.equal(host.killed, 1);
});

test("worker slot pool disposes idle slots after TTL", async () => {
  const timers = [];
  const hosts = new Map();
  const pool = createWorkerSlotPool({
    cap: 2,
    idleTtlMs: 10,
    now: () => 1,
    timers: {
      setTimeout: (fn, delay) => {
        const timer = { fn, delay, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => { if (timer) timer.cleared = true; },
    },
  });
  await pool.acquire({ sessionId: "a", cwd: "/a", createHost: () => {
    const host = fakeHost("a");
    hosts.set("a", host);
    return host;
  } });
  await pool.acquire({ sessionId: "b", cwd: "/b", createHost: () => {
    const host = fakeHost("b");
    hosts.set("b", host);
    return host;
  } });
  assert.ok(pool.get("a"));
  const idleTimer = timers.find((timer) => timer.delay === 10);
  assert.ok(idleTimer, "an idle TTL timer should be scheduled");
  await idleTimer.fn();
  assert.equal(pool.get("a"), null);
  assert.equal(hosts.get("a").killed, 1);
  assert.equal(pool.foreground().sessionId, "b");
});
