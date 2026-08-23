import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isExtensionUIRequest, isExtensionUIResponse } from "../electron/extension-ui-protocol.js";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

const meta = { sessionId: "session-1", runId: "run-1", generation: 4 };

test("extension UI protocol validates interactive requests and metadata", () => {
  assert.equal(isExtensionUIRequest({ type: "extension_ui_request", id: "r1", method: "select", title: "Pick", options: ["a", "b"], ...meta }), true);
  assert.equal(isExtensionUIRequest({ type: "extension_ui_request", id: "r2", method: "confirm", title: "Confirm", message: "Continue?", ...meta }), true);
  assert.equal(isExtensionUIRequest({ type: "extension_ui_request", id: "r3", method: "input", title: "Name", placeholder: "name", ...meta }), true);
  assert.equal(isExtensionUIRequest({ type: "extension_ui_request", id: "r4", method: "editor", title: "Edit", prefill: "text", ...meta }), true);
  assert.equal(isExtensionUIRequest({ type: "extension_ui_request", id: "r5", method: "select", title: "Pick", options: ["a"], sessionId: "session-1", runId: "run-1", generation: -1 }), false);
});

test("extension UI protocol validates responses and rejects stale-shaped payloads", () => {
  assert.equal(isExtensionUIResponse({ type: "extension_ui_response", id: "r1", value: "a", ...meta }), true);
  assert.equal(isExtensionUIResponse({ type: "extension_ui_response", id: "r2", confirmed: true, ...meta }), true);
  assert.equal(isExtensionUIResponse({ type: "extension_ui_response", id: "r3", cancelled: true, ...meta }), true);
  assert.equal(isExtensionUIResponse({ type: "extension_ui_response", id: "r3", value: "a", sessionId: "other", runId: "run-1", generation: 4 }), true);
  assert.equal(isExtensionUIResponse({ type: "extension_ui_response", id: "r4", value: "a", sessionId: "session-1", runId: "run-1" }), false);
});

test("extension UI bridge is bound in the worker and isolated behind IPC", async () => {
  const worker = await read("../electron/worker.mjs");
  const main = await read("../electron/main.js");
  const preload = await read("../electron/preload.js");
  const host = await read("../electron/worker-host.js");
  const app = await read("../src/renderer/components/layout/ExtensionUIHost.tsx");
  assert.match(worker, /bindSession\(session\)/);
  assert.match(worker, /toolCallGuard/);
  assert.match(worker, /pendingExtensionUI/);
  assert.match(worker, /stale extension UI response/);
  assert.match(host, /onExtensionUIRequest/);
  assert.match(main, /extension-ui:request/);
  assert.match(main, /senderAllowed/);
  assert.match(preload, /onExtensionUiRequest/);
  assert.match(preload, /omega:extensionUiResponse/);
  assert.match(app, /Dialog/);
  assert.match(app, /Snackbar/);
  assert.match(app, /setWidget/);
  assert.match(app, /set_editor_text/);
});
