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

// --- T0.2 archive/restore engine semantics ---

import { HistosEngine } from "../electron/histos-engine.js";
import { createHistosEventBus } from "../electron/histos-event-bus.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const QUERY = { sourceSet: {}, lens: "structural", granularity: "entry" };

function createEngine() {
  const directory = mkdtempSync(join(tmpdir(), "histos-archive-"));
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
  });
  if (engine.initializationError) throw engine.initializationError;
  return { directory, engine };
}

const SESSION_FACTS = [
  { type: "operation_started", id: "op-1", lane: "main", intent: { kind: "run" }, timestamp: 1_000 },
  { type: "operation_finished", runId: "op-1", outcome: "completed", timestamp: 1_100 },
  { type: "operation_started", id: "op-2", lane: "main", intent: { kind: "run" }, timestamp: 1_200 },
  { type: "approval_asked", id: "ask-1", runId: "op-2", toolCallId: "tc-1", toolName: "bash", argsDigest: "sha256:abc", timestamp: 1_300 },
  { type: "approval_decided", id: "dec-1", runId: "op-2", toolCallId: "tc-1", askedId: "ask-1", outcome: "allowed-once", timestamp: 1_400 },
];

test("archive hides a node from all four read paths; restore revives it with an audit trail", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applySessionFacts({ sessionId: "s1", facts: SESSION_FACTS });
    const graph = engine.getGraph(QUERY);
    const operationNodes = graph.nodes.filter((node) => node.kind === "operation" && node.title === "operation_started");
    assert.ok(operationNodes.length === 2, "expected both operation_started nodes");

    const archive = engine.archiveEntries("node", operationNodes.map((node) => node.nodeRevisionId), "user tidying");
    assert.equal(archive.archivedCount, 2);
    // Idempotent: a second archive of the same targets is a no-op.
    assert.equal(engine.archiveEntries("node", operationNodes.map((node) => node.nodeRevisionId)).archivedCount, 0);

    assert.ok(!engine.getGraph(QUERY).nodes.some((node) => operationNodes.some((archived) => archived.nodeRevisionId === node.nodeRevisionId)));
    assert.equal(engine.getNode(operationNodes[0].nodeRevisionId, QUERY), null);
    assert.equal(engine.getNode(operationNodes[1].nodeRevisionId, QUERY), null);
    assert.equal(engine.suggestContext({ terms: ["operation_started"] }).candidates.length, 0);

    // Unknown targets fail closed instead of pretending to archive.
    assert.throws(() => engine.archiveEntries("node", ["deadbeef"]), /target_not_found|unknown node/);

    const database = engine.assertOpen();
    const tombstones = database.prepare("SELECT id, target_kind, target_id, reason, created_at, revoked_at FROM tombstones").all();
    assert.equal(tombstones.length, 2);
    assert.ok(tombstones.every((row) => row.target_kind === "node"));
    assert.ok(tombstones.every((row) => row.reason === "user tidying"));
    assert.ok(tombstones.every((row) => row.revoked_at === null));
    const tombstoneId = tombstones[0].id;

    const restore = engine.restoreEntries([tombstoneId]);
    assert.equal(restore.restoredCount, 1);
    assert.ok(engine.getGraph(QUERY).nodes.some((node) => node.nodeRevisionId === operationNodes[0].nodeRevisionId));
    assert.ok(engine.getNode(operationNodes[0].nodeRevisionId, QUERY));
    const revoked = database.prepare("SELECT revoked_at FROM tombstones WHERE id = ?").get(tombstoneId);
    assert.ok(typeof revoked.revoked_at === "number", "revocation must be recorded");
    // Restore of an unknown tombstone id is reported, not thrown.
    assert.deepEqual(engine.restoreEntries(["ffffffff"]).notFound, ["ffffffff"]);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approval nodes and approval triples refuse to archive (fail-closed)", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applySessionFacts({ sessionId: "s1", facts: SESSION_FACTS });
    const graph = engine.getGraph(QUERY);
    const approvalNode = graph.nodes.find((node) => node.kind === "approval");
    assert.ok(approvalNode, "expected an approval node");
    assert.throws(() => engine.archiveEntries("node", [approvalNode.nodeRevisionId]), /approval accounting facts cannot be archived/);

    const facts = await engine.queryFacts({ predicate: "approves" });
    assert.ok(facts.triples.length > 0, "expected approval triples");
    const tripleId = facts.triples[0].id;
    assert.throws(() => engine.archiveEntries("triple", [tripleId]), /approval accounting triples cannot be archived/);
    // Nothing was written by the failed attempts.
    assert.equal(engine.assertOpen().prepare("SELECT COUNT(*) AS count FROM tombstones").get().count, 0);
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("archiving a plain triple hides it from queryFacts until restored", async () => {
  const { directory, engine } = createEngine();
  try {
    await engine.applySessionFacts({ sessionId: "s1", facts: SESSION_FACTS });
    const facts = await engine.queryFacts({ predicate: "produces" });
    const plain = facts.triples.find((triple) => triple.predicate === "produces" && !triple.tag);
    assert.ok(plain, "expected a plain produces triple");

    engine.archiveEntries("triple", [plain.id], "stale index entry");
    const after = await engine.queryFacts({ predicate: "produces" });
    assert.ok(!after.triples.some((triple) => triple.id === plain.id));

    const row = engine.assertOpen().prepare("SELECT id FROM tombstones WHERE target_kind = 'triple' AND target_id = ?").get(plain.id);
    engine.restoreEntries([row.id]);
    const restored = await engine.queryFacts({ predicate: "produces" });
    assert.ok(restored.triples.some((triple) => triple.id === plain.id));
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

// --- T0.3 rebuild replays tombstones ---

test("rebuild carries tombstones into the swapped index so archives survive", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "histos-rebuild-tombstones-"));
  const sessionFile = join(root, "session.jsonl");
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session", version: 3, id: "session-tombstone", cwd: root }),
    JSON.stringify({ type: "message", id: "m-1", parentId: null, message: { role: "user", content: "first message" } }),
    JSON.stringify({ type: "message", id: "m-2", parentId: "m-1", message: { role: "assistant", content: "second message" } }),
  ].join("\n") + "\n");
  const engine = new HistosEngine({
    workspaceId: "workspace-tombstone",
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
    sessionFiles: [sessionFile],
  });
  t.after(async () => { engine.close(); await fs.rm(root, { recursive: true, force: true }); });

  const query = { sourceSet: { sessionIds: ["session-tombstone"] }, lens: "structural", granularity: "entry" };
  await engine.rebuild({ granularity: "entry" });
  const before = engine.getGraph(query);
  const victim = before.nodes.find((node) => node.nodeId === "entry:session-tombstone/m-1");
  assert.ok(victim, "expected the first message node");

  engine.archiveEntries("node", [victim.nodeRevisionId], "rebuild survival check");
  await engine.rebuild({ granularity: "entry" });

  const after = engine.getGraph(query);
  assert.ok(!after.nodes.some((node) => node.nodeId === "entry:session-tombstone/m-1"), "archived node must stay hidden after rebuild");
  assert.ok(after.nodes.some((node) => node.nodeId === "entry:session-tombstone/m-2"), "unarchived nodes must survive");
  const tombstones = engine.assertOpen().prepare("SELECT target_kind, target_id, revoked_at FROM tombstones").all();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].target_kind, "node");
  assert.equal(tombstones[0].target_id, victim.nodeRevisionId);
});

test("archive/restore/purge emit bus events for the renderer relay", () => {
  const directory = mkdtempSync(join(tmpdir(), "histos-tombstone-events-"));
  const bus = createHistosEventBus();
  const seen = [];
  for (const eventType of ["on_entries_archived", "on_entries_restored", "on_entries_purged"]) {
    bus.add(eventType, (payload) => seen.push([eventType, payload]));
  }
  const engine = new HistosEngine({
    workspaceId: "workspace-1",
    databasePath: join(directory, "index.sqlite"),
    artifactsDir: join(directory, "artifacts"),
    eventBus: bus,
  });
  try {
    engine.archiveEntries("session_index", ["session-9"], "noisy index entry");
    const tombstone = engine.assertOpen().prepare("SELECT id FROM tombstones WHERE target_kind = 'session_index'").get();
    engine.restoreEntries([tombstone.id]);
    const artifactSha = "a".repeat(64);
    engine.assertOpen().prepare(
      "INSERT INTO artifacts (sha256, kind, created_at, source_set_json, lens, granularity) VALUES (?, 'graph_revision', ?, '{}', 'structural', 'entry')",
    ).run(artifactSha, Date.now());
    engine.purgeEntries("artifact", [artifactSha]);
    assert.deepEqual(seen.map(([eventType]) => eventType), ["on_entries_archived", "on_entries_restored", "on_entries_purged"]);
    assert.deepEqual(seen[0][1].targets, ["session-9"]);
    assert.equal(seen[1][1].count, 1);
    assert.equal(seen[2][1].targetKind, "artifact");
  } finally {
    engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
