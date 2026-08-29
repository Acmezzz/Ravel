import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HistosEngine } from "../electron/histos-engine.js";

// Each engine owns a private temp workspace torn down with the test, so a
// failing assertion can never leak a locked SQLite handle into the next one.
async function tempEngine(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ravel-histos-web-${label}-`));
  const engine = new HistosEngine({
    workspaceId: `workspace-${label}`,
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
  });
  t.after(async () => {
    engine.close();
    await rm(root, { recursive: true, force: true });
  });
  const query = (sql) => {
    const db = new DatabaseSync(join(root, "index.sqlite"));
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };
  return { engine, root, query };
}

function fakeResponse(body, { status = 200, contentType = "text/html" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

function fakeFetch(map) {
  return async (url) => {
    const entry = map[url];
    if (!entry) return fakeResponse("", { status: 404 });
    return fakeResponse(entry, { contentType: "text/html" });
  };
}

const PAGE = "<html><head><title>Docs</title></head><body><p>alpha beta gamma</p></body></html>";

test("applyWebResources indexes a fetched page and its evidence address", async (t) => {
  const { engine, query } = await tempEngine(t, "index");
  const result = await engine.applyWebResources({
    urls: ["https://example.com/docs"],
    fetchImpl: fakeFetch({ "https://example.com/docs": PAGE }),
  });
  assert.equal(result.nodeCount, 1);
  assert.deepEqual(result.diagnostics, []);

  const nodes = query("SELECT node_id, node_revision_id, kind, title FROM node_revisions WHERE kind != 'agent_spec'");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, "web_resource");
  assert.equal(nodes[0].node_id, "web:example.com/docs");
  assert.equal(nodes[0].title, "Docs");

  // Spatial traceability: the node is backed by an address we can navigate to.
  const addresses = query("SELECT source_type, object_id, revision_id FROM addresses WHERE source_type = 'web_resource'");
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].source_type, "web_resource");
  assert.equal(addresses[0].object_id, "example.com/docs");
  assert.match(addresses[0].revision_id, /^[0-9a-f]{64}$/);

  const evidence = query("SELECT revision_id, address_id, role FROM evidence WHERE address_id IN (SELECT address_id FROM addresses WHERE source_type = 'web_resource')");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].revision_id, nodes[0].node_revision_id);
  assert.equal(evidence[0].role, "produces");
});

test("applying the same page twice is a no-op", async (t) => {
  const { engine, query } = await tempEngine(t, "idempotent");
  const input = { urls: ["https://example.com/docs"], fetchImpl: fakeFetch({ "https://example.com/docs": PAGE }) };
  const first = await engine.applyWebResources(input);
  const second = await engine.applyWebResources(input);
  assert.equal(first.nodeCount, second.nodeCount);
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE kind != 'agent_spec'")[0].n, 1);
  assert.equal(query("SELECT COUNT(*) AS n FROM revision_parents")[0].n, 0);
});

test("a changed page becomes a new revision chained to the previous one", async (t) => {
  const { engine, query } = await tempEngine(t, "revised");
  const url = "https://example.com/docs";
  const first = await engine.applyWebResources({ urls: [url], fetchImpl: fakeFetch({ [url]: PAGE }) });
  const second = await engine.applyWebResources({
    urls: [url],
    fetchImpl: fakeFetch({ [url]: PAGE.replace("gamma", "delta") }),
  });
  assert.equal(first.nodeCount, 1);
  assert.equal(second.nodeCount, 1);

  const nodes = query("SELECT node_id, node_revision_id FROM node_revisions WHERE kind != 'agent_spec' ORDER BY created_at");
  assert.equal(nodes.length, 2);
  // Same page…
  assert.equal(nodes[0].node_id, nodes[1].node_id);
  // …two revisions, and the newer one remembers the older.
  assert.notEqual(nodes[0].node_revision_id, nodes[1].node_revision_id);
  const parents = query("SELECT child_id, parent_id FROM revision_parents");
  assert.equal(parents.length, 1);
  assert.equal(parents[0].parent_id, nodes[0].node_revision_id);
});

test("a batch carrying two readings of one URL keeps both revisions", async (t) => {
  const { engine, query } = await tempEngine(t, "batch");
  const result = await engine.applyWebResources({
    resources: [
      { url: "https://example.com/docs", objectId: "example.com/docs", text: "first reading" },
      { url: "https://example.com/docs", objectId: "example.com/docs", text: "second reading" },
    ],
  });
  assert.equal(result.diagnostics[0]?.code, "content_changed");
  const nodes = query("SELECT node_id, node_revision_id FROM node_revisions WHERE kind != 'agent_spec'");
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].node_id, nodes[1].node_id);
  assert.notEqual(nodes[0].node_revision_id, nodes[1].node_revision_id);
});

test("span granularity stores chunk nodes with byte-range evidence", async (t) => {
  const { engine, query } = await tempEngine(t, "spans");
  await engine.applyWebResources({
    urls: ["https://example.com/long"],
    granularity: "span",
    chunkLength: 256,
    fetchImpl: fakeFetch({ "https://example.com/long": `<p>${"word ".repeat(200)}</p>` }),
  });
  assert.ok(query("SELECT node_id FROM node_revisions WHERE kind = 'web_chunk'").length > 1);
  const selectors = query("SELECT selector_json FROM addresses WHERE selector_json IS NOT NULL");
  assert.ok(selectors.length > 1);
  for (const row of selectors) assert.equal(JSON.parse(row.selector_json).kind, "span");
});

test("one unreachable URL is reported as a diagnostic, not a batch failure", async (t) => {
  const { engine, query } = await tempEngine(t, "partial");
  const result = await engine.applyWebResources({
    urls: ["https://example.com/missing", "https://example.com/docs"],
    fetchImpl: fakeFetch({ "https://example.com/docs": PAGE }),
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "fetch_status");
  assert.equal(result.nodeCount, 1);
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE kind != 'agent_spec'")[0].n, 1);
});

test("every URL failing leaves the index untouched", async (t) => {
  const { engine, query } = await tempEngine(t, "allbad");
  const result = await engine.applyWebResources({ urls: ["https://example.com/missing"], fetchImpl: fakeFetch({}) });
  assert.equal(result.nodeCount, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(query("SELECT COUNT(*) AS n FROM node_revisions WHERE kind != 'agent_spec'")[0].n, 0);
});

test("applyWebResources indexes resources that were fetched elsewhere", async (t) => {
  const { engine, query } = await tempEngine(t, "preseeded");
  const result = await engine.applyWebResources({
    resources: [{ url: "https://example.com/docs", objectId: "example.com/docs", text: "plain body", fetchedAt: 1_700_000_000_000 }],
  });
  assert.equal(result.nodeCount, 1);
  // The original fetch time is preserved rather than replaced with "now".
  assert.equal(query("SELECT created_at FROM node_revisions WHERE kind = 'web_resource'")[0].created_at, 1_700_000_000_000);
});
