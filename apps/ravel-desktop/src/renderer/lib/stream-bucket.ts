import type { EventMeta } from "../types/events";

/**
 * Streaming deltas are attributed per run, not globally: one bubble bucket per
 * sessionId + runtimeEpoch + runId. Stale deltas from an old run can therefore
 * never feed a newer run's bubble.
 */
export function streamBucketOf(meta?: EventMeta | null): string {
	if (!meta) return "unknown:-:-";
	return `${meta.sessionId ?? "unknown"}:${meta.runtimeEpoch ?? 0}:${meta.runId ?? "-"}`;
}
