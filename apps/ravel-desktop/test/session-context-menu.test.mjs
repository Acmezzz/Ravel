import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Session Sidebar has a desktop context menu and safe parent-child deletion semantics", async () => {
  const source = await readFile(new URL("../src/renderer/components/sessions/SessionList.tsx", import.meta.url), "utf8");
  assert.match(source, /onContextMenu/);
  assert.match(source, /sessions\.menu\.copyId/);
  assert.match(source, /sessions\.menu\.rename/);
  assert.match(source, /sessions\.menu\.delete/);
  assert.match(source, /parentSessionId/);
  assert.match(source, /setSessionName\(\{ name, sessionId: renaming\.id \}\)/);
});

test("sidebar treats children of a deleted parent as visible roots", async () => {
  const source = await readFile(new URL("../src/renderer/components/sessions/SessionList.tsx", import.meta.url), "utf8");
  assert.match(source, /const childIds = new Set/);
  assert.match(source, /const roots = filtered\.filter\(\(session\) => !childIds\.has\(session\.id\)\)/);
});
