import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDesktopSettings } from "../electron/desktop-settings.js";
import { readFile } from "node:fs/promises";

test("custom providers persist as non-secret metadata and restore through Worker init", async () => {
  const settings = sanitizeDesktopSettings({ customProviders: { local: { id: "local", name: "Local", baseUrl: "http://127.0.0.1", api: "openai-completions", headers: {}, authHeader: true, models: [] } } });
  assert.equal(settings.customProviders.local.baseUrl, "http://127.0.0.1");
  const worker = await readFile(new URL("../electron/worker.mjs", import.meta.url), "utf8");
  const host = await readFile(new URL("../electron/worker-host.js", import.meta.url), "utf8");
  assert.match(worker, /customProviders/);
  assert.match(worker, /registerProvider/);
  assert.match(host, /customProviders/);
});
