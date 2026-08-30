import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import {
  HISTOS_INDEXES,
  HISTOS_TABLES,
  initializeHistosSchema,
  openHistosDatabase,
  validateHistosSchema,
} from "../electron/histos-schema.js";

async function tempWorkspace() {
  const directory = await fs.mkdtemp(join(os.tmpdir(), "histos-tombstones-"));
  return { directory, databasePath: join(directory, "index.sqlite") };
}

test("tombstones table is part of the schema and validates", () => {
  assert.ok(HISTOS_TABLES.includes("tombstones"));
  assert.ok(HISTOS_INDEXES.includes("tombstones_target_lookup"));
});

test("new workspace gains tombstones table, index and passing validation", async () => {
  const { databasePath } = await tempWorkspace();
  const database = openHistosDatabase(databasePath, "workspace-1");
  try {
    const tableColumns = database.prepare("PRAGMA table_info(tombstones)").all().map((row) => row.name);
    assert.deepEqual(tableColumns, ["id", "target_kind", "target_id", "reason", "created_at", "revoked_at"]);
    const indexColumns = database.prepare("PRAGMA index_info(tombstones_target_lookup)").all().map((row) => row.name);
    assert.deepEqual(indexColumns, ["target_kind", "target_id"]);
    const metadata = validateHistosSchema(database, "workspace-1");
    assert.equal(metadata.schema_version, "2");
    // A tombstone row round-trips with its closed target_kind set.
    const insert = database.prepare(
      "INSERT INTO tombstones (id, target_kind, target_id, reason, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("ab12cd34", "triple", "t-0123456789abcdef", "user request", 1_000, null);
    const row = database.prepare("SELECT * FROM tombstones WHERE id = ?").get("ab12cd34");
    assert.equal(row.target_kind, "triple");
    assert.equal(row.revoked_at, null);
  } finally {
    database.close();
  }
});

test("old workspace reopens with tombstones table added and existing data intact", async () => {
  const { databasePath } = await tempWorkspace();
  const database = openHistosDatabase(databasePath, "workspace-1");
  database.prepare(
    "INSERT INTO fact_triples (id, subject, predicate, object, source, scope, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("t-0123456789abcdef", "session:1", "mentions", "file:main.ts", "session_entry", "workspace-1", 1, 500);
  // Simulate a pre-tombstones database.
  database.exec("DROP INDEX tombstones_target_lookup");
  database.exec("DROP TABLE tombstones");
  assert.throws(() => validateHistosSchema(database, "workspace-1"), /table tombstones/);
  database.close();

  const reopened = new DatabaseSync(databasePath);
  try {
    // initializeHistosSchema runs CREATE_SCHEMA_SQL (IF NOT EXISTS) on every
    // open, so the dropped table is recreated without touching other data.
    initializeHistosSchema(reopened, "workspace-1");
    const metadata = validateHistosSchema(reopened, "workspace-1");
    assert.equal(metadata.schema_version, "2");
    const triple = reopened.prepare("SELECT * FROM fact_triples WHERE id = ?").get("t-0123456789abcdef");
    assert.equal(triple.predicate, "mentions");
    const columns = reopened.prepare("PRAGMA table_info(tombstones)").all().map((row) => row.name);
    assert.deepEqual(columns, ["id", "target_kind", "target_id", "reason", "created_at", "revoked_at"]);
  } finally {
    reopened.close();
  }
});
