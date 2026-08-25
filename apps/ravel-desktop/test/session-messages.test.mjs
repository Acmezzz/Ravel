import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSessionInfo, readSessionMessages, readSessionSummaries } from "../electron/session-reader.js";

test("disk-first session reader paginates historical messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-session-page-"));
  const file = join(root, "session.jsonl");
  const lines = [
    { type: "session", id: "session-page", cwd: root, timestamp: "2026-01-01T00:00:00.000Z" },
    ...Array.from({ length: 6 }, (_, index) => ({ type: "message", id: `entry-${index}`, timestamp: `2026-01-01T00:00:0${index + 1}.000Z`, message: { id: `message-${index}`, role: index % 2 ? "assistant" : "user", content: [{ type: "text", text: `message ${index}` }] } })),
  ];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const first = await readSessionMessages(file, { offset: 0, limit: 2 });
  assert.equal(first.total, 6);
  assert.equal(first.items.length, 2);
  assert.equal(first.nextOffset, 2);
  const second = await readSessionMessages(file, { offset: first.nextOffset, limit: 2 });
  assert.equal(second.items[0].text, "message 2");
});

test("appendSessionInfo writes a session_info entry and updates the summary title", async () => {
  const root = await mkdtemp(join(tmpdir(), "omega-session-rename-"));
  const file = join(root, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ type: "session", id: "session-rename", cwd: root, timestamp: "2026-01-01T00:00:00.000Z" })}\n`);
  appendSessionInfo(file, "Renamed session");
  const raw = await readFile(file, "utf8");
  assert.match(raw, /"type":"session_info"/);
  assert.match(raw, /"name":"Renamed session"/);
  const page = await readSessionSummaries(root);
  assert.equal(page.items[0].title, "Renamed session");
});
