/**
 * Precise selector helpers for the single `useAppStore` instance.
 *
 * Purpose: let each surface subscribe to the *minimum* set of state it needs so
 * that, e.g., Chat streaming (message/tool-card deltas) does not force IDE or
 * Histos surfaces to re-render. Zustand compares each update with `Object.is`;
 * returning a primitive (or a stable reference) from these selectors means an
 * unrelated `set()` leaves those subscribers untouched.
 *
 * Usage (component):
 *   const surfaceMode = useAppStore(selectSurfaceMode);
 *   const count = useAppStore(selectMessageCount);
 *   const active = useAppStore(selectActiveSessionId);
 *   const activity = useAppStore(makeSessionActivitySelector(id));
 *
 * Note: `useAppStore(makeSessionActivitySelector(id))` evaluates the returned
 * object by reference (stable until that session's activity record changes), so
 * it re-renders only when that record updates — safe to call inline.
 */
import type { AppState } from "../useAppStore";

// ---------------------------------------------------------------------------
// chrome / layout
// ---------------------------------------------------------------------------
/** Stable reference to the whole layout record (changes only when a layout key changes). */
export const selectLayout = (s: AppState): AppState["layout"] => s.layout;
export const selectRightTab = (s: AppState): AppState["layout"]["rightTab"] => s.layout.rightTab;
export const selectLeftPanelOpen = (s: AppState): boolean => s.layout.leftPanelOpen;
export const selectRightPanelOpen = (s: AppState): boolean => s.layout.rightPanelOpen;
export const selectFocusMode = (s: AppState): boolean => s.layout.focusMode;
export const selectViewer = (s: AppState): AppState["viewer"] => s.viewer;
export const selectModels = (s: AppState): AppState["models"] => s.models;
export const selectCommands = (s: AppState): AppState["commands"] => s.commands;
export const selectAuth = (s: AppState): AppState["auth"] => s.auth;
export const selectDesktopSettings = (s: AppState): AppState["desktopSettings"] => s.desktopSettings;
export const selectConnection = (s: AppState): AppState["connection"] => s.connection;
export const selectWorkerError = (s: AppState): AppState["workerError"] => s.workerError;

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------
export const selectSurfaceMode = (s: AppState): AppState["surfaceMode"] => s.surfaceMode;

// ---------------------------------------------------------------------------
// session / transcript (primitive "did it change" signals for chat surface)
// ---------------------------------------------------------------------------
export const selectActiveSessionId = (s: AppState): AppState["activeSessionId"] => s.activeSessionId;
export const selectSessionTotal = (s: AppState): number => s.sessionTotal;
/** Length of the loaded transcript — changes per append; avoids handing out the array. */
export const selectMessageCount = (s: AppState): number => s.messages.length;
/** Stable reference to the transcript array; new identity only on structural change. */
export const selectMessages = (s: AppState): AppState["messages"] => s.messages;
export const selectToolCardCount = (s: AppState): number => s.toolCards.length;
export const selectStreamingBuckets = (s: AppState): AppState["streamingBuckets"] => s.streamingBuckets;
export const selectLastAgentStartAt = (s: AppState): number => s.lastAgentStartAt;
export const selectAgent = (s: AppState): AppState["agent"] => s.agent;
export const selectThinkingActive = (s: AppState): boolean => s.thinkingActive;
export const selectCompacting = (s: AppState): boolean => s.compacting;
export const selectRetrying = (s: AppState): boolean => s.retrying;
/** Stable reference to the session list. */
export const selectSessions = (s: AppState): AppState["sessions"] => s.sessions;

/** Factory: subscribe to one session's activity record by its id (stable ref). */
export const makeSessionActivitySelector =
  (sessionId: string): ((s: AppState) => AppState["sessionActivity"][string] | undefined) =>
  (s) => s.sessionActivity[sessionId];

// ---------------------------------------------------------------------------
// ide
// ---------------------------------------------------------------------------
export const selectGitSnapshot = (s: AppState): AppState["gitSnapshot"] => s.gitSnapshot;
export const selectWorkspaceEpoch = (s: AppState): number => s.workspaceEpoch;
export const selectBashTail = (s: AppState): string => s.bashTail;