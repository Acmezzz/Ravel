import test from "node:test";
import assert from "node:assert/strict";
import { redactJsonPayload, redactSessionRecord, redactText } from "../electron/export-redact.js";

test("shape-based secrets are replaced with [redacted:*] markers", () => {
  const text = [
    "key is sk-abc123def456ghi789 done",
    "token ghp_0123456789abcdefghijklmnopqrst",
    "AKIAIOSFODNN7EXAMPLE",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
  ].join("\n");
  const out = redactText(text);
  assert.ok(out.includes("[redacted:api_key]"));
  assert.ok(out.includes("[redacted:bearer_token]"));
  assert.ok(!out.includes("sk-abc123def456ghi789"));
  assert.ok(!out.includes("ghp_0123456789"));
  assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
  // Ordinary text and code survive untouched.
  const plain = redactText("const total = price * count; // sk 简称不算\nrm -rf /tmp/x");
  assert.equal(plain, "const total = price * count; // sk 简称不算\nrm -rf /tmp/x");
});

test("credential key=value assignments keep the key and redact the value", () => {
  const env = "API_KEY=supersecretvalue123\nDB_HOST=localhost\ntoken: \"abcdefgh12345678\"\npassword=hunter2";
  const out = redactText(env);
  assert.ok(out.includes("API_KEY=[redacted:secret_value]"));
  assert.ok(out.includes('token: "[redacted:secret_value]'));
  assert.ok(out.includes("password=[redacted:secret_value]"));
  assert.ok(out.includes("DB_HOST=localhost"), "non-credential lines stay intact");
  assert.ok(!out.includes("supersecretvalue123"));
  assert.ok(!out.includes("hunter2"));
});

test("JSON payloads are parsed, redacted structurally, and re-serialized", () => {
  const payload = JSON.stringify({ command: "curl -H 'api_key: sk-abcdefghijklmnop12' https://x", count: 3 });
  const out = redactJsonPayload(payload);
  assert.ok(out.includes("[redacted:secret_value]") || out.includes("[redacted:api_key]"));
  assert.ok(!out.includes("sk-abcdefghijklmnop12"));
  // Non-JSON payloads fall back to a flat pass.
  assert.ok(redactJsonPayload("plain sk-abcdefghijklmnop12 text").includes("[redacted:"));
});

test("session record redaction is field-level and non-mutating", () => {
  const record = {
    id: "s1",
    title: "会话 sk-abcdefghijklmnop12 标题",
    workspace: "/ws",
    updatedAt: "2026-08-29T00:00:00Z",
    messages: [
      { role: "user", id: "m1", text: "运行 curl -H 'token: abcdefgh12345678' …" },
      { role: "assistant", id: "m2", text: "结果正常", thinking: "内部 bearer Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij" },
    ],
    toolCards: [
      { toolName: "bash", status: "done", argsJson: JSON.stringify({ command: "export API_KEY=supersecretvalue123" }), resultText: "ok" },
    ],
  };
  const snapshot = JSON.stringify(record);
  const redacted = redactSessionRecord(record);
  assert.equal(JSON.stringify(record), snapshot, "input record is untouched");
  assert.ok(redacted.title.includes("[redacted:"));
  assert.ok(redacted.messages[0].text.includes("[redacted:"));
  assert.ok(redacted.messages[1].thinking.includes("[redacted:"));
  assert.ok(redacted.toolCards[0].argsJson.includes("[redacted:"));
  assert.ok(!JSON.stringify(redacted).includes("supersecretvalue123"));
  assert.ok(!JSON.stringify(redacted).includes("sk-abcdefghijklmnop12"));
});
