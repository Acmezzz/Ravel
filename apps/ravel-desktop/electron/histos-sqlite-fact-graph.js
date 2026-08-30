/**
 * Sqlite-backed FactGraphBackend.
 *
 * Stores FactTriples in the same `index.sqlite` as the rest of Histos so
 * the fact graph is recovered atomically with the engine. The schema is
 * declared in `histos-schema.js`; this module only performs the read/write
 * SQL and the in-memory dedupe.
 *
 * Designed to be created once per `HistosEngine` instance and injected via
 * `engine.factGraph = createSqliteFactGraph({ database, workspaceId })` so
 * the engine can both seed the graph (from `applySessionFacts`) and serve
 * queries without going through IPC.
 */

import { normalizeFactTriples } from "./histos-fact-graph.js";
import { initializeHistosSchema } from "./histos-schema.js";

const MAX_TRIPLE_INSERT_PER_TX = 256;
const MAX_QUERY_ROWS = 1000;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: "invalid_args" });
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.exec !== "function") {
    throw invalid("database must be a node:sqlite DatabaseSync instance");
  }
}

function rowToTriple(row) {
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    source: row.source,
    scope: row.scope,
    tag: row.tag ?? null,
    confidence: typeof row.confidence === "number" ? row.confidence : 1,
    validFrom: row.valid_from ?? null,
    validUntil: row.valid_until ?? null,
    createdAt: row.created_at,
  };
}

function now() {
  return Date.now();
}

function generateId(existing) {
  // 8-char hex is plenty for an append-only fact log; mirrors the SessionEntry
  // id convention in the upstream pi project so existing log readers
  // recognize the same shape.
  let candidate;
  do {
    candidate = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  } while (existing.has(candidate));
  return candidate;
}

export function createSqliteFactGraph({ database, workspaceId, randomId, defaultScope } = {}) {
  requireDatabase(database);
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw invalid("workspaceId is required");
  }
  // The fact table is part of the Histos schema and is created by
  // `initializeHistosSchema`. Calling it here is idempotent (the underlying
  // DDL is `CREATE TABLE IF NOT EXISTS`) and lets the fact graph stand on
  // its own in tests + future code paths that don't go through
  // HistosEngine. A `histos_schema_init` savepoint keeps the operation
  // transactional against other in-flight writes.
  try { initializeHistosSchema(database, workspaceId); }
  catch (error) { throw invalid(`failed to initialize Histos schema for fact graph: ${error instanceof Error ? error.message : String(error)}`); }
  const resolvedScope = typeof defaultScope === "string" && defaultScope.length > 0 ? defaultScope : workspaceId;
  const makeId = typeof randomId === "function" ? randomId : generateId;
  const seenIds = new Set();
  let prepared = false;

  const insertOne = database.prepare(`
    INSERT OR IGNORE INTO fact_triples
      (id, subject, predicate, object, source, scope, tag, confidence, valid_from, valid_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const existsById = database.prepare("SELECT 1 AS present FROM fact_triples WHERE id = ?");
  const countAll = database.prepare("SELECT COUNT(*) AS count FROM fact_triples WHERE scope = ?");
  const distinctSubjects = database.prepare("SELECT COUNT(DISTINCT subject) AS count FROM fact_triples WHERE scope = ?");
  const distinctPredicates = database.prepare("SELECT COUNT(DISTINCT predicate) AS count FROM fact_triples WHERE scope = ?");
  const lastCreatedAt = database.prepare("SELECT MAX(created_at) AS last FROM fact_triples WHERE scope = ?");
  const deleteAll = database.prepare("DELETE FROM fact_triples WHERE scope = ?");

  function ensurePrepared() {
    if (prepared) return;
    // Pre-warm the ID dedupe set so the random id generator never collides.
    const existing = database.prepare("SELECT id FROM fact_triples").all();
    for (const row of existing) seenIds.add(row.id);
    prepared = true;
  }

  return Object.freeze({
    id: "sqlite",
    displayName: "Sqlite fact graph",
    async start() {
      ensurePrepared();
    },
    async stop() {
      seenIds.clear();
      prepared = false;
    },
    async writeTriples(input) {
      try {
        ensurePrepared();
        const normalized = normalizeFactTriples(input, resolvedScope);
        if (normalized.length === 0) return { ok: true, count: 0 };
        let count = 0;
        database.exec("BEGIN IMMEDIATE");
        try {
          for (let i = 0; i < normalized.length; i += MAX_TRIPLE_INSERT_PER_TX) {
            const chunk = normalized.slice(i, i + MAX_TRIPLE_INSERT_PER_TX);
            for (const triple of chunk) {
              const id = triple.id ?? (seenIds.has(triple.id ?? "") ? null : makeId(seenIds));
              if (!id) continue;
              if (existsById.get(id)) continue;
              seenIds.add(id);
              insertOne.run(
                id,
                triple.subject,
                triple.predicate,
                triple.object,
                triple.source,
                triple.scope,
                triple.tag,
                triple.confidence,
                triple.validFrom,
                triple.validUntil,
                triple.createdAt ?? now(),
              );
              count += 1;
            }
          }
          database.exec("COMMIT");
        } catch (error) {
          try { database.exec("ROLLBACK"); } catch { /* best effort */ }
          throw error;
        }
        return { ok: true, count };
      } catch (error) {
        return { ok: false, code: error?.code ?? "write_failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
    async queryTriples(query = {}) {
      try {
        ensurePrepared();
        const limit = Number.isSafeInteger(query.limit) ? Math.max(1, Math.min(MAX_QUERY_ROWS, query.limit)) : 100;
        const where = ["scope = ?"];
        const params = [resolvedScope];
        if (query.predicate) {
          where.push("predicate = ?");
          params.push(query.predicate);
        }
        if (query.subject) {
          const exact = !query.subject.endsWith("*");
          where.push(exact ? "subject = ?" : "subject LIKE ?");
          params.push(exact ? query.subject : query.subject.slice(0, -1) + "%");
        }
        if (query.object) {
          where.push("object LIKE ?");
          params.push(`%${query.object}%`);
        }
        if (query.tag) {
          where.push("tag = ?");
          params.push(query.tag);
        }
        if (Number.isFinite(query.asOf)) {
          where.push("(valid_from IS NULL OR valid_from <= ?)");
          where.push("(valid_until IS NULL OR valid_until >= ?)");
          params.push(query.asOf, query.asOf);
        }
        const sql = `SELECT id, subject, predicate, object, source, scope, tag, confidence, valid_from, valid_until, created_at
          FROM fact_triples
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC, id ASC
          LIMIT ?`;
        params.push(limit);
        const rows = database.prepare(sql).all(...params).map(rowToTriple).filter(Boolean);
        return { ok: true, triples: rows };
      } catch (error) {
        return { ok: false, code: error?.code ?? "query_failed", message: error instanceof Error ? error.message : String(error), triples: [] };
      }
    },
    async stats() {
      ensurePrepared();
      const total = countAll.get(resolvedScope)?.count ?? 0;
      const subjects = distinctSubjects.get(resolvedScope)?.count ?? 0;
      const predicates = distinctPredicates.get(resolvedScope)?.count ?? 0;
      const last = lastCreatedAt.get(resolvedScope)?.last ?? null;
      return {
        tripleCount: total,
        distinctSubjects: subjects,
        distinctPredicates: predicates,
        ...(typeof last === "number" ? { lastWriteAt: new Date(last).toISOString() } : {}),
      };
    },
    async clear() {
      try {
        ensurePrepared();
        const removed = countAll.get(resolvedScope)?.count ?? 0;
        deleteAll.run(resolvedScope);
        seenIds.clear();
        prepared = false;
        ensurePrepared();
        return { ok: true, count: removed };
      } catch (error) {
        return { ok: false, code: error?.code ?? "clear_failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
