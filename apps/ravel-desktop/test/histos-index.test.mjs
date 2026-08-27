import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import {
  addressIdForFactAddress,
  canonicalFactAddress,
  normalizeFactAddress,
} from "../electron/histos-address.js";
import { chunkText, chunkFactAddress } from "../electron/histos-chunker.js";
import {
  HISTOS_INDEXES,
  HISTOS_TABLES,
  initializeHistosSchema,
  validateHistosSchema,
} from "../electron/histos-schema.js";
import {
  artifactHashOf,
  hydrateArtifact,
  insertAddress,
  insertEvidence,
  insertRevisionParents,
  readArtifact,
  validateArtifact,
  writeArtifact,
} from "../electron/histos-provenance.js";
import { HistosEngine } from "../electron/histos-engine.js";

const SHA1 = "0123456789abcdef0123456789abcdef01234567";
const SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function address(overrides = {}) {
  return {
    sourceType: "session_entry",
    objectId: "session-1/entry-1",
    revisionId: "entry-1",
    ...overrides,
  };
}

function assertInvalid(action, pattern) {
  assert.throws(action, (error) => pattern.test(error.message));
}

function contextArtifact() {
  return {
    schemaVersion: 1,
    workspaceId: "workspace-1",
    kind: "context_set",
    sourceSet: { query: "important", selected: ["entry-1"] },
    lens: "semantic",
    granularity: "entry",
    selection: [{ revisionId: "node-revision-1", role: "quotes", address: address() }],
    evidence: [{ revisionId: "node-revision-1", role: "quotes", address: address() }],
    parents: [],
  };
}

test("FactAddress canonical keys, selectors, file paths, and hash rules", () => {
  const first = address({ selector: { kind: "span", start: 3, length: 4 } });
  const reordered = {
    revisionId: "entry-1",
    selector: { length: 4, start: 3, kind: "span" },
    objectId: "session-1/entry-1",
    sourceType: "session_entry",
  };
  assert.equal(canonicalFactAddress(first), canonicalFactAddress(reordered));
  assert.equal(addressIdForFactAddress(first), addressIdForFactAddress(reordered));

  assertInvalid(() => normalizeFactAddress(address({ selector: { kind: "unknown" } })), /unsupported selector kind/);
  assertInvalid(() => normalizeFactAddress(address({ selector: { kind: "span", start: 0, length: 1, extra: true } })), /unknown field/);
  assertInvalid(() => normalizeFactAddress(address({ selector: { kind: "hunk", startLine: 4, endLine: 3 } })), /selector.endLine/);
  assertInvalid(() => normalizeFactAddress(address({ selector: { kind: "json_path", path: "name" } })), /JSON path/);
  assertInvalid(() => normalizeFactAddress(address({ selector: { kind: "node", nodeRevisionId: "" } })), /bounded non-empty/);

  assert.deepEqual(normalizeFactAddress(address({ sourceType: "file", objectId: "workspace-1/src/index.js", revisionId: "working-tree" })), {
    sourceType: "file",
    objectId: "workspace-1/src/index.js",
    revisionId: "working-tree",
  });
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "file", objectId: "workspace-1/../outside.txt", revisionId: "working-tree" })), /workspace-relative/);
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "file", objectId: "workspace-1//outside.txt", revisionId: "working-tree" })), /workspace-relative/);
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "file", objectId: "workspace-1/C:/outside.txt", revisionId: "working-tree" })), /workspace-relative/);

  assert.deepEqual(normalizeFactAddress(address({ sourceType: "checkpoint", objectId: "repo", revisionId: SHA1 })).revisionId, SHA1);
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "checkpoint", objectId: "repo", revisionId: SHA256 })), /Git SHA/);
  assert.deepEqual(normalizeFactAddress(address({ sourceType: "graph_revision", objectId: "graph", revisionId: SHA256 })).revisionId, SHA256);
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "graph_revision", objectId: "graph", revisionId: SHA1 })), /SHA-256/);
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "flow_revision", objectId: "flow", revisionId: SHA1 })), /SHA-256/);
  assertInvalid(() => normalizeFactAddress(address({ sourceType: "context_set", objectId: "workspace-1", revisionId: SHA256.toUpperCase() })), /SHA-256/);
});

test("UTF-8 chunking uses byte offsets without splitting code points", () => {
  const text = "A😀中Bé";
  const chunks = chunkText(text, { maxBytes: 5 });
  assert.deepEqual(chunks.map(({ text: value, start, length }) => ({ text: value, start, length })), [
    { text: "A😀", start: 0, length: 5 },
    { text: "中B", start: 5, length: 4 },
    { text: "é", start: 9, length: 2 },
  ]);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text);
  assert.equal(chunks.at(-1).start + chunks.at(-1).length, Buffer.byteLength(text));
  assert.throws(() => chunkText("😀", 3), /smaller than a UTF-8 code point/);

  const derived = chunkFactAddress(address(), text, 5);
  assert.deepEqual(derived.map((chunk) => chunk.address.selector), chunks.map((chunk) => ({ kind: "span", start: chunk.start, length: chunk.length })));
  assertInvalid(() => chunkFactAddress({ ...address(), selector: { kind: "span", start: 0, length: 1 } }, text, 5), /must not already contain a selector/);
});

test("DatabaseSync Histos schema initializes and validates", () => {
  const database = new DatabaseSync(":memory:");
  try {
    initializeHistosSchema(database, "workspace-1");
    const metadata = validateHistosSchema(database, "workspace-1");
    assert.equal(metadata.schema_version, "2");
    assert.equal(metadata.workspace_id, "workspace-1");
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name), [...HISTOS_TABLES].sort());
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name), [...HISTOS_INDEXES].sort());

    database.prepare("UPDATE meta SET value = ? WHERE key = 'workspace_id'").run("other-workspace");
    assert.throws(() => validateHistosSchema(database, "workspace-1"), /workspace_id does not match/);
  } finally {
    database.close();
  }
});

test("evidence stores many revisions and roles for one FactAddress", () => {
  const database = new DatabaseSync(":memory:");
  try {
    initializeHistosSchema(database, "workspace-1");
    const addressId = insertAddress(database, address());
    assert.equal(insertEvidence(database, [
      { revisionId: "revision-a", addressId, role: "supports" },
      { revisionId: "revision-a", addressId, role: "quotes" },
      { revisionId: "revision-b", addressId, role: "supports" },
    ]), 3);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM addresses").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evidence").get().count, 3);
    assert.equal(insertEvidence(database, { revisionId: "revision-a", addressId, role: "supports" }), 0);
    assertInvalid(() => insertEvidence(database, { revisionId: "revision-c", addressId: SHA256, role: "supports" }), /not indexed/);
  } finally {
    database.close();
  }
});

test("revision parent links reject self-links and cycles", () => {
  const database = new DatabaseSync(":memory:");
  try {
    initializeHistosSchema(database, "workspace-1");
    assert.equal(insertRevisionParents(database, "revision-b", ["revision-a"]), 1);
    assert.equal(insertRevisionParents(database, "revision-c", ["revision-b"]), 1);
    assertInvalid(() => insertRevisionParents(database, "revision-a", ["revision-c"]), /cycle/);
    assertInvalid(() => insertRevisionParents(database, "revision-a", ["revision-a"]), /self-link/);
  } finally {
    database.close();
  }
});

test("context_set artifact hash is written atomically, read, hydrated, and rejects tampering", async (t) => {
  const root = await fs.mkdtemp(join(os.tmpdir(), "ravel-histos-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const artifactsDir = join(root, "artifacts");
  const artifact = contextArtifact();
  const expectedHash = artifactHashOf(artifact, { workspaceId: "workspace-1", kind: "context_set" });
  assert.equal(await writeArtifact(artifactsDir, artifact, { workspaceId: "workspace-1", kind: "context_set" }), expectedHash);
  assert.equal(await writeArtifact(artifactsDir, artifact, { workspaceId: "workspace-1", kind: "context_set" }), expectedHash);
  assert.deepEqual(await fs.readdir(artifactsDir), [`${expectedHash}.json`]);

  const read = await readArtifact(artifactsDir, expectedHash, { workspaceId: "workspace-1", kind: "context_set" });
  assert.equal(read.kind, "context_set");
  assert.deepEqual(read.selection[0].address, artifact.selection[0].address);
  assert.equal(read.evidence[0].addressId, addressIdForFactAddress(read.evidence[0].address));

  const databasePath = join(root, "histos.sqlite");
  const database = new DatabaseSync(databasePath);
  initializeHistosSchema(database, "workspace-1");
  const hydrated = await hydrateArtifact(database, artifactsDir, expectedHash, { workspaceId: "workspace-1", kind: "context_set" });
  assert.equal(hydrated.sha256, expectedHash);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sha256 = ?").get(expectedHash).count, 1);
  database.close();
  await fs.rm(databasePath, { force: true });
  assert.equal((await readArtifact(artifactsDir, expectedHash, { workspaceId: "workspace-1", kind: "context_set" })).kind, "context_set");

  await fs.writeFile(join(artifactsDir, `${expectedHash}.json`), Buffer.from("tampered", "utf8"));
  await assert.rejects(() => readArtifact(artifactsDir, expectedHash), { code: "integrity_error" });
});

test("HistosEngine rebuilds JSONL deterministically with trace anchors and spans", async (t) => {
  const root = await fs.mkdtemp(join(os.tmpdir(), "ravel-histos-engine-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const sessionFile = join(root, "session.jsonl");
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session", version: 3, id: "session-engine", cwd: root }),
    JSON.stringify({ type: "message", id: "entry-user", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "inspect" } }),
    JSON.stringify({ type: "message", id: "entry-assistant", parentId: "entry-user", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "call-engine", name: "read", arguments: { path: "README.md" } }] } }),
    JSON.stringify({ type: "message", id: "entry-tool", parentId: "entry-assistant", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "toolResult", toolCallId: "call-engine", content: [{ type: "text", text: "done" }], isError: false } }),
  ].join("\n") + "\n");
  const databasePath = join(root, "index.sqlite");
  const artifactsDir = join(root, "artifacts");
  const options = { workspaceId: "workspace-engine", databasePath, artifactsDir, sessionFiles: [sessionFile] };
  const first = new HistosEngine(options);
  t.after(() => first.close());
  await first.rebuild({ granularity: "entry" });
  const query = { sourceSet: { sessionIds: ["session-engine"] }, lens: "structural", granularity: "entry" };
  const graph = first.getGraph(query);
  const entry = graph.nodes.find((node) => node.nodeId === "entry:session-engine/entry-user");
  const tool = graph.nodes.find((node) => node.nodeId === "tool:session-engine/call-engine");
  assert.deepEqual(entry?.anchor, { sessionId: "session-engine", entryId: "entry-user" });
  assert.deepEqual(tool?.anchor, { sessionId: "session-engine", toolCallId: "call-engine", assistantEntryId: "entry-assistant", resultEntryId: "entry-tool" });
  assert.ok(graph.evidence.length > 0);
  const database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM spans").get().count > 0, true);
  database.close();

  first.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.rm(databasePath, { force: true });
      break;
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt === 99) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const second = new HistosEngine(options);
  t.after(() => second.close());
  await second.rebuild({ granularity: "entry" });
  const rebuiltGraph = second.getGraph(query);
  second.close();
  assert.deepEqual(rebuiltGraph, graph);
});

test("context_set validation requires valid selected evidence", () => {
  const artifact = contextArtifact();
  assert.equal(validateArtifact(artifact, { workspaceId: "workspace-1", kind: "context_set" }).kind, "context_set");
  assertInvalid(() => validateArtifact({ ...artifact, selection: [{ revisionId: "r", role: "quotes", address: address({ revisionId: "" }) }] }, { workspaceId: "workspace-1", kind: "context_set" }), /bounded non-empty/);
});
