/**
 * Histos event bus (adapted from prime-agent ExtensionEvent union).
 *
 * Names follow the `BeforeX` / `AfterX` / `OnX` convention used by the
 * upstream pi extension event union. The bus itself is a thin pub/sub
 * layer so any subsystem (worker, HistosEngine, Histos surface) can
 * publish or subscribe without depending on Electron's IPC plumbing.
 *
 * Subscribers are called synchronously inside the publishing call; an
 * exception in a subscriber is caught and routed to `onSubscriberError`
 * so one bad hook can never break the writer. This is by design — the
 * Histos event bus is a derived view, not a critical control channel.
 */

export const HISTOS_EVENT_TYPES = Object.freeze([
  "before_fact_triple_write",
  "after_fact_triple_write",
  "before_graph_query",
  "after_graph_query",
  "before_condense",
  "after_condense",
  "before_flow_execute",
  "after_flow_execute",
  "before_context_freeze",
  "after_context_freeze",
  "before_web_import",
  "after_web_import",
  "on_session_facts_applied",
  "on_operation_finished",
  "on_approval_decided",
  "on_context_attached",
  "on_flow_triggered",
  "on_entries_archived",
  "on_entries_restored",
  "on_entries_purged",
  "on_strategy_approved",
]);

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_SUBSCRIBERS_PER_EVENT = 64;

function noop() {}

export function createHistosEventBus({ onSubscriberError = noop } = {}) {
  if (typeof onSubscriberError !== "function") {
    throw Object.assign(new TypeError("onSubscriberError must be a function"), { code: "invalid_args" });
  }
  /** @type {Map<string, Set<Function>>} */
  const subscribers = new Map();

  function add(eventType, fn) {
    if (!HISTOS_EVENT_TYPES.includes(eventType)) {
      throw Object.assign(new Error(`Unknown Histos event type: ${eventType}`), { code: "invalid_args" });
    }
    if (typeof fn !== "function") {
      throw Object.assign(new TypeError("subscriber must be a function"), { code: "invalid_args" });
    }
    let bucket = subscribers.get(eventType);
    if (!bucket) {
      bucket = new Set();
      subscribers.set(eventType, bucket);
    }
    if (bucket.size >= MAX_SUBSCRIBERS_PER_EVENT) {
      throw Object.assign(new Error(`Too many subscribers on ${eventType}`), { code: "subscriber_limit" });
    }
    bucket.add(fn);
    return () => bucket.delete(fn);
  }

  function emit(eventType, payload) {
    if (!HISTOS_EVENT_TYPES.includes(eventType)) return false;
    const bucket = subscribers.get(eventType);
    if (!bucket || bucket.size === 0) return false;
    for (const fn of [...bucket]) {
      try {
        const result = fn(payload);
        if (result && typeof result.then === "function") {
          // Fire-and-forget promise; the bus is sync, async hooks are
          // documented as best-effort.
          result.catch((error) => onSubscriberError({ eventType, error }));
        }
      } catch (error) {
        onSubscriberError({ eventType, error });
      }
    }
    return true;
  }

  function listenerCount(eventType) {
    const bucket = subscribers.get(eventType);
    return bucket ? bucket.size : 0;
  }

  function clear() {
    subscribers.clear();
  }

  return Object.freeze({
    eventTypes: HISTOS_EVENT_TYPES,
    add,
    emit,
    listenerCount,
    clear,
  });
}

/**
 * Validate a payload shape. The bus is permissive — payloads are opaque to
 * the core and only the publish/subscribe pair needs to agree on a shape.
 * This helper just bounds string lengths so a misbehaving publisher can't
 * blow up a downstream subscriber.
 */
export function boundEventPayload(payload) {
  if (payload === null || typeof payload !== "object") return {};
  const json = JSON.stringify(payload);
  if (typeof json === "string" && json.length > MAX_PAYLOAD_BYTES) {
    return { _truncated: true, _originalBytes: json.length };
  }
  return payload;
}
