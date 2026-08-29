import type { EventMeta } from "../../types/events";

/**
 * Event-ordering predicates.
 *
 * These are the pure re-export of the "is this event stale" decision that lived
 * inside `App.tsx` `handleEvent`. An event is stale (should be ignored) when its
 * generation / runtimeEpoch / sequence coordinates are at or behind the last
 * accepted coordinate:
 *
 *   - `generation < currentGeneration`, or
 *   - `generation === currentGeneration && runtimeEpoch < currentRuntimeEpoch`, or
 *   - all three equal && `sequence <= lastSequence`.
 *
 * When the generation or runtimeEpoch advances (or the ref is fresh) the
 * sequence dimension resets before comparing (an old high sequence in a prior
 * run must not suppress a new run's first, low sequence).
 *
 * Background sessions are handled by the caller *before* these predicates run:
 * if `meta.sessionId` exists and differs from the active session, ordering is
 * not applied.
 */

export interface EventOrderRef {
  /** Highest accepted generation coordinate. */
  currentGeneration: number;
  /** Highest accepted (within generation) runtime epoch coordinate. */
  currentRuntimeEpoch: number;
  /** Highest accepted per-run sequence coordinate. */
  lastSequence: number;
}

export function initialEventOrderRef(): EventOrderRef {
  return { currentGeneration: 0, currentRuntimeEpoch: 0, lastSequence: 0 };
}

/** True when `meta` is old relative to `ref` and should be ignored. */
export function isStaleEvent(meta: EventMeta, ref: EventOrderRef): boolean {
  const runtimeEpoch = meta.runtimeEpoch ?? 0;
  if (meta.generation < ref.currentGeneration) return true;
  if (meta.generation === ref.currentGeneration && runtimeEpoch < ref.currentRuntimeEpoch) return true;
  if (
    meta.generation === ref.currentGeneration &&
    runtimeEpoch === ref.currentRuntimeEpoch &&
    meta.sequence <= ref.lastSequence
  ) {
    return true;
  }
  return false;
}

/**
 * Returns the ref advanced past an accepted event. Returns `ref` unchanged when
 * the event is stale. On a generation/epoch advance the sequence dimension is
 * reset before recording the accepted coordinate.
 */
export function advanceEventRef(meta: EventMeta, ref: EventOrderRef): EventOrderRef {
  if (isStaleEvent(meta, ref)) return ref;
  const runtimeEpoch = meta.runtimeEpoch ?? 0;
  return {
    currentGeneration: meta.generation,
    currentRuntimeEpoch: runtimeEpoch,
    lastSequence: meta.sequence,
  };
}