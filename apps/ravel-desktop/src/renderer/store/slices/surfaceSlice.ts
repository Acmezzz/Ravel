/**
 * Surface slice — the independent product *surface* dimension.
 *
 * `surfaceMode` selects which top-level Surface tool renders in the center
 * column (chat / IDE / histos). It is deliberately independent from
 * `agent.mode` (a capability/profile) and from `layout.rightTab` (a right-panel
 * view selector). Persisted to localStorage on change; restored lazily.
 *
 * Contract-aligned fixture: `test/renderer-surface-state.test.mjs` documents
 * `SURFACE_MODES` and `DEFAULT_SURFACE_MODE` and explicitly points at
 * `store/slices/surfaceSlice.ts` as the future home of this logic.
 *
 * Not a separate store — supplies the `surfaceMode` field type + default that
 * the single `useAppStore` instance spreads in; `setSurfaceMode` stays there.
 */
export type SurfaceMode = "chat" | "ide" | "histos";
export const SURFACE_MODES: readonly SurfaceMode[] = ["chat", "ide", "histos"];
export const DEFAULT_SURFACE_MODE: SurfaceMode = "chat";

/** Surface state fields only (no actions). */
export interface SurfaceSliceState {
  surfaceMode: SurfaceMode;
}

/** Lazily restore the persisted product surface; invalid/empty values default to "chat". */
export function readSurfaceMode(): SurfaceMode {
  try {
    const raw = localStorage.getItem("ravel-surface-mode");
    if (raw === "chat" || raw === "ide" || raw === "histos") return raw;
  } catch {
    /* best effort */
  }
  return DEFAULT_SURFACE_MODE;
}

/** Fresh default field value (restores persisted mode when present). */
export function createSurfaceDefaults(): SurfaceSliceState {
  return { surfaceMode: readSurfaceMode() };
}