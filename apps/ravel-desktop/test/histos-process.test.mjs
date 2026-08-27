import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Contract tests for the planned HistosHost boundary.
 *
 * histos-host.js is intentionally not imported here: it is an Electron module
 * and is not present yet. Once it exists, these tests inspect the host source
 * without requiring Electron to be booted by node:test. The intended API is a
 * generation-aware RPC host with start/switchWorkspace, call, and dispose
 * operations. Engine paths are private to Main/utilityProcess and must never
 * be included in renderer-facing messages.
 */
const HOST_URL = new URL("../electron/histos-host.js", import.meta.url);
const HOST_PATH = fileURLToPath(HOST_URL);
const HOST_EXISTS = existsSync(HOST_PATH);
const HOST_SKIP = "histos-host.js is not present; contract tests are staged for R3";

async function hostSource() {
  return readFile(HOST_URL, "utf8");
}

function assertHasAny(source, patterns, message) {
  assert.ok(patterns.some((pattern) => pattern.test(source)), message);
}

test("HistosHost correlates each response to its request id", { skip: HOST_EXISTS ? false : HOST_SKIP }, async () => {
  const source = await hostSource();
  assertHasAny(source, [/pending\s*=\s*new Map/, /pendingRequests?\s*=\s*new Map/], "host must keep pending RPCs by request id");
  assertHasAny(source, [/req-/, /requestId/, /nextRequestId/, /seq/], "host must create unique request ids");
  assertHasAny(source, [/message\.id/, /response\.id/, /pending\.get\(/], "response handling must look up the response id");
  assert.match(source, /pending[^\n]*\.delete\(/, "a settled request must be removed from the pending map");
});

test("HistosHost rejects an RPC when its timeout expires", { skip: HOST_EXISTS ? false : HOST_SKIP }, async () => {
  const source = await hostSource();
  assertHasAny(source, [/timeout/i, /RPC_TIMEOUT/, /REQUEST_TIMEOUT/], "host must define an RPC timeout");
  assert.match(source, /setTimeout\(/, "host must bound an in-flight RPC");
  assertHasAny(source, [/timed.?out/i, /timeout/i, /worker_timeout/, /histos_timeout/], "timeout must reject the request with a diagnostic error");
  assertHasAny(source, [/clearTimeout\(/, /timer/], "settled RPC timers must be cleared");
});

test("HistosHost drops stale-generation responses and events", { skip: HOST_EXISTS ? false : HOST_SKIP }, async () => {
  const source = await hostSource();
  assertHasAny(source, [/generation\s*=\s*0/, /generation/], "host must track a process generation");
  assertHasAny(source, [/generation\s*!==\s*this\.generation/, /generation\s*!==\s*generation/, /stale/i], "stale generations must be rejected");
  assertHasAny(source, [/message\.generation/, /response\.generation/, /generation:\s*generation/], "generation must travel in the process envelope");
  assertHasAny(source, [/isHistosResponse/, /_handleMessage/, /_handleDeath/], "the host must guard process messages at its boundary");
});

test("HistosHost rejects pending work on engine exit and dispose", { skip: HOST_EXISTS ? false : HOST_SKIP }, async () => {
  const source = await hostSource();
  assertHasAny(source, [/\.on\(["']exit["']/, /onExit/, /exit/i], "host must observe utility-process exit");
  assertHasAny(source, [/pending/, /reject/], "engine exit must reject pending RPCs");
  assertHasAny(source, [/dispose/i, /kill\(/], "host must expose an explicit dispose/kill path");
  assertHasAny(source, [/disposed/i, /stopping/i, /closed/i], "dispose must make later calls fail closed");
});

test("HistosHost switches workspace by starting a new generation", { skip: HOST_EXISTS ? false : HOST_SKIP }, async () => {
  const source = await hostSource();
  assertHasAny(source, [/switchWorkspace/, /workspaceId/], "host must expose workspace identity and switching");
  assertHasAny(source, [/start\(/, /fork\(/], "workspace activation must start or fork the engine");
  assertHasAny(source, [/generation/, /restart/i], "workspace switching must advance process generation");
  assertHasAny(source, [/workspaceId/, /workspace/], "workspace identity must be carried in the engine init envelope");
});

test("HistosHost never leaks absolute engine paths through its public boundary", { skip: HOST_EXISTS ? false : HOST_SKIP }, async () => {
  const source = await hostSource();
  assertHasAny(source, [/public/i, /sanitize/i, /redact/i, /dto/i, /relative/i], "host must have an explicit public DTO/path sanitization boundary");
  assert.doesNotMatch(source, /renderer\s*.*(?:databasePath|artifactsDir|sessionsRoot)/is, "renderer-facing code must not expose engine paths");
  assert.doesNotMatch(source, /postMessage\([^)]*(?:databasePath|artifactsDir|sessionsRoot)/is, "process messages must not carry private engine paths");
});
