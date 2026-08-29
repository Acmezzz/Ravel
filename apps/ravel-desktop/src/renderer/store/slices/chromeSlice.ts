/**
 * Chrome slice — "app shell" surface & global product-domain configuration.
 *
 * Single source of truth for the *shape* (field types) and *defaults* of the
 * state keys that describe the application chrome (native window, top-level
 * layout, panels, viewer, auth/settings, extension UI, worker status) and the
 * global configuration that surfaces consume (`models`, `commands`).
 *
 * This is NOT a separate store instance — the racing-context constraint keeps
 * `useAppStore` a single Zustand instance. This module only supplies types and
 * default values that `useAppStore` spreads in; actions/setters stay in
 * `useAppStore.ts`.
 */
import type {
  AuthStatus,
  DesktopSettings,
  ExtensionUIRequest,
  ExtensionUIStatus,
  ExtensionUIWidget,
  FileReadResult,
  ModelInfo,
  SlashCommandInfo,
} from "../../types/dto";
import type { ThemeMode } from "../../theme/palettes";

export type ConnectionState = "connecting" | "ready" | "running" | "closing" | "error";
export type ShutdownPhase = "idle" | "closing" | "flushing" | "exiting";

export interface LayoutState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  focusMode: boolean;
  rightTab: "diff" | "graph" | "worktree" | "agent" | "telemetry" | "snapshots" | "terminal";
  commandPaletteOpen: boolean;
  treeOpen: boolean;
  leftTab: "sessions" | "files" | "search" | "activity";
  modelCenterOpen: boolean;
  settingsOpen: boolean;
  resourceCenterOpen: boolean;
  trustCenterOpen: boolean;
}

export interface ViewerState {
  open: boolean;
  path: string | null;
  loading: boolean;
  error: string | null;
  file: FileReadResult | null;
}

/** Chrome/global-config state fields only (no actions). */
export interface ChromeSliceState {
  connection: ConnectionState;
  shutdownPhase: ShutdownPhase;
  bootstrapError: string | null;

  themeMode: ThemeMode;
  resolvedMode: "light" | "dark";

  models: ModelInfo[];
  commands: SlashCommandInfo[];
  auth: AuthStatus | null;
  desktopSettings: DesktopSettings | null;

  extensionUiRequest: ExtensionUIRequest | null;
  extensionStatuses: ExtensionUIStatus[];
  extensionWidgets: ExtensionUIWidget[];
  extensionTitle: string | null;

  workerError: string | null;
  canRetryWorker: boolean;

  layout: LayoutState;
  viewer: ViewerState;
}

export const DEFAULT_LAYOUT: LayoutState = {
  leftPanelOpen: true,
  rightPanelOpen: true,
  focusMode: false,
  rightTab: "diff",
  commandPaletteOpen: false,
  treeOpen: false,
  leftTab: "sessions",
  modelCenterOpen: false,
  settingsOpen: false,
  resourceCenterOpen: false,
  trustCenterOpen: false,
};

/** Fresh default field values (new object each call — avoid shared mutation). */
export function createChromeDefaults(): ChromeSliceState {
  return {
    connection: "connecting",
    shutdownPhase: "idle",
    bootstrapError: null,
    themeMode: "system",
    resolvedMode: "dark",
    models: [],
    commands: [],
    auth: null,
    desktopSettings: null,
    extensionUiRequest: null,
    extensionStatuses: [],
    extensionWidgets: [],
    extensionTitle: null,
    workerError: null,
    canRetryWorker: false,
    layout: { ...DEFAULT_LAYOUT },
    viewer: { open: false, path: null, loading: false, error: null, file: null },
  };
}