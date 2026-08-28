import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  histosFactAddress,
  histosFreezeContextRequest,
  histosGetArtifactRequest,
  histosGetGraphRequest,
  histosGetViewStateRequest,
  histosGetNodeRequest,
  histosQueryRequest,
  histosRebuildRequest,
} from "../electron/ipc-schemas.js";
import {
  diffChannelSets,
  extractInvokeChannels,
  INVOKE_CHANNELS,
  uniqueSorted,
} from "../electron/ipc-registry.js";

const SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const QUERY = Object.freeze({
  sourceSet: { kind: "session_entry" },
  lens: "semantic",
  granularity: "entry",
});

function validRequest(normalizer) {
  if (normalizer === histosGetNodeRequest) return { ...QUERY, nodeId: "node-1" };
  if (normalizer === histosFreezeContextRequest) return { ...QUERY, selection: ["node-1"] };
  if (normalizer === histosGetArtifactRequest) return { ...QUERY, sha256: SHA256 };
  return QUERY;
}

function assertSafeDto(value, location = "dto") {
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.doesNotMatch(
      key,
      /^(?:sqlite|rawSql|rawSQL|databasePath|dbPath|sessionsRoot|workspaceRoot|absolutePath|rawQuery)$/i,
      `${location}.${key} is a private implementation field`,
    );
    if (typeof item === "string") {
      assert.doesNotMatch(item, /^(?:[A-Za-z]:[\\/]|[\\]{2}|\/)/, `${location}.${key} must not be an absolute path`);
    } else {
      assertSafeDto(item, `${location}.${key}`);
    }
  }
}

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Histos query schemas reject every missing query dimension", () => {
  const normalizers = [
    histosQueryRequest,
    histosGetGraphRequest,
    histosRebuildRequest,
    histosGetNodeRequest,
    histosFreezeContextRequest,
    histosGetArtifactRequest,
    histosGetViewStateRequest,
  ];
  for (const normalizer of normalizers) {
    for (const field of ["sourceSet", "lens", "granularity"]) {
      const request = { ...validRequest(normalizer) };
      delete request[field];
      assert.equal(normalizer(request), null, `${normalizer.name} must require ${field}`);
    }
  }
});

test("FactAddress rejects invalid selectors, file paths, and hashes", () => {
  const address = {
    sourceType: "session_entry",
    objectId: "session-1/entry-1",
    revisionId: "entry-1",
  };
  for (const selector of [
    { kind: "unknown" },
    { kind: "span", start: -1, length: 1 },
    { kind: "span", start: 0, length: 0 },
    { kind: "hunk", startLine: 4, endLine: 3 },
    { kind: "node", nodeRevisionId: "" },
  ]) {
    assert.equal(histosFactAddress({ ...address, selector }), null, `selector ${selector.kind} must be rejected`);
  }
  for (const objectId of [
    "workspace-1/../outside.txt",
    "../outside.txt",
    "C:/outside.txt",
  ]) {
    assert.equal(histosFactAddress({ ...address, sourceType: "file", objectId, revisionId: "working-tree" }), null, `${objectId} must be rejected`);
  }
  for (const sha256 of ["", "not-a-hash", SHA256.toUpperCase(), "0".repeat(63)]) {
    assert.equal(histosGetArtifactRequest({ ...QUERY, sha256 }), null, `${sha256 || "empty hash"} must be rejected`);
  }
});

test("freeze context selection is bounded at 2,000 entries", () => {
  const selection = Array.from({ length: 2_000 }, (_, index) => ({ id: `node-${index}` }));
  const normalized = histosFreezeContextRequest({ ...QUERY, selection });
  assert.ok(normalized);
  assert.equal(normalized.selection.length, 2_000);
  assert.equal(histosFreezeContextRequest({ ...QUERY, selection: [...selection, { id: "too-many" }] }), null);
  assert.equal(histosFreezeContextRequest({ ...QUERY, selection: [] }), null);
});

test("rebuild normalization drops or rejects renderer path injection", () => {
  const normalized = histosRebuildRequest({
    ...QUERY,
    maxFiles: 7,
    sessionsRoot: "/attacker/sessions",
    workspaceRoot: "C:\\attacker\\workspace",
    path: "/attacker/index.sqlite",
  });
  assert.ok(
    normalized === null || JSON.stringify(normalized) === JSON.stringify({ ...QUERY, maxFiles: 7 }),
    "rebuild must reject injected paths or return only its public query fields",
  );
  if (normalized) {
    assert.equal("sessionsRoot" in normalized, false);
    assert.equal("workspaceRoot" in normalized, false);
    assert.equal("path" in normalized, false);
  }
});

test("all normalized Histos DTOs contain no private storage or absolute-path fields", () => {
  const values = [
    histosQueryRequest(QUERY),
    histosGetGraphRequest(QUERY),
    histosRebuildRequest(QUERY),
    histosGetNodeRequest({ ...QUERY, nodeId: "node-1" }),
    histosFreezeContextRequest({ ...QUERY, selection: ["node-1"] }),
    histosGetArtifactRequest({ ...QUERY, sha256: SHA256 }),
    histosFactAddress({ sourceType: "file", objectId: "workspace-1/src/index.js", revisionId: "working-tree" }),
  ];
  for (const value of values) assertSafeDto(value);
});

test("Histos channels are present in the registry and preload invokes", async () => {
  const expected = [
    "omega:histosGetGraph",
    "omega:histosCondenseGraph",
    "omega:histosSaveViewState",
    "omega:histosGetViewState",
    "omega:histosExecuteFlow",
    "omega:histosRebuild",
    "omega:histosGetNode",
    "omega:histosFreezeContext",
    "omega:histosConvertToFlow",
    "omega:histosGetArtifact",
    "omega:histosDistillResource",
    "omega:histosSuggestContext",
    "omega:histosImportContext",
  ];
  const registered = INVOKE_CHANNELS.filter((channel) => channel.startsWith("omega:histos"));
  const preload = await readSource("../electron/preload.js");
  const invoked = uniqueSorted(extractInvokeChannels(preload).filter((channel) => channel.startsWith("omega:histos")));
  assert.deepEqual(registered, expected);
  assert.equal(registered.length, 13);
  assert.deepEqual(diffChannelSets(expected, invoked), { missing: [], extra: [] });
});

test("preload and schema sources expose no private Histos DTO fields", async () => {
  const preload = await readSource("../electron/preload.js");
  const schemas = await readSource("../electron/ipc-schemas.js");
  const registry = await readSource("../electron/ipc-registry.js");
  const source = `${schemas}\n${preload}\n${registry}`;
  assert.doesNotMatch(source, /\b(?:sqlite|rawSql|rawSQL|databasePath|dbPath|sessionsRoot|workspaceRoot|absolutePath|rawQuery)\b/i);
  assert.doesNotMatch(source, /(?:ipcRenderer\.invoke|return)\([^)]*\b(?:sqlite|rawSql|databasePath|dbPath|sessionsRoot|workspaceRoot|absolutePath)\b/i);
});
