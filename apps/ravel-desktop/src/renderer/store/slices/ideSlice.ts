/**
 * IDE slice — state keys belonging to the IDE surface only.
 *
 * The IDE surface intentionally owns its own local/transient viewport state
 * (CodeMirror editors, FileTree expansion, editor tabs selection); those are
 * kept in `useIdeSurface` / component-local state and are deliberately NOT
 * promoted into the global store. Only cross-cutting IDE facts that other
 * surfaces or the shell need (git diff snapshot, workspace epoch for tree
 * refresh, terminal tail) live here.
 *
 * Not a separate store — supplies types + default values that the single
 * `useAppStore` instance spreads in; setters stay in `useAppStore.ts`.
 */
import type { GitSnapshot } from "../../types/dto";

/** IDE-surface state fields only (no actions). */
export interface IdeSliceState {
  gitSnapshot: GitSnapshot | null;
  workspaceEpoch: number;
  bashTail: string;
}

/** Fresh default field values. */
export function createIdeDefaults(): IdeSliceState {
  return {
    gitSnapshot: null,
    workspaceEpoch: 0,
    bashTail: "",
  };
}