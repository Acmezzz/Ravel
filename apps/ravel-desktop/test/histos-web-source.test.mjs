import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertWebUrl,
  chunkText,
  extractReadableText,
  extractTitle,
  fetchWebResource,
  isTextualContentType,
  normalizeWebUrl,
  projectWebGraph,
  webResourceAddress,
} from "../electron/histos-web-source.js";

const HTML = `<!doctype html>
<html>
  <head><title>Release notes</title>
    <style>body { color: red }</style>
    <script>console.log("never runs")</script>
  </head>
  <body>
    <h1>Version 2</h1>
    <!-- a comment that must disappear -->
    <p>First&nbsp;paragraph &amp; more.</p>
    <ul><li>added spans</li><li>fixed chunks</li></ul>
  </body>
</html>`;

test("normalizeWebUrl keeps query order stable and drops the fragment", () => {
  assert.equal(normalizeWebUrl("https://Example.com/a/?b=1&a=2#frag"), "example.com/a?a=2&b=1");
  assert.equal(normalizeWebUrl("https://example.com/a/?a=2&b=1"), "example.com/a?a=2&b=1");
});

test("normalizeWebUrl rejects anything that is not a safe absolute http(s) URL", () => {
  assert.equal(normalizeWebUrl("ftp://example.com/a"), null);
  assert.equal(normalizeWebUrl("javascript:alert(1)"), null);
  assert.equal(normalizeWebUrl("file:///etc/passwd"), null);
  assert.equal(normalizeWebUrl("https://user:pw@example.com/"), null);
  assert.equal(normalizeWebUrl("/relative/path"), null);
  assert.equal(normalizeWebUrl(""), null);
  assert.equal(normalizeWebUrl(null), null);
  assert.throws(() => assertWebUrl("ftp://example.com"), /absolute http\(s\) URL/);
});

test("extractReadableText strips scripts, styles and comments without running them", () => {
  const text = extractReadableText(HTML, "text/html");
  assert.equal(text.includes("never runs"), false);
  assert.equal(text.includes("color: red"), false);
  assert.equal(text.includes("must disappear"), false);
  assert.equal(text.includes("First paragraph & more."), true);
  assert.equal(text.includes("- added spans"), true);
});

test("extractReadableText passes plain text through unchanged", () => {
  assert.equal(extractReadableText("  keep\r\nthis  ", "text/plain"), "keep\nthis");
});

test("extractTitle prefers title then h1 then the fallback", () => {
  assert.equal(extractTitle(HTML, "fallback"), "Release notes");
  assert.equal(extractTitle("<html><body><h1>Only heading</h1></body></html>", "fallback"), "Only heading");
  assert.equal(extractTitle("<p>nothing</p>", "example.com/a"), "example.com/a");
});

test("isTextualContentType accepts text and rejects binary", () => {
  assert.equal(isTextualContentType("text/html; charset=utf-8"), true);
  assert.equal(isTextualContentType("application/json"), true);
  assert.equal(isTextualContentType(""), true);
  assert.equal(isTextualContentType("image/png"), false);
  assert.equal(isTextualContentType("application/octet-stream"), false);
});

test("chunkText covers the whole string exactly once", () => {
  const chunks = chunkText("a".repeat(1_000), 256);
  assert.deepEqual(chunks.map((chunk) => chunk.start), [0, 256, 512, 768]);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [256, 256, 256, 232]);
  assert.deepEqual(chunkText("", 256), []);
});

test("webResourceAddress is content addressed", () => {
  const first = webResourceAddress({ objectId: "example.com/a", text: "hello" });
  const second = webResourceAddress({ objectId: "example.com/a", text: "hello" });
  const third = webResourceAddress({ objectId: "example.com/a", text: "changed" });
  assert.equal(first.revisionId, second.revisionId);
  assert.notEqual(first.revisionId, third.revisionId);
  assert.equal(first.sourceType, "web_resource");
  assert.equal(first.objectId, "example.com/a");
});

test("projectWebGraph is deterministic across runs", () => {
  const resources = [{ url: "https://b.example/x", text: "b body" }, { url: "https://a.example/y", text: "a body" }];
  const first = projectWebGraph(resources, { granularity: "span", chunkLength: 4 });
  const second = projectWebGraph([...resources].reverse(), { granularity: "span", chunkLength: 4 });
  assert.deepEqual(first.nodes, second.nodes);
  assert.deepEqual(first.edges, second.edges);
});

test("projectWebGraph emits a page node plus chunk nodes only at span granularity", () => {
  const resource = { url: "https://example.com/a", text: "a".repeat(1_000) };
  const entry = projectWebGraph([resource], { granularity: "entry" });
  assert.equal(entry.nodes.length, 1);
  assert.equal(entry.nodes[0].kind, "web_resource");
  assert.equal(entry.edges.length, 0);

  const span = projectWebGraph([resource], { granularity: "span", chunkLength: 256 });
  assert.equal(span.nodes.length, 5);
  assert.equal(span.nodes.filter((node) => node.kind === "web_chunk").length, 4);
  assert.equal(span.edges.filter((edge) => edge.kind === "contains").length, 4);
  for (const edge of span.edges.filter((item) => item.kind === "contains")) {
    assert.equal(edge.evidence[0].address.selector.kind, "span");
  }
});

test("projectWebGraph keeps node identity stable while content changes the revision", () => {
  const stable = projectWebGraph([{ url: "https://example.com/a", text: "v1" }]);
  const changed = projectWebGraph([{ url: "https://example.com/a", text: "v2" }]);
  // The page is the same node across fetches…
  assert.equal(stable.nodes[0].nodeId, changed.nodes[0].nodeId);
  // …but each fetch is its own revision, so the old reading is never lost.
  assert.notEqual(stable.nodes[0].nodeRevisionId, changed.nodes[0].nodeRevisionId);
  assert.notEqual(stable.nodes[0].evidence[0].address.revisionId, changed.nodes[0].evidence[0].address.revisionId);
  assert.equal(stable.nodes[0].evidence[0].address.objectId, changed.nodes[0].evidence[0].address.objectId);
});

test("projectWebGraph derives link edges only from stored text", () => {
  const graph = projectWebGraph([
    { url: "https://a.example/one", text: "see b.example/two for details" },
    { url: "https://b.example/two", text: "standalone" },
  ]);
  const links = graph.edges.filter((edge) => edge.kind === "links_to");
  assert.equal(links.length, 1);
  assert.equal(links[0].srcNodeId, "web:a.example/one");
  assert.equal(links[0].dstNodeId, "web:b.example/two");
  assert.equal(links[0].evidence[0].role, "navigates");
});

test("projectWebGraph collapses an unchanged refetch and flags a changed one", () => {
  const resource = { url: "https://example.com/a", text: "same" };
  const unchanged = projectWebGraph([resource, { ...resource }]);
  assert.equal(unchanged.nodes.length, 1);
  assert.deepEqual(unchanged.diagnostics, []);

  const changed = projectWebGraph([resource, { ...resource, text: "edited" }]);
  assert.equal(changed.diagnostics[0].code, "content_changed");
  // A changed page contributes a second revision of the same node rather than
  // replacing the first one, so both readings survive in the same batch.
  assert.equal(changed.nodes.length, 2);
  assert.equal(changed.nodes[0].nodeId, changed.nodes[1].nodeId);
  assert.notEqual(changed.nodes[0].nodeRevisionId, changed.nodes[1].nodeRevisionId);
});

test("projectWebGraph records unaddressable sources as diagnostics instead of throwing", () => {
  const graph = projectWebGraph([{ url: "ftp://nope", text: "x" }]);
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.diagnostics[0].code, "invalid_url");
});

function fakeResponse(body, { status = 200, contentType = "text/html", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : headers[name] ?? null) },
    text: async () => body,
  };
}

test("fetchWebResource normalizes content and reports the content address", async () => {
  const resource = await fetchWebResource({
    url: "https://example.com/a#frag",
    fetchImpl: async () => fakeResponse(HTML),
    fetchedAt: 1_700_000_000_000,
  });
  assert.equal(resource.objectId, "example.com/a");
  assert.equal(resource.contentType, "text/html");
  assert.equal(resource.fetchedAt, 1_700_000_000_000);
  assert.equal(resource.text.includes("never runs"), false);
  assert.equal(resource.text.includes("Version 2"), true);
  assert.match(resource.contentSha256, /^[0-9a-f]{64}$/);
});

test("fetchWebResource follows redirects but refuses to leave http(s)", async () => {
  const seen = [];
  const resource = await fetchWebResource({
    url: "https://example.com/a",
    fetchImpl: async (url) => {
      seen.push(url);
      if (seen.length === 1) return fakeResponse("", { status: 302, headers: { location: "https://example.com/b" } });
      return fakeResponse("final", { contentType: "text/plain" });
    },
  });
  assert.deepEqual(seen, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(resource.finalUrl, "https://example.com/b");
  assert.equal(resource.text, "final");

  await assert.rejects(
    () =>
      fetchWebResource({
        url: "https://example.com/a",
        fetchImpl: async () => fakeResponse("", { status: 302, headers: { location: "file:///etc/passwd" } }),
      }),
    /non-http\(s\) URL/,
  );
});

test("fetchWebResource enforces the redirect cap", async () => {
  await assert.rejects(
    () =>
      fetchWebResource({
        url: "https://example.com/a",
        fetchImpl: async (url) => fakeResponse("", { status: 302, headers: { location: `${url}+` } }),
      }),
    /redirect limit/,
  );
});

test("fetchWebResource rejects binary content, error statuses and oversized bodies", async () => {
  await assert.rejects(
    () => fetchWebResource({ url: "https://example.com/a", fetchImpl: async () => fakeResponse("", { contentType: "image/png" }) }),
    /unsupported content type/,
  );
  await assert.rejects(
    () => fetchWebResource({ url: "https://example.com/a", fetchImpl: async () => fakeResponse("", { status: 404 }) }),
    /status 404/,
  );
  await assert.rejects(
    () => fetchWebResource({ url: "https://example.com/a", maxBytes: 4, fetchImpl: async () => fakeResponse("a".repeat(10), { contentType: "text/plain" }) }),
    /exceeds 4 bytes/,
  );
});

test("fetchWebResource surfaces transport failures with stable codes", async () => {
  await assert.rejects(
    () =>
      fetchWebResource({
        url: "https://example.com/a",
        fetchImpl: async () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        },
      }),
    (error) => error.code === "fetch_timeout",
  );
  // A transport that settles too slowly is raced by the timer rather than
  // trusted to honour the abort signal.
  await assert.rejects(
    () =>
      fetchWebResource({
        url: "https://example.com/a",
        timeoutMs: 5,
        fetchImpl: () => new Promise((resolve) => setTimeout(() => resolve(fakeResponse("too late")), 200)),
      }),
    (error) => error.code === "fetch_timeout",
  );
});

test("fetchWebResource wins the race when the transport is faster than the timeout", async () => {
  const resource = await fetchWebResource({
    url: "https://example.com/a",
    timeoutMs: 2_000,
    fetchImpl: () => new Promise((resolve) => setTimeout(() => resolve(fakeResponse("quick", { contentType: "text/plain" })), 5)),
  });
  assert.equal(resource.text, "quick");
});
