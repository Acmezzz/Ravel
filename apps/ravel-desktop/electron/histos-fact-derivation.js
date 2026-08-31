/**
 * Derive FactTriples from session JSONL facts.
 *
 * The Histos fact graph is the secondary index over the durable JSONL fact
 * stream; this module is the projection that turns one session fact into
 * zero or more normalized triples. Adding a new fact type means extending
 * `FACT_TRIPLE_PROJECTIONS`; nothing else needs to know.
 *
 * Triple shape is kept in `histos-fact-graph.js` (`FACT_PREDICATES`,
 * `normalizeFactTriples`). The projector here never touches the SQLite
 * table directly — it returns plain objects and lets the backend batch
 * the inserts.
 */

const TRIPLE_PREDICATE = {
  OPERATION_OPENED: "produces",
  OPERATION_CLOSED: "produces",
  APPROVAL_REQUESTED: "approves",
  APPROVAL_DECIDED: "approves",
  SESSION_REFERENCED: "references",
  CONTEXT_ATTACHED: "attaches",
  CHECKPOINT_LABELED: "annotates",
  FLOW_TRIGGERED: "schedules",
};

// Class-level fact types that project through their own predicate families
// (config_changed, diagnostic_observed, usage_observed, goal_state).
const CUSTOM_PREDICATE_FACT_TYPES = new Set(["config_changed", "diagnostic_observed", "usage_observed", "goal_state"]);

const PREDICATE_BY_FACT = Object.freeze({
  operation_started: TRIPLE_PREDICATE.OPERATION_OPENED,
  operation_finished: TRIPLE_PREDICATE.OPERATION_CLOSED,
  approval_asked: TRIPLE_PREDICATE.APPROVAL_REQUESTED,
  approval_decided: TRIPLE_PREDICATE.APPROVAL_DECIDED,
  session_reference: TRIPLE_PREDICATE.SESSION_REFERENCED,
  context_attached: TRIPLE_PREDICATE.CONTEXT_ATTACHED,
  checkpoint: TRIPLE_PREDICATE.CHECKPOINT_LABELED,
  flow_trigger: TRIPLE_PREDICATE.FLOW_TRIGGERED,
});

// P1 config class: one predicate family per domain so the Fact Graph can
// answer "what changed in domain X" by predicate, and the whole config
// timeline by tag "config".
const CONFIG_PREDICATE_BY_DOMAIN = Object.freeze({
  resource: "custom_config_resource",
  permission: "custom_config_permission",
  trust: "custom_config_trust",
  mcp: "custom_config_mcp",
  mode: "custom_config_mode",
  provider: "custom_config_provider",
  profile: "custom_config_profile",
});

const CHECKPOINT_OUTCOMES = new Set(["completed", "aborted", "failed", "declined"]);

function bounded(value, max = 4096) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

function pushTriple(out, subject, predicate, object, source, opts = {}) {
  out.push({
    subject,
    predicate,
    object: bounded(object),
    source: bounded(source, 256),
    ...(opts.validFrom !== undefined ? { validFrom: opts.validFrom } : {}),
    ...(opts.validUntil !== undefined ? { validUntil: opts.validUntil } : {}),
    ...(opts.confidence !== undefined ? { confidence: opts.confidence } : {}),
    ...(opts.tag ? { tag: opts.tag } : {}),
  });
}

/**
 * Project one fact record into 0..N triples. Unknown fact types yield an
 * empty array rather than throwing — the fact stream is durable, the graph
 * is a derived index, and a single malformed row must not poison the
 * ingest path.
 */
export function projectFactToTriples(fact, context = {}) {
  if (!fact || typeof fact !== "object" || typeof fact.type !== "string") return [];
  const predicate = PREDICATE_BY_FACT[fact.type];
  // Class-level fact types are handled by their own predicate families below.
  if (!predicate && !CUSTOM_PREDICATE_FACT_TYPES.has(fact.type)) return [];

  const sessionId = context.sessionId ?? fact.sessionId ?? "unknown";
  const out = [];
  const ts = typeof fact.timestamp === "number" && Number.isFinite(fact.timestamp) ? fact.timestamp : Date.now();
  const subject = `session:${sessionId}`;

  switch (fact.type) {
    case "operation_started":
      pushTriple(out, subject, predicate, `op:${fact.id ?? "unknown"}`, `session:${sessionId}`, { validFrom: ts });
      if (fact.lane) pushTriple(out, `lane:${fact.lane}`, "produces", `op:${fact.id ?? "unknown"}`, `session:${sessionId}`, { validFrom: ts });
      if (fact.flowSha) pushTriple(out, `flow:${fact.flowSha}`, "spawns", `op:${fact.id ?? "unknown"}`, `session:${sessionId}`, { validFrom: ts });
      if (fact.intent?.kind) pushTriple(out, `op:${fact.id ?? "unknown"}`, "annotates", `intent:${fact.intent.kind}`, `session:${sessionId}`, { validFrom: ts });
      break;
    case "operation_finished":
      pushTriple(out, subject, predicate, `op:${fact.runId ?? "unknown"}`, `session:${sessionId}`, { validUntil: ts });
      if (typeof fact.outcome === "string") pushTriple(out, `op:${fact.runId ?? "unknown"}`, "annotates", `outcome:${fact.outcome}`, `session:${sessionId}`, { validUntil: ts });
      break;
    case "approval_asked":
      pushTriple(out, `tool:${fact.toolName ?? "unknown"}`, predicate, `op:${fact.runId ?? "unknown"}`, `session:${sessionId}`, { validFrom: ts });
      if (fact.argsDigest) pushTriple(out, `tool:${fact.toolName ?? "unknown"}`, "annotates", `digest:${fact.argsDigest}`, `session:${sessionId}`, { validFrom: ts });
      break;
    case "approval_decided":
      if (fact.outcome === "allowed-once") {
        pushTriple(out, `tool:${fact.toolName ?? fact.toolCallId ?? "unknown"}`, "produces", `op:${fact.runId ?? "unknown"}`, `session:${sessionId}`, { validUntil: ts, tag: "approved" });
      } else if (fact.outcome === "rejected" || fact.outcome === "denied") {
        pushTriple(out, `tool:${fact.toolName ?? fact.toolCallId ?? "unknown"}`, "denies", `op:${fact.runId ?? "unknown"}`, `session:${sessionId}`, { validUntil: ts, tag: "denied" });
      } else {
        pushTriple(out, `tool:${fact.toolName ?? fact.toolCallId ?? "unknown"}`, "annotates", `outcome:${fact.outcome}`, `session:${sessionId}`, { validUntil: ts });
      }
      break;
    case "session_reference":
      pushTriple(out, `session:${sessionId}`, predicate, `session:${fact.targetSessionId ?? "unknown"}`, `session:${sessionId}`, { validFrom: ts, tag: "reference" });
      pushTriple(out, `session:${sessionId}`, "annotates", `title:${fact.targetTitle ?? ""}`, `session:${sessionId}`, { validFrom: ts, tag: "reference" });
      break;
    case "context_attached":
      pushTriple(out, `session:${fact.targetSessionId ?? sessionId}`, predicate, `context:${fact.contextSha ?? "unknown"}`, `session:${sessionId}`, { validFrom: ts, tag: "context" });
      pushTriple(out, `context:${fact.contextSha ?? "unknown"}`, "attaches", `session:${fact.targetSessionId ?? sessionId}`, `session:${sessionId}`, { validFrom: ts, tag: "context" });
      break;
    case "checkpoint":
      if (typeof fact.checkpointId === "string") {
        pushTriple(out, `session:${sessionId}`, predicate, `checkpoint:${fact.checkpointId}`, `session:${sessionId}`, { validFrom: ts, tag: "checkpoint" });
        if (typeof fact.label === "string") pushTriple(out, `checkpoint:${fact.checkpointId}`, "annotates", `label:${fact.label}`, `session:${sessionId}`, { validFrom: ts, tag: "checkpoint" });
      }
      break;
    case "flow_trigger":
      if (typeof fact.flowSha === "string" && typeof fact.scheduleId === "string") {
        pushTriple(out, `flow:${fact.flowSha}`, predicate, `trigger:${fact.scheduleId}`, `session:${sessionId}`, { validFrom: ts, tag: "flow" });
        if (typeof fact.outcome === "string") pushTriple(out, `flow:${fact.flowSha}`, "annotates", `trigger_outcome:${fact.outcome}`, `session:${sessionId}`, { validFrom: ts, tag: "flow" });
      }
      break;
    case "config_changed": {
      const domainPredicate = CONFIG_PREDICATE_BY_DOMAIN[fact.domain];
      if (!domainPredicate) return [];
      const action = typeof fact.action === "string" ? fact.action : "update";
      const targetId = typeof fact.targetId === "string" ? fact.targetId : "unknown";
      pushTriple(out, `session:${sessionId}`, domainPredicate, `${action}:${targetId}`, `session:${sessionId}`, { validFrom: ts, tag: "config" });
      break;
    }
    case "usage_observed": {
      // Usage class: model x token/time/cost, tagged usage. Missing cost
      // fields stay missing (explicit-missing semantics preserved).
      if (typeof fact.model !== "string" || !fact.model) return [];
      const parts = [];
      if (typeof fact.tokens === "number" && Number.isFinite(fact.tokens)) parts.push(`tokens:${fact.tokens}`);
      if (typeof fact.elapsedMs === "number" && Number.isFinite(fact.elapsedMs)) parts.push(`elapsedMs:${fact.elapsedMs}`);
      if (typeof fact.costUsd === "number" && Number.isFinite(fact.costUsd)) parts.push(`costUsd:${fact.costUsd}`);
      pushTriple(out, `model:${fact.model}`, "custom_usage_observed", parts.join(" ") || "usage", `session:${sessionId}`, { validFrom: ts, tag: "usage" });
      break;
    }
    case "goal_state": {
      // Goal accounting: objective status + round counter.
      if (typeof fact.objective !== "string" || !fact.objective) return [];
      const status = typeof fact.status === "string" ? fact.status : "active";
      const rounds = Number.isFinite(fact.rounds) ? fact.rounds : 0;
      pushTriple(out, `session:${sessionId}`, "custom_goal_state", `${status}:rounds:${rounds}`, `session:${sessionId}`, { validFrom: ts, tag: "goal" });
      break;
    }
    default:
      return [];
  }
  return out;
}

/**
 * Project a batch of facts (as they arrive via `applySessionFacts`).
 * Invalid individual facts are skipped (the durable JSONL is the source
 * of truth; the graph is best-effort).
 */
export function projectFactBatchToTriples(facts, context = {}) {
  if (!Array.isArray(facts)) return [];
  const out = [];
  for (const fact of facts) {
    for (const triple of projectFactToTriples(fact, context)) {
      out.push(triple);
    }
  }
  return out;
}

export const FACT_TRIPLE_PROJECTIONS = Object.freeze({
  PREDICATE_BY_FACT,
  TRIPLE_PREDICATE,
  CHECKPOINT_OUTCOMES,
});
