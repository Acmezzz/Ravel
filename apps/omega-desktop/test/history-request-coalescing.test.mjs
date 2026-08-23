import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("historical message requests are coalesced and cleaned in finally", async () => {
  const source = await readFile(new URL("../src/renderer/components/chat/MessageList.tsx", import.meta.url), "utf8");
  assert.match(source, /historyRequestRef/);
  assert.match(source, /if \(historyRequestRef\.current\)/);
  assert.match(source, /finally/);
  assert.match(source, /prependMessages/);
});
