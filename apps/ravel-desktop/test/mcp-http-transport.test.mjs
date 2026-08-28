import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { HttpPeer, resolveHeaderValues } from "../../../.pi/extensions/ravel-mcp-bridge/transport.ts";

test("resolveHeaderValues resolves $cred refs from the injected vault and fails closed", () => {
  globalThis.__ravelMcpCredentials = { "mcp:github": "tok-123" };
  try {
    assert.deepEqual(resolveHeaderValues({ Authorization: "$cred:mcp:github", "X-Plain": "v" }), { Authorization: "tok-123", "X-Plain": "v" });
    assert.throws(() => resolveHeaderValues({ Authorization: "$cred:mcp:missing" }), (error) => error.code === "credential_missing");
  } finally {
    delete globalThis.__ravelMcpCredentials;
  }
});

function startServer(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("HttpPeer completes initialize/tools-list over JSON and SSE responses with session and auth headers", async (t) => {
  const seen = [];
  let sessionId = "";
  const server = await startServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body);
      seen.push({ url: req.url, auth: req.headers.authorization, session: req.headers["mcp-session-id"] ?? null, method: message.method });
      if (message.method === "initialize") {
        sessionId = "sess-1";
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": sessionId });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05" } }));
        return;
      }
      if (req.headers["mcp-session-id"] !== sessionId) {
        res.writeHead(400).end("missing session");
        return;
      }
      if (req.headers.authorization !== "tok-123") {
        res.writeHead(401).end("bad auth");
        return;
      }
      if (message.method === "tools/list") {
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": sessionId });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo" }] } })}\n\n`);
        return;
      }
      res.writeHead(500).end("unexpected");
    });
  });
  t.after(() => server.close());

  globalThis.__ravelMcpCredentials = { "mcp:tok": "tok-123" };
  const peer = new HttpPeer(`http://127.0.0.1:${server.address().port}/mcp`, { Authorization: "$cred:mcp:tok" }, () => {});
  try {
    const init = await peer.request("initialize", { protocolVersion: "2024-11-05" }, 5_000);
    assert.equal(init.protocolVersion, "2024-11-05");
    const listing = await peer.request("tools/list", {}, 5_000);
    assert.equal(listing.tools[0].name, "echo");
  } finally {
    peer.stop();
    delete globalThis.__ravelMcpCredentials;
  }
  assert.equal(seen[1].session, "sess-1", "session id must round-trip after initialize");
  assert.equal(seen[1].auth, "tok-123", "vault-resolved bearer token must reach the wire");
});

test("HttpPeer surfaces RPC errors and HTTP failures honestly", async (t) => {
  const server = await startServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body);
      if (message.method === "boom") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { message: "server exploded" } }));
      } else if (message.method === "nosse") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("event: ping\ndata: {\"unrelated\":true}\n\n");
      } else {
        res.writeHead(503).end();
      }
    });
  });
  t.after(() => server.close());

  const peer = new HttpPeer(`http://127.0.0.1:${server.address().port}/mcp`, {}, () => {});
  try {
    await assert.rejects(() => peer.request("boom", {}, 5_000), /server exploded/);
    await assert.rejects(() => peer.request("nosse", {}, 5_000), /no matching message/);
    await assert.rejects(() => peer.request("down", {}, 5_000), /HTTP 503/);
    peer.stop();
    await assert.rejects(() => peer.request("down", {}, 5_000), /closed/);
  } finally {
    peer.stop();
  }
});
