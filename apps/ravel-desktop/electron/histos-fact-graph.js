/**
 * Fact-graph backend (adapted from oh-my-pi Mnemopi Triple model).
 *
 * A `FactGraphBackend` is the single seam through which session JSONL facts
 * (operation_started/finished, approval_asked/decided, session_reference,
 * context_attached, ...) become a queryable, time-windowed, scoped triple
 * store that powers the Histos surface's "facts" lens.
 *
 * The contract intentionally mirrors the @oh-my-pi MemoryBackend shape so
 * future backends (mnemopi / hindsight / off) can be slotted in without
 * touching HistosEngine or the IPC layer.
 *
 * Triple shape (id, subject, predicate, object, validFrom, validUntil, source,
 * confidence, createdAt). `validFrom` / `validUntil` are unix millis; a
 * missing `validUntil` means "still in effect". A "scoping" string
 * (`workspaceId` by default, plus optional tag) is injected on every write
 * so the same backend can serve multiple projects without cross-bleed.
 *
 * This module is dependency-free: it exports the contract + a tiny in-memory
 * reference implementation (`createInMemoryFactGraph`). The sqlite-backed
 * implementation lives in `histos-sqlite-fact-graph.js` and is the production
 * path wired into HistosEngine.
 */

import { createHash } from "node:crypto";

export const FACT_PREDICATES = Object.freeze([
  "references",
  "produces",
  "attaches",
  "depends_on",
  "supersedes",
  "revises",
  "annotates",
  "schedules",
  "spawns",
  "approves",
  "denies",
]);

const MAX_TRIPLE_FIELDS = Object.freeze({
  id: 128,
  subject: 512,
  predicate: 64,
  object: 4096,
  source: 256,
  scope: 128,
  tag: 128,
});

const SUBJECT_PREDICATE_RE = /^[\p{L}\p{N}_:.-]+$/u;
const PREDICATE_RE = /^[a-z][a-z0-9_]{0,63}$/;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: "invalid_args" });
}

function requireBoundedString(value, name, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw invalid(`${name} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function requireFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${name} must be a finite number`);
  }
  return value;
}

function normalizeScope(scope, fallback) {
  if (scope === undefined || scope === null || scope === "") return fallback;
  return requireBoundedString(scope, "scope", MAX_TRIPLE_FIELDS.scope);
}

function normalizeTag(tag) {
  if (tag === undefined || tag === null || tag === "") return null;
  return requireBoundedString(tag, "tag", MAX_TRIPLE_FIELDS.tag);
}

function normalizeConfidence(confidence) {
  if (confidence === undefined || confidence === null) return 1;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw invalid("confidence must be a finite number between 0 and 1");
  }
  return confidence;
}

function normalizeValidWindow({ validFrom, validUntil }) {
  const from = validFrom === undefined || validFrom === null ? null : requireFiniteNumber(validFrom, "validFrom");
  const until = validUntil === undefined || validUntil === null ? null : requireFiniteNumber(validUntil, "validUntil");
  if (from !== null && until !== null && until < from) {
    throw invalid("validUntil must be greater than or equal to validFrom");
  }
  return { validFrom: from, validUntil: until };
}

function normalizeTriple(triple, fallbackScope) {
  if (!triple || typeof triple !== "object") throw invalid("triple must be an object");
  const subject = requireBoundedString(triple.subject, "subject", MAX_TRIPLE_FIELDS.subject);
  if (!SUBJECT_PREDICATE_RE.test(subject)) {
    throw invalid(`subject contains unsupported characters: ${subject.slice(0, 64)}`);
  }
  const predicate = requireBoundedString(triple.predicate, "predicate", MAX_TRIPLE_FIELDS.predicate);
  if (!PREDICATE_RE.test(predicate)) {
    throw invalid(`predicate must match ${PREDICATE_RE.source}: ${predicate}`);
  }
  if (!FACT_PREDICATES.includes(predicate) && !predicate.startsWith("custom_")) {
    throw invalid(`predicate ${predicate} is not in FACT_PREDICATES and does not start with "custom_"`);
  }
  const object = requireBoundedString(triple.object, "object", MAX_TRIPLE_FIELDS.object);
  const source = requireBoundedString(triple.source, "source", MAX_TRIPLE_FIELDS.source);
  const { validFrom, validUntil } = normalizeValidWindow(triple);
  const scope = normalizeScope(triple.scope, fallbackScope);
  const tag = normalizeTag(triple.tag);
  const confidence = normalizeConfidence(triple.confidence);
  const id = typeof triple.id === "string" && triple.id.length > 0 && triple.id.length <= MAX_TRIPLE_FIELDS.id
    ? triple.id
    : null;
  const createdAt = typeof triple.createdAt === "number" && Number.isFinite(triple.createdAt) ? triple.createdAt : Date.now();
  // Content-addressed default id: same (subject, predicate, object, source,
  // validFrom, validUntil) maps to the same id, so re-inserting the same
  // fact after a process restart collapses. Callers that need a fresh
  // revision should bump `validFrom` or pass an explicit `id`.
  const defaultId = `t-${createHash("sha256").update(JSON.stringify([subject, predicate, object, source, validFrom, validUntil])).digest("hex").slice(0, 16)}`;
  return { id: id ?? defaultId, subject, predicate, object, source, scope, tag, confidence, validFrom, validUntil, createdAt };
}

/**
 * Normalize a single triple or a batch. Returns the canonical shape ready for
 * `writeTriples`. Invalid entries throw with a stable `code: "invalid_args"`.
 */
export function normalizeFactTriples(triples, fallbackScope) {
  if (!Array.isArray(triples)) throw invalid("triples must be an array");
  return triples.map((entry) => normalizeTriple(entry, fallbackScope));
}

/**
 * The contract every fact-graph backend implements. Methods are non-throwing
 * unless documented otherwise; storage failures surface as
 * `{ ok: false, code, message }` so the agent hot path stays safe.
 *
 * @typedef {Object} FactTriple
 * @property {string=} id       Stable identifier (8-char hex or any bounded string).
 * @property {string} subject   URI/IRI-like identifier (no whitespace).
 * @property {string} predicate Lower-snake verb from FACT_PREDICATES or `custom_*`.
 * @property {string} object    Free-form string up to 4096 chars.
 * @property {string} source    Where this fact came from (e.g. "session:<id>").
 * @property {string=} scope    Workspace key; defaults to backend default.
 * @property {string=} tag      Optional secondary tag (per-project-tagged scoping).
 * @property {number=} validFrom    Unix ms; null means "since forever".
 * @property {number=} validUntil   Unix ms; null means "still in effect".
 * @property {number=} confidence   [0, 1]; defaults to 1.
 * @property {number=} createdAt    Unix ms; defaults to Date.now().
 *
 * @typedef {Object} FactQuery
 * @property {string=} subject      Prefix or exact subject.
 * @property {string=} predicate    Exact predicate.
 * @property {string=} object       Substring match on the object string.
 * @property {string=} scope        Scope filter (default: backend default).
 * @property {string=} tag          Tag filter.
 * @property {number=} asOf         `asOf` window filter; only triples whose
 *                                  [validFrom, validUntil] window contains
 *                                  `asOf` are returned.
 * @property {number=} limit        Max results; 1..=1000, default 100.
 *
 * @typedef {Object} FactGraphStats
 * @property {number} tripleCount
 * @property {number} distinctSubjects
 * @property {number} distinctPredicates
 * @property {string=} lastWriteAt
 *
 * @typedef {Object} FactGraphBackend
 * @property {string} id           Stable id (`"off"`, `"sqlite"`, future `"mnemopi"`).
 * @property {string} displayName
 * @property {(input: { workspaceId: string }) => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {(triples: FactTriple[]) => Promise<{ ok: boolean, count: number, code?: string, message?: string }>} writeTriples
 * @property {(query: FactQuery) => Promise<{ ok: boolean, triples: FactTriple[], code?: string, message?: string }>} queryTriples
 * @property {() => Promise<FactGraphStats>} stats
 * @property {() => Promise<{ ok: boolean, count: number, code?: string, message?: string }>} clear
 */

/**
 * In-memory backend used by tests and as the `off` fallback. Implements the
 * full contract so swapping in the sqlite implementation requires no caller
 * changes.
 */
export function createInMemoryFactGraph({ defaultScope, now = () => Date.now(), randomId } = {}) {
  const triples = [];
  const byId = new Map();
  let started = false;
  let resolvedScope = typeof defaultScope === "string" && defaultScope.length > 0 ? defaultScope : null;
  const makeId = typeof randomId === "function" ? randomId : () => Math.random().toString(16).slice(2, 10);

  function indexTriple(triple) {
    const id = triple.id ?? `t-${makeId()}`;
    const stored = { ...triple, id, createdAt: triple.createdAt ?? now() };
    byId.set(id, stored);
    triples.push(stored);
    return stored;
  }

  function removeExpired(candidates, asOf) {
    if (asOf === undefined || asOf === null) return candidates;
    return candidates.filter((triple) => {
      if (triple.validFrom !== null && triple.validFrom > asOf) return false;
      if (triple.validUntil !== null && triple.validUntil < asOf) return false;
      return true;
    });
  }

  function inScope(triple, query) {
    if (query.scope && triple.scope !== query.scope) return false;
    if (query.tag && triple.tag !== query.tag) return false;
    return true;
  }

  return Object.freeze({
    id: "in-memory",
    displayName: "In-memory fact graph (tests / off)",
    async start({ workspaceId } = {}) {
      if (typeof workspaceId === "string" && workspaceId.length > 0) resolvedScope = workspaceId;
      started = true;
    },
    async stop() {
      triples.length = 0;
      byId.clear();
      started = false;
    },
    async writeTriples(input) {
      if (!started) return { ok: false, code: "not_ready", message: "Fact graph backend is not started" };
      try {
        const normalized = normalizeFactTriples(input, resolvedScope);
        let count = 0;
        for (const triple of normalized) {
          if (byId.has(triple.id ?? "")) continue;
          indexTriple(triple);
          count += 1;
        }
        return { ok: true, count };
      } catch (error) {
        return { ok: false, code: error?.code ?? "write_failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
    async queryTriples(query = {}) {
      if (!started) return { ok: false, code: "not_ready", message: "Fact graph backend is not started", triples: [] };
      const limit = Number.isSafeInteger(query.limit) ? Math.max(1, Math.min(1000, query.limit)) : 100;
      const subjectFilter = typeof query.subject === "string" ? query.subject : null;
      const objectFilter = typeof query.object === "string" ? query.object : null;
      const matches = triples
        .filter((triple) => inScope(triple, query))
        .filter((triple) => (query.predicate ? triple.predicate === query.predicate : true))
        .filter((triple) => (subjectFilter ? (subjectFilter.includes("*") ? triple.subject.startsWith(subjectFilter.replace(/\*$/, "")) : triple.subject === subjectFilter) : true))
        .filter((triple) => (objectFilter ? triple.object.includes(objectFilter) : true))
        .filter((triple) => removeExpired([triple], query.asOf).length > 0)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit);
      return { ok: true, triples: matches };
    },
    async stats() {
      const distinctSubjects = new Set(triples.map((triple) => triple.subject));
      const distinctPredicates = new Set(triples.map((triple) => triple.predicate));
      const lastWriteAt = triples.length > 0 ? new Date(Math.max(...triples.map((triple) => triple.createdAt))).toISOString() : null;
      return {
        tripleCount: triples.length,
        distinctSubjects: distinctSubjects.size,
        distinctPredicates: distinctPredicates.size,
        ...(lastWriteAt ? { lastWriteAt } : {}),
      };
    },
    async clear() {
      const count = triples.length;
      triples.length = 0;
      byId.clear();
      return { ok: true, count };
    },
  });
}

/**
 * The `off` backend explicitly discards every write and reports `count: 0`.
 * The fact graph is opt-in; when the user disables it, no triples are
 * stored and no facts leak to disk or memory.
 */
export function createOffFactGraph() {
  return Object.freeze({
    id: "off",
    displayName: "Fact graph disabled",
    async start() {},
    async stop() {},
    async writeTriples() {
      // No-op by contract; the engine observes `count: 0` to skip the
      // post-write diagnostic in the log.
      return { ok: true, count: 0 };
    },
    async queryTriples() { return { ok: true, triples: [] }; },
    async stats() { return { tripleCount: 0, distinctSubjects: 0, distinctPredicates: 0 }; },
    async clear() { return { ok: true, count: 0 }; },
  });
}
