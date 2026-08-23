import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("tool details are fetched only when a card expands", async () => {
  const worker = await readFile(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../electron/agent-bridge.js", import.meta.url), "utf8");
  const card = await readFile(new URL("../src/renderer/components/chat/ToolCard.tsx", import.meta.url), "utf8");
  assert.match(worker, /getToolDetail/);
  assert.match(bridge, /export function getToolDetail/);
  assert.match(card, /onChange=.*loadDetail/);
  assert.match(card, /detail\?\.argsJson/);
  assert.match(card, /detail\?\.resultText/);
});
