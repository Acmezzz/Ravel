/**
 * Histos event bus tests (BeforeX/AfterX convention from prime-agent
 * ExtensionEvent union).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHistosEventBus, HISTOS_EVENT_TYPES, boundEventPayload } from "../electron/histos-event-bus.js";

test("event bus rejects unknown event types on add", () => {
  const bus = createHistosEventBus();
  assert.throws(() => bus.add("not_a_real_event", () => {}), /Unknown Histos event type/);
});

test("event bus fan-out: multiple subscribers receive the same payload", () => {
  const bus = createHistosEventBus();
  const received = [];
  bus.add("before_fact_triple_write", (payload) => received.push(["a", payload]));
  bus.add("before_fact_triple_write", (payload) => received.push(["b", payload]));
  bus.emit("before_fact_triple_write", { count: 7 });
  assert.equal(received.length, 2);
  assert.equal(received[0][0], "a");
  assert.equal(received[1][0], "b");
  assert.equal(received[0][1].count, 7);
});

test("subscriber exception is routed to onSubscriberError, not the writer", () => {
  const errors = [];
  const bus = createHistosEventBus({ onSubscriberError: ({ eventType, error }) => errors.push({ eventType, message: String(error) }) });
  bus.add("after_graph_query", () => { throw new Error("boom"); });
  bus.add("after_graph_query", (payload) => bus.emit("on_session_facts_applied", { ok: payload?.ok === true }));
  // The throwing subscriber must not prevent the second one from running.
  bus.emit("after_graph_query", { ok: true });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].eventType, "after_graph_query");
  assert.match(errors[0].message, /boom/);
});

test("subscribe returns an unsubscribe handle", () => {
  const bus = createHistosEventBus();
  let count = 0;
  const off = bus.add("on_session_facts_applied", () => { count += 1; });
  bus.emit("on_session_facts_applied", { factCount: 1 });
  off();
  bus.emit("on_session_facts_applied", { factCount: 2 });
  assert.equal(count, 1);
  assert.equal(bus.listenerCount("on_session_facts_applied"), 0);
});

test("bus hard-caps subscribers per event and exposes the event type list", () => {
  const bus = createHistosEventBus();
  for (let i = 0; i < 64; i += 1) bus.add("on_operation_finished", () => {});
  assert.throws(() => bus.add("on_operation_finished", () => {}), /Too many subscribers/);
  assert.ok(HISTOS_EVENT_TYPES.includes("on_session_facts_applied"));
});

test("boundEventPayload trims oversize payloads to a sentinel", () => {
  const big = { blob: "x".repeat(80_000) };
  const bounded = boundEventPayload(big);
  assert.equal(bounded._truncated, true);
  assert.equal(typeof bounded._originalBytes, "number");
});

test("P0 traceability events are part of the bus and reach the renderer relay", async () => {
  for (const eventType of ["on_entries_archived", "on_entries_restored", "on_entries_purged"]) {
    assert.ok(HISTOS_EVENT_TYPES.includes(eventType), `${eventType} must be a bus event type`);
  }
  const bus = createHistosEventBus();
  const seen = [];
  // The Histos worker subscribes to every bus event type and reposts it as a
  // "histos-event" envelope; Main relays that to renderer "histos:event".
  for (const eventType of HISTOS_EVENT_TYPES) bus.add(eventType, (payload) => seen.push([eventType, payload]));
  bus.emit("on_entries_archived", { targetKind: "node", count: 1 });
  bus.emit("on_entries_restored", { count: 1 });
  bus.emit("on_entries_purged", { targetKind: "triple", count: 1 });
  assert.deepEqual(seen.map(([eventType]) => eventType), ["on_entries_archived", "on_entries_restored", "on_entries_purged"]);
  assert.equal(seen[0][1].targetKind, "node");

  const worker = await readFile(new URL("../electron/histos-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /for \(const eventType of bus\.eventTypes\)/);
  assert.match(worker, /post\(\{ type: "histos-event", eventType, payload/);
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  assert.match(main, /win\.webContents\.send\("histos:event"/);
});

