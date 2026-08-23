import test from "node:test";
import assert from "node:assert/strict";
import { latencyUnavailable, measureProviderLatency } from "../electron/provider-latency.js";

test("offline provider latency is explicit and never reports fake success", async () => {
  assert.equal(latencyUnavailable().code, "network_disabled");
  const result = await measureProviderLatency(async () => {});
  assert.equal(result.ok, true);
  const unavailable = await measureProviderLatency(null);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "provider_unavailable");
});
