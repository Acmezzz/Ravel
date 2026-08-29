import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDesktopSettings } from "../electron/desktop-settings.js";
import { readFile } from "node:fs/promises";

test("desktop recovery state is bounded and does not store transcript content", () => {
  const result = sanitizeDesktopSettings({ sessionRecovery: {
    sessionA: { state: "error", running: false, unread: true, error: "worker failed", updatedAt: "2026-01-01T00:00:00.000Z", transcript: "secret" },
  } });
  assert.equal(result.sessionRecovery.sessionA.error, "worker failed");
  assert.equal("transcript" in result.sessionRecovery.sessionA, false);
});

test("window activation requests authoritative reconcile", async () => {
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  // The transport switch and the refresh call moved out of App.tsx into the
  // reducer + event bridge when App was split; assert against their owners.
  const reducer = await readFile(new URL("../src/renderer/lib/events/transport-event-reducer.ts", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../src/renderer/app/AppEventBridge.tsx", import.meta.url), "utf8");
  assert.match(main, /win\.on\("focus"/);
  assert.match(main, /state: "reconcile"/);
  assert.match(reducer, /switch \(data\.state\)/);
  assert.match(reducer, /case "reconcile":\s*\n\s*cmds\.push\(\{ kind: "refreshControlPlane" \}\)/);
  assert.match(bridge, /await refreshControlPlane\(\)/);
});
