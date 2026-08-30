import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistosEngine } from "../electron/histos-engine.js";

/**
 * P0 time travel (T0.6): node/edge projections can be read at an arbitrary
 * instant. The web source adapter produces a real revision chain — fetching
 * the same URL with changed content links a new node revision to its parent
 * via `revision_parents`, which is exactly the DAG the asOf filter walks.
 */

async function tempEngine(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ravel-histos-asof-${label}-`));
  const engine = new HistosEngine({
    workspaceId: `workspace-${label}`,
    databasePath: join(root, "index.sqlite"),
    artifactsDir: join(root, "artifacts"),
  });
  t.after(async () => {
    engine.close();
    await rm(root, { recursive: true, force: true });
  });
  return { engine, root };
}

function fakeFetch(bodyByUrl) {
  return async (url) => {
    const body = bodyByUrl[url];
    if (!body) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
      text: async () => body,
    };
  };
}

const URL_DOCS = "https://example.com/docs";
const PAGE_V1 = "<html><head><title>Docs</title></head><body><p>version one</p></body></html>";
const PAGE_V2 = "<html><head><title>Docs</title></head><body><p>version two, rewritten</p></body></html>";

test("asOf returns the revision that was live at that instant and the current tip without it", async (t) => {
  const { engine } = await tempEngine(t, "graph");
  const query = { sourceSet: {}, lens: "structural", granularity: "entry" };

  await engine.applyWebResources({ urls: [URL_DOCS], fetchImpl: fakeFetch({ [URL_DOCS]: PAGE_V1 }) });
  const first = engine.getGraph(query);
  const v1 = first.nodes.find((node) => node.nodeId.startsWith("web:"));
  assert.ok(v1, "expected the v1 web node");

  // Force a strictly later timestamp so the two revisions are ordered.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await engine.applyWebResources({ urls: [URL_DOCS], fetchImpl: fakeFetch({ [URL_DOCS]: PAGE_V2 }) });

  const current = engine.getGraph(query);
  const versions = current.nodes.filter((node) => node.nodeId === v1.nodeId);
  assert.equal(versions.length, 2, "both revisions exist in the index");

  const between = versions.find((node) => node.nodeRevisionId === v1.nodeRevisionId);
  const atV1 = engine.getGraph({ ...query, asOf: between.createdAt });
  const asOfNodes = atV1.nodes.filter((node) => node.nodeId === v1.nodeId);
  assert.equal(asOfNodes.length, 1, "asOf collapses the chain to the live revision");
  assert.equal(asOfNodes[0].nodeRevisionId, v1.nodeRevisionId, "asOf at the v1 instant returns v1");

  const now = engine.getGraph({ ...query, asOf: Date.now() });
  const nowNodes = now.nodes.filter((node) => node.nodeId === v1.nodeId);
  assert.equal(nowNodes.length, 1);
  assert.notEqual(nowNodes[0].nodeRevisionId, v1.nodeRevisionId, "asOf now returns the newest revision, not v1");

  // A timestamp before any revision yields an empty projection.
  const before = engine.getGraph({ ...query, asOf: 0 });
  assert.equal(before.nodes.length, 0);
  assert.equal(before.asOf, 0);
});

test("getNode honours asOf and rejects a non-timestamp asOf", async (t) => {
  const { engine } = await tempEngine(t, "node");
  const query = { sourceSet: {}, lens: "structural", granularity: "entry" };
  await engine.applyWebResources({ urls: [URL_DOCS], fetchImpl: fakeFetch({ [URL_DOCS]: PAGE_V1 }) });
  const first = engine.getGraph(query).nodes.find((node) => node.nodeId.startsWith("web:"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await engine.applyWebResources({ urls: [URL_DOCS], fetchImpl: fakeFetch({ [URL_DOCS]: PAGE_V2 }) });

  const live = engine.getNode(first.nodeId, { ...query, asOf: first.createdAt });
  assert.equal(live.nodeRevisionId, first.nodeRevisionId);
  const future = engine.getNode(first.nodeId, { ...query, asOf: 0 });
  assert.equal(future, null, "no revision existed at asOf 0");
  assert.throws(() => engine.getNode(first.nodeId, { ...query, asOf: "yesterday" }), /asOf must be a finite timestamp/);
});
