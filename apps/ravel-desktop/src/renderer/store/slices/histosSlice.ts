/**
 * Histos slice — state keys naturally belonging to the history-graph surface.
 *
 * Currently the histos surface manages its transient/local UI state itself
 * (`useHistosGraphQuery`, `HistosFlowDrawer`, React Flow viewport / graph
 * selection / drag) so there is nothing to hoist into the global store — see
 * the strong-separation rule in the store refactor task: do NOT push
 * surface-local state (viewport, selection, drag) into the global Zustand
 * instance.
 *
 * This module is intentionally a near-empty placeholder: it exists so the
 * histos domain has an explicit home and a known register point if a *global*
 * histos field (e.g. cross-session graph focus shared with the shell) is ever
 * needed. Keep it minimal — no fabricated fields until a real consumer exists.
 */
export interface HistosSliceState {
  // (empty by design — see header comment)
}

/** Fresh default field values (currently none). */
export function createHistosDefaults(): HistosSliceState {
  return {};
}