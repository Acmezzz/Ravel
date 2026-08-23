export function latencyUnavailable(reason = "network_disabled") {
  return { ok: false, code: reason, latencyMs: null, message: reason === "network_disabled" ? "当前离线模式未执行真实 provider 请求" : "Provider 不可用" };
}

export async function measureProviderLatency(run, { timeoutMs = 5_000 } = {}) {
  if (typeof run !== "function") return latencyUnavailable("provider_unavailable");
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await run(controller.signal);
    return { ok: true, code: null, latencyMs: Date.now() - started, message: "mock/provider request completed" };
  } catch (error) {
    return { ok: false, code: controller.signal.aborted ? "provider_timeout" : "provider_unavailable", latencyMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
