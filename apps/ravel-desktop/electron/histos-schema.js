import { DatabaseSync } from "node:sqlite";
import {
  FACT_SOURCE_TYPES,
  addressIdForFactAddress,
  canonicalFactAddress,
  formatFactAddress,
  validateFactAddress,
} from "./histos-address.js";

/**
 * The on-disk schema version. A schema mismatch is a rebuild/migration concern;
 * this module deliberately does not mutate an existing database to another
 * version.
 */
export const HISTOS_SCHEMA_VERSION = "2";
export const SCHEMA_VERSION = HISTOS_SCHEMA_VERSION;

const TABLE_DEFINITIONS = Object.freeze({
  addresses: Object.freeze([
    ["address_id", "TEXT", 0, null, 1],
    ["source_type", "TEXT", 1, null, 0],
    ["object_id", "TEXT", 1, null, 0],
    ["revision_id", "TEXT", 1, null, 0],
    ["selector_json", "TEXT", 0, null, 0],
  ]),
  node_revisions: Object.freeze([
    ["node_revision_id", "TEXT", 0, null, 1],
    ["node_id", "TEXT", 1, null, 0],
    ["kind", "TEXT", 1, null, 0],
    ["title", "TEXT", 0, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["artifact_sha", "TEXT", 0, null, 0],
    ["anchor_json", "TEXT", 0, null, 0],
  ]),
  edge_revisions: Object.freeze([
    ["edge_revision_id", "TEXT", 0, null, 1],
    ["edge_id", "TEXT", 1, null, 0],
    ["src_node_id", "TEXT", 1, null, 0],
    ["dst_node_id", "TEXT", 1, null, 0],
    ["kind", "TEXT", 1, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["artifact_sha", "TEXT", 0, null, 0],
    ["anchor_json", "TEXT", 0, null, 0],
  ]),
  revision_parents: Object.freeze([
    ["child_id", "TEXT", 1, null, 1],
    ["parent_id", "TEXT", 1, null, 2],
  ]),
  evidence: Object.freeze([
    ["revision_id", "TEXT", 1, null, 1],
    ["address_id", "TEXT", 1, null, 2],
    ["role", "TEXT", 1, null, 3],
  ]),
  spans: Object.freeze([
    ["span_id", "TEXT", 0, null, 1],
    ["address_id", "TEXT", 1, null, 0],
    ["entry_object_id", "TEXT", 1, null, 0],
    ["start", "INTEGER", 1, null, 0],
    ["length", "INTEGER", 1, null, 0],
  ]),
  artifacts: Object.freeze([
    ["sha256", "TEXT", 0, null, 1],
    ["kind", "TEXT", 1, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["source_set_json", "TEXT", 1, null, 0],
    ["lens", "TEXT", 1, null, 0],
    ["granularity", "TEXT", 1, null, 0],
  ]),
  meta: Object.freeze([
    ["key", "TEXT", 0, null, 1],
    ["value", "TEXT", 1, null, 0],
  ]),
  // Fact-graph triples (added alongside the §7.3 verified shape so the
  // validator accepts the new table; the CREATE TABLE IF NOT EXISTS
  // above runs on every init so old workspaces gain the table on first
  // open). Rows are append-only and the primary key is the content-
  // addressed triple id (`t-<16hex>`).
  fact_triples: Object.freeze([
    ["id", "TEXT", 0, null, 1],
    ["subject", "TEXT", 1, null, 0],
    ["predicate", "TEXT", 1, null, 0],
    ["object", "TEXT", 1, null, 0],
    ["source", "TEXT", 1, null, 0],
    ["scope", "TEXT", 1, null, 0],
    ["tag", "TEXT", 0, null, 0],
    ["confidence", "REAL", 1, "1", 0],
    ["valid_from", "INTEGER", 0, null, 0],
    ["valid_until", "INTEGER", 0, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
  ]),
  // Tombstones for the two-level deletion semantics (archive = tombstone,
  // reversible via revoked_at; purge = physical delete, never a tombstone).
  // Rows act as a query-level filter for every Histos read path; the JSONL
  // fact authority is never touched by an archive. `revoked_at` non-null
  // means the tombstone has been revoked (entry restored), keeping the
  // audit trail of who/when was restored.
  tombstones: Object.freeze([
    ["id", "TEXT", 0, null, 1],
    ["target_kind", "TEXT", 1, null, 0],
    ["target_id", "TEXT", 1, null, 0],
    ["reason", "TEXT", 0, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["revoked_at", "INTEGER", 0, null, 0],
  ]),
});

export const HISTOS_TABLES = Object.freeze(Object.keys(TABLE_DEFINITIONS));

const INDEX_DEFINITIONS = Object.freeze({
  addresses_source_lookup: Object.freeze({ table: "addresses", columns: ["source_type", "object_id", "revision_id"] }),
  node_revisions_node_lookup: Object.freeze({ table: "node_revisions", columns: ["node_id", "created_at"] }),
  edge_revisions_edge_lookup: Object.freeze({ table: "edge_revisions", columns: ["edge_id", "created_at"] }),
  revision_parents_parent_lookup: Object.freeze({ table: "revision_parents", columns: ["parent_id", "child_id"] }),
  evidence_address_lookup: Object.freeze({ table: "evidence", columns: ["address_id", "revision_id"] }),
  spans_entry_lookup: Object.freeze({ table: "spans", columns: ["entry_object_id", "start"] }),
  artifacts_kind_lookup: Object.freeze({ table: "artifacts", columns: ["kind", "created_at"] }),
  fact_triples_subject_lookup: Object.freeze({ table: "fact_triples", columns: ["scope", "subject", "created_at"] }),
  fact_triples_predicate_lookup: Object.freeze({ table: "fact_triples", columns: ["scope", "predicate", "created_at"] }),
  fact_triples_object_lookup: Object.freeze({ table: "fact_triples", columns: ["scope", "object", "created_at"] }),
  tombstones_target_lookup: Object.freeze({ table: "tombstones", columns: ["target_kind", "target_id"] }),
});

export const HISTOS_INDEXES = Object.freeze(Object.keys(INDEX_DEFINITIONS));

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS addresses (
  address_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  selector_json TEXT
);

CREATE TABLE IF NOT EXISTS node_revisions (
  node_revision_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  artifact_sha TEXT,
  anchor_json TEXT
);

CREATE TABLE IF NOT EXISTS edge_revisions (
  edge_revision_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  src_node_id TEXT NOT NULL,
  dst_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  artifact_sha TEXT,
  anchor_json TEXT
);

CREATE TABLE IF NOT EXISTS revision_parents (
  child_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  PRIMARY KEY (child_id, parent_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  revision_id TEXT NOT NULL,
  address_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (revision_id, address_id, role)
);

CREATE TABLE IF NOT EXISTS spans (
  span_id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL,
  entry_object_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  length INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  sha256 TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source_set_json TEXT NOT NULL,
  lens TEXT NOT NULL,
  granularity TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS addresses_source_lookup
  ON addresses (source_type, object_id, revision_id);
CREATE INDEX IF NOT EXISTS node_revisions_node_lookup
  ON node_revisions (node_id, created_at);
CREATE INDEX IF NOT EXISTS edge_revisions_edge_lookup
  ON edge_revisions (edge_id, created_at);
CREATE INDEX IF NOT EXISTS revision_parents_parent_lookup
  ON revision_parents (parent_id, child_id);
CREATE INDEX IF NOT EXISTS evidence_address_lookup
  ON evidence (address_id, revision_id);
CREATE INDEX IF NOT EXISTS spans_entry_lookup
  ON spans (entry_object_id, start);
CREATE INDEX IF NOT EXISTS artifacts_kind_lookup
  ON artifacts (kind, created_at);

-- Fact-graph triples (added in v2.1, not part of the §7.3 verified shape so
-- the schema validator never rejects a pre-triples database on upgrade).
-- The table is created on every init so old workspaces gain it the next
-- time the engine opens. Writes are append-only; the (id) primary key lets
-- the in-memory map dedupe before INSERT OR IGNORE.
CREATE TABLE IF NOT EXISTS fact_triples (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  tag TEXT,
  confidence REAL NOT NULL DEFAULT 1,
  valid_from INTEGER,
  valid_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS fact_triples_subject_lookup
  ON fact_triples (scope, subject, created_at);
CREATE INDEX IF NOT EXISTS fact_triples_predicate_lookup
  ON fact_triples (scope, predicate, created_at);
CREATE INDEX IF NOT EXISTS fact_triples_object_lookup
  ON fact_triples (scope, object, created_at);

-- Tombstones for the P0 traceability cycle (archive/restore semantics).
-- Created on every init so old workspaces gain the table on first open.
-- target_kind is a closed set: 'triple' | 'node' | 'edge' | 'artifact' |
-- 'session_index'. reason is user-supplied (<= 512 chars) and optional.
-- revoked_at non-null marks a restored (un-deleted) entry; the row itself
-- is kept so the audit chain of archive/restore actions stays queryable.
CREATE TABLE IF NOT EXISTS tombstones (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS tombstones_target_lookup
  ON tombstones (target_kind, target_id);
`;

const MAX_WORKSPACE_ID_LENGTH = 512;

function invalid(message) {
  return Object.assign(new TypeError(message), { code: "invalid_args" });
}

function requireNonEmptyString(value, name, maxLength = MAX_WORKSPACE_ID_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid(`${name} must be a non-empty string of at most ${maxLength} characters without control characters`);
  }
  return value;
}

export { FACT_SOURCE_TYPES, addressIdForFactAddress, canonicalFactAddress, formatFactAddress, validateFactAddress };

function assertDatabase(database) {
  if (!database || typeof database.exec !== "function" || typeof database.prepare !== "function") {
    throw invalid("database must provide the DatabaseSync exec() and prepare() API");
  }
}

function assertWorkspaceId(workspaceId) {
  return requireNonEmptyString(workspaceId, "workspaceId", MAX_WORKSPACE_ID_LENGTH);
}

function readTableInfo(database, table) {
  const rows = database.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
  return rows.map((row) => [row.name, row.type, Number(row.notnull), row.dflt_value, Number(row.pk)]);
}

function readIndexInfo(database, index) {
  const rows = database.prepare(`PRAGMA index_info(${JSON.stringify(index)})`).all();
  return rows.sort((left, right) => Number(left.seqno) - Number(right.seqno)).map((row) => row.name);
}

function schemaError(message) {
  return Object.assign(new Error(`invalid Histos schema: ${message}`), { code: "invalid_schema" });
}

/**
 * Validate table/index shape and metadata without creating or changing anything.
 * Returns the metadata key/value map on success.
 */
export function validateHistosSchema(database, expectedWorkspaceId) {
  assertDatabase(database);
  for (const table of HISTOS_TABLES) {
    const actual = readTableInfo(database, table);
    const expected = TABLE_DEFINITIONS[table];
    if (actual.length !== expected.length || actual.some((column, index) => column.some((value, field) => value !== expected[index][field]))) {
      throw schemaError(`table ${table} does not match the §7.3 definition`);
    }
  }
  for (const [index, definition] of Object.entries(INDEX_DEFINITIONS)) {
    const exists = database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ?").get(index);
    if (!exists) throw schemaError(`missing index ${index}`);
    const columns = readIndexInfo(database, index);
    if (columns.length !== definition.columns.length || columns.some((column, position) => column !== definition.columns[position])) {
      throw schemaError(`index ${index} does not match its definition`);
    }
  }

  const metadataRows = database.prepare("SELECT key, value FROM meta").all();
  const metadata = Object.create(null);
  for (const row of metadataRows) {
    if (typeof row.key !== "string" || typeof row.value !== "string") throw schemaError("meta contains a non-text key or value");
    metadata[row.key] = row.value;
  }
  if (metadata.schema_version !== HISTOS_SCHEMA_VERSION) throw schemaError(`unsupported schema_version ${metadata.schema_version ?? "(missing)"}`);
  if (expectedWorkspaceId !== undefined && metadata.workspace_id !== assertWorkspaceId(expectedWorkspaceId)) {
    throw schemaError("workspace_id does not match the requested workspace");
  }
  return metadata;
}

/**
 * Create the §7.3 lookup schema in a DatabaseSync connection and initialize
 * immutable identity metadata. Existing databases are only accepted when both
 * schema_version and workspace_id already match.
 */
export function initializeHistosSchema(database, workspaceId) {
  assertDatabase(database);
  const normalizedWorkspaceId = assertWorkspaceId(workspaceId);

  database.exec("SAVEPOINT histos_schema_init");
  try {
    database.exec(CREATE_SCHEMA_SQL);
    const existing = database.prepare("SELECT key, value FROM meta WHERE key IN ('schema_version', 'workspace_id')").all();
    const metadata = Object.fromEntries(existing.map((row) => [row.key, row.value]));
    if (metadata.schema_version !== undefined && metadata.schema_version !== HISTOS_SCHEMA_VERSION) {
      throw schemaError(`unsupported schema_version ${metadata.schema_version}`);
    }
    if (metadata.workspace_id !== undefined && metadata.workspace_id !== normalizedWorkspaceId) {
      throw schemaError("workspace_id does not match the requested workspace");
    }
    const setMetadata = database.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    setMetadata.run("schema_version", HISTOS_SCHEMA_VERSION);
    setMetadata.run("workspace_id", normalizedWorkspaceId);
    database.exec("RELEASE SAVEPOINT histos_schema_init");
  } catch (error) {
    try { database.exec("ROLLBACK TO SAVEPOINT histos_schema_init"); } finally { database.exec("RELEASE SAVEPOINT histos_schema_init"); }
    throw error;
  }

  validateHistosSchema(database, normalizedWorkspaceId);
  return database;
}

/** Open a workspace index and initialize/validate its schema. */
export function openHistosDatabase(path, workspaceId, options = {}) {
  const database = new DatabaseSync(path, { timeout: 5000, ...options });
  try {
    initializeHistosSchema(database, workspaceId);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

// Explicit aliases keep the public API readable at call sites that use either
// the schema or database terminology.
export const createHistosSchema = initializeHistosSchema;
export const validateSchema = validateHistosSchema;
