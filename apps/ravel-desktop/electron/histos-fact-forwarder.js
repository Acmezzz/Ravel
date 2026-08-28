/**
 * Forwarder from agent-worker fact appends to the workspace Histos engine.
 *
 * Facts are already durable in the session JSONL when this runs, so the
 * forwarder is strictly a derived-index convenience: failures never propagate
 * to the caller (the prompt hot path must not depend on Histos), they surface
 * as diagnostics. Calls are serialized so batches reach the engine in append
 * order.
 */
export function createHistosFactForwarder({ ensureHost, onDiagnostic } = {}) {
  if (typeof ensureHost !== "function") {
    throw Object.assign(new Error("ensureHost is required"), { code: "invalid_args" });
  }
  let chain = Promise.resolve();
  return (message) => {
    if (!message?.sessionId || !Array.isArray(message.facts) || message.facts.length === 0) return;
    const run = chain.then(async () => {
      const host = await ensureHost();
      await host.call("applySessionFacts", { sessionId: message.sessionId, facts: message.facts });
    });
    chain = run.then(
      () => {},
      (error) => {
        onDiagnostic?.({
          sessionId: message.sessionId,
          error: error instanceof Error ? error.message : String(error),
          code: error?.code ?? "histos_apply_failed",
        });
      },
    );
  };
}
