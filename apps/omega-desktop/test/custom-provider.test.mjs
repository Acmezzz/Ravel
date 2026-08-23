import test from "node:test";
import assert from "node:assert/strict";
import { validateCustomProvider } from "../electron/custom-providers.js";

test("custom provider validation keeps bounded local configuration", () => {
  const provider = validateCustomProvider({ id: "local-ai", name: "Local AI", baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", headers: { "x-org": "omega" }, models: [{ id: "demo", reasoning: true, contextWindow: 50000 }] });
  assert.equal(provider.id, "local-ai");
  assert.equal(provider.models[0].contextWindow, 50000);
  assert.deepEqual(Object.keys(provider.headers), ["x-org"]);
  assert.throws(() => validateCustomProvider({ id: "Bad ID", baseUrl: "file:///secret", api: "unknown" }), (error) => error.code === "invalid_args");
});

test("custom provider bridge is offline-only", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  assert.match(source, /registerProvider/);
  assert.match(source, /validateCustomProvider/);
  assert.doesNotMatch(source, /allowNetwork:\s*true/);
});
