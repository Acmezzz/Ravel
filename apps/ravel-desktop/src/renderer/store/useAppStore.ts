/**
 * Global application state (single Zustand store).
 *
 * A store (not React Context) is used because the agent event stream is
 * high-frequency, append-only deltas. Selector subscriptions let granular
 * components (a single message bubble, a single tool card) re-render without
 * re-rendering the whole tree. See system_design.md §2.2.
 */
import { create } from "zustand";
import { ipc } from "../ipc/client";
import type {
  SessionSummary,
  SessionListPage,
  SessionRecord,
  SessionMessage,
  SessionTree,
  AgentPermissionState,
  AgentPlan,
  AgentStateSnapshot,
  ModelInfo,
  ThinkingLevel,
  SlashCommandInfo,
  AuthStatus,
  DesktopSettings,
  UsageSnapshot,
  GitSnapshot,
  FileReadResult,
  ExtensionUIRequest,
  ExtensionUIStatus,
  ExtensionUIWidget,
  ApprovalOutcome,
  TimelineOperation,
  TranscriptMarker,
  ApprovalFact,
  ActivityRow,
  SessionReferenceFact,
} from "../types/dto";
import type { ThemeMode } from "../theme/palettes";
import { applyModeWithTransition } from "../theme/palettes";
import type {
  ToolExecutionSummaryEvent,
} from "../types/events";

export type ConnectionState = "connecting" | "ready" | "running" | "closing" | "error";
export type ShutdownPhase = "idle" | "closing" | "flushing" | "exiting";

export interface ToolCardState {
  toolCallId: string;
  toolName: string;
  kind: ToolExecutionSummaryEvent["kind"];
  target?: string;
  op?: string;
  status: "running" | "done" | "error";
  startedAt?: string;
  endedAt?: string;
  argsJson?: string;
  resultText?: string;
  isError?: boolean;
  afterMessageId?: string;
  approval?: ApprovalOutcome;
}

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

export interface PendingOptimisticMessage {
  key: string;
  clientMessageId: string;
  messageId: string;
  text: string;
  createdAt: number;
}

export interface SessionActivity {
  running: boolean;
  unread: boolean;
  compacting: boolean;
  failed: boolean;
}

export interface LayoutState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  focusMode: boolean;
  rightTab: "diff" | "graph" | "worktree" | "telemetry" | "snapshots";
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

export interface AppState {
  connection: ConnectionState;
  shutdownPhase: ShutdownPhase;
  bootstrapError: string | null;

  themeMode: ThemeMode;
  resolvedMode: "light" | "dark";
  setThemeMode: (mode: ThemeMode, origin?: { x: number; y: number }) => void;

  sessions: SessionSummary[];
  sessionTotal: number;
  sessionNextOffset: number | null;
  sessionActivity: Record<string, SessionActivity>;
  /** 动态视图 rows keyed by sessionId (live tracker + fact-derived merges). */
  activityRows: Record<string, ActivityRow>;
  applyActivityRows: (rows: ActivityRow[]) => void;
  activeSessionId: string | null;
  messages: SessionMessage[];
  toolCards: ToolCardState[];
  /** Compaction boundaries projected from the authoritative transcript. */
  markers: TranscriptMarker[];
  approvals: ApprovalFact[];
  /** Durable run operations (turns) projected from session facts. */
  operations: TimelineOperation[];
  /** Projected @session reference edges for the loaded transcript. */
  references: SessionReferenceFact[];
  queuedMessages: QueuedMessages;
  /** Pending optimistic bubbles keyed by their client prompt identity. */
  pendingOptimistic: PendingOptimisticMessage[];
  /** Legacy latest key retained for recovery compatibility; new code uses pendingOptimistic. */
  optimisticKey: string | null;
  /** Streaming assistant bubble ids keyed by `${sessionId}:${epoch}:${runId}` bucket. */
  streamingBuckets: Record<string, string>;
  /** Epoch of the last agent_start — lets late prompt failures skip rollback. */
  lastAgentStartAt: number;

  agent: AgentStateSnapshot | null;
  models: ModelInfo[];
  commands: SlashCommandInfo[];
  auth: AuthStatus | null;
  desktopSettings: DesktopSettings | null;
  thinkingActive: boolean;
  compacting: boolean;
  retrying: boolean;
  composerError: string | null;
  composerPrefill: string | null;
  extensionUiRequest: ExtensionUIRequest | null;
  extensionStatuses: ExtensionUIStatus[];
  extensionWidgets: ExtensionUIWidget[];
  extensionTitle: string | null;
  bashTail: string;
  workerError: string | null;
  canRetryWorker: boolean;

  gitSnapshot: GitSnapshot | null;
  sessionTree: SessionTree | null;
  workspaceEpoch: number;
  viewer: ViewerState;

  permission: AgentPermissionState | null;
  plan: AgentPlan | null;

  layout: LayoutState;

  setConnection: (state: ConnectionState) => void;
  setShutdownPhase: (phase: ShutdownPhase) => void;
  setBootstrapError: (message: string | null) => void;
  setComposerError: (message: string | null) => void;
  setComposerPrefill: (text: string | null) => void;
  setExtensionUiRequest: (request: ExtensionUIRequest | null) => void;
  setExtensionStatus: (status: ExtensionUIStatus) => void;
  clearExtensionStatus: (sessionId: string, key: string) => void;
  setExtensionWidget: (widget: ExtensionUIWidget) => void;
  clearExtensionWidget: (sessionId: string, key: string) => void;
  setExtensionTitle: (title: string | null) => void;
  setWorkerError: (message: string | null, canRetry?: boolean) => void;

  applySessionPage: (page: SessionListPage, mode?: "replace" | "append") => void;
  markSessionActivity: (sessionId: string, patch: Partial<SessionActivity>) => void;
  setActiveSession: (id: string | null) => void;
  loadTranscript: (record: SessionRecord) => void;
  clearConversation: () => void;

  appendMessage: (message: SessionMessage) => void;
  prependMessages: (messages: SessionMessage[]) => void;
  appendDelta: (messageId: string, delta: string) => void;
  /** Add one locally rendered user message before the authoritative event arrives. */
  addOptimisticMessage: (pending: PendingOptimisticMessage, message: SessionMessage) => void;
  /** Replace the matching optimistic bubble with the authoritative user message. */
  consumeOptimisticWith: (delivered: SessionMessage, key?: string, clientMessageId?: string | null) => void;
  /** Remove only the optimistic bubble belonging to this prompt key. */
  dropLastIfOptimistic: (key: string) => void;
  /** Remove all unconfirmed optimistic bubbles after a worker recovery boundary. */
  dropAllOptimistic: () => void;
  setStreamingBucket: (bucket: string, id: string) => void;
  clearStreamingBuckets: () => void;
  /** Ensure a streaming assistant bubble exists for this run bucket; returns its id. */
  ensureStreamingAssistant: (bucket: string) => string;

  upsertToolCard: (summary: ToolExecutionSummaryEvent) => void;
  appendBashTail: (delta: string) => void;

  setQueuedMessages: (queued: QueuedMessages) => void;
  setAgent: (agent: AgentStateSnapshot | null) => void;
  patchAgent: (patch: Partial<AgentStateSnapshot>) => void;
  setModels: (models: ModelInfo[]) => void;
  setCommands: (commands: SlashCommandInfo[]) => void;
  setAuth: (auth: AuthStatus | null) => void;
  setDesktopSettings: (settings: DesktopSettings | null) => void;
  setThinkingActive: (active: boolean) => void;
  setCompacting: (compacting: boolean) => void;
  setRetrying: (retrying: boolean) => void;

  setGitSnapshot: (snapshot: GitSnapshot | null) => void;
  setSessionTree: (tree: SessionTree | null) => void;
  bumpWorkspaceEpoch: () => void;
  openViewer: (path: string) => Promise<void>;
  closeViewer: () => void;

  setLayout: (patch: Partial<LayoutState>) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleFocusMode: () => void;
  setRightTab: (tab: LayoutState["rightTab"]) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTreeOpen: (open: boolean) => void;
  setModelCenterOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setResourceCenterOpen: (open: boolean) => void;
  setTrustCenterOpen: (open: boolean) => void;
}

const EMPTY_USAGE: UsageSnapshot = {
  tokens: null,
  contextWindow: null,
  percent: null,
  input: 0,
  output: 0,
  total: 0,
  cost: 0,
};

export const useAppStore = create<AppState>((set, get) => ({
  connection: "connecting",
  shutdownPhase: "idle",
  bootstrapError: null,

  themeMode: "system",
  resolvedMode: "dark",
  setThemeMode: (mode, origin) => {
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
    try {
      localStorage.setItem("ravel-theme", JSON.stringify(mode));
    } catch {
      /* best effort */
    }
    applyModeWithTransition(resolved, origin);
    set({ themeMode: mode, resolvedMode: resolved });
    const current = get().desktopSettings;
    if (current && current.themeMode !== mode) {
      void ipc.updateDesktopSettings({ themeMode: mode }).then((res) => {
        if (res.ok) get().setDesktopSettings(res.data);
      });
    }
  },

  sessions: [],
  sessionTotal: 0,
  sessionNextOffset: null,
  sessionActivity: {},
  activityRows: {},
  applyActivityRows: (rows) =>
    set((state) => {
      if (rows.length === 0) return {};
      const next = { ...state.activityRows };
      for (const row of rows) next[row.sessionId] = row;
      return { activityRows: next };
    }),
  activeSessionId: null,
  messages: [],
  toolCards: [],
  markers: [],
  approvals: [],
  operations: [],
  references: [],
  queuedMessages: { steering: [], followUp: [] },
  pendingOptimistic: [],
  optimisticKey: null,
  streamingBuckets: {},
  lastAgentStartAt: 0,

  agent: null,
  models: [],
  commands: [],
  auth: null,
  desktopSettings: null,
  thinkingActive: false,
  compacting: false,
  retrying: false,
  composerError: null,
  composerPrefill: null,
  extensionUiRequest: null,
  extensionStatuses: [],
  extensionWidgets: [],
  extensionTitle: null,
  bashTail: "",
  workerError: null,
  canRetryWorker: false,

  gitSnapshot: null,
  sessionTree: null,
  workspaceEpoch: 0,
  viewer: { open: false, path: null, loading: false, error: null, file: null },

  permission: null,
  plan: null,

  layout: {
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
  },

  setConnection: (connection) => set({ connection }),
  setShutdownPhase: (shutdownPhase) => set({ shutdownPhase }),
  setBootstrapError: (bootstrapError) => set({ bootstrapError }),
  setComposerError: (composerError) => set({ composerError }),
  setComposerPrefill: (composerPrefill) => set({ composerPrefill }),
  setExtensionUiRequest: (extensionUiRequest) => set({ extensionUiRequest }),
  setExtensionStatus: (status) => set((state) => ({ extensionStatuses: [...state.extensionStatuses.filter((item) => !(item.sessionId === status.sessionId && item.key === status.key)), status] })),
  clearExtensionStatus: (sessionId, key) => set((state) => ({ extensionStatuses: state.extensionStatuses.filter((item) => !(item.sessionId === sessionId && item.key === key)) })),
  setExtensionWidget: (widget) => set((state) => ({ extensionWidgets: [...state.extensionWidgets.filter((item) => !(item.sessionId === widget.sessionId && item.key === widget.key)), widget] })),
  clearExtensionWidget: (sessionId, key) => set((state) => ({ extensionWidgets: state.extensionWidgets.filter((item) => !(item.sessionId === sessionId && item.key === key)) })),
  setExtensionTitle: (extensionTitle) => set({ extensionTitle }),
  setWorkerError: (workerError, canRetry = false) => set({ workerError, canRetryWorker: Boolean(workerError) && canRetry }),

  applySessionPage: (page, mode = "replace") =>
    set((state) => {
      const incoming = Array.isArray(page?.items) ? page.items : [];
      const merged =
        mode === "append"
          ? [...state.sessions.filter((session) => !incoming.some((item) => item.id === session.id)), ...incoming]
          : incoming;
      return {
        sessions: merged,
        sessionTotal: typeof page?.total === "number" ? page.total : merged.length,
        sessionNextOffset: page?.nextOffset ?? null,
      };
    }),
  markSessionActivity: (sessionId, patch) =>
    set((state) => {
      const current = state.sessionActivity[sessionId] ?? { running: false, unread: false, compacting: false, failed: false };
      return { sessionActivity: { ...state.sessionActivity, [sessionId]: { ...current, ...patch } } };
    }),
  setActiveSession: (activeSessionId) =>
    set((state) => {
      if (!activeSessionId) return { activeSessionId };
      const current = state.sessionActivity[activeSessionId];
      if (!current?.unread) return { activeSessionId };
      return {
        activeSessionId,
        sessionActivity: { ...state.sessionActivity, [activeSessionId]: { ...current, unread: false } },
      };
    }),
  loadTranscript: (record) =>
    set({
      activeSessionId: record.id,
      messages: [...record.messages],
      toolCards: (record.toolCards ?? []).map((card) => ({
        toolCallId: card.toolCallId,
        toolName: card.toolName,
        kind: (card.kind as ToolCardState["kind"]) ?? "other",
        target: card.target,
        argsJson: card.argsJson,
        resultText: card.resultText,
        isError: card.isError,
        status: card.status === "error" ? "error" : "done",
        afterMessageId: card.afterMessageId,
        approval: card.approval,
      })),
      markers: [...(record.markers ?? [])],
      approvals: [...(record.approvals ?? [])],
      operations: [...(record.operations ?? [])],
      references: [...(record.references ?? [])],
      queuedMessages: { steering: [], followUp: [] },
      pendingOptimistic: [],
      optimisticKey: null,
      streamingBuckets: {},
      thinkingActive: false,
      compacting: false,
      retrying: false,
      composerError: null,
      bashTail: "",
    }),
  clearConversation: () =>
    set({
      messages: [],
      toolCards: [],
      markers: [],
      approvals: [],
      operations: [],
      references: [],
      queuedMessages: { steering: [], followUp: [] },
      pendingOptimistic: [],
      optimisticKey: null,
      streamingBuckets: {},
      thinkingActive: false,
      compacting: false,
      retrying: false,
      composerError: null,
      bashTail: "",
    }),

  appendMessage: (message) =>
    set((state) => {
      // Redelivery (worker-recovery replay, double push) must not create a
      // duplicate bubble: same id means the authoritative copy wins in place.
      const index = state.messages.findIndex((item) => item.id === message.id);
      if (index < 0) return { messages: [...state.messages, message] };
      const messages = [...state.messages];
      messages[index] = { ...messages[index], ...message };
      return { messages };
    }),
  prependMessages: (messages) =>
    set((state) => {
      const known = new Set(state.messages.map((message) => message.id));
      const incoming = messages.filter((message) => !known.has(message.id));
      return incoming.length ? { messages: [...incoming, ...state.messages] } : {};
    }),
  appendDelta: (messageId, delta) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? { ...message, text: message.text + delta }
          : message,
      ),
    })),
  addOptimisticMessage: (pending, message) =>
    set((state) => ({
      messages: [...state.messages, message],
      pendingOptimistic: [...state.pendingOptimistic, pending],
      optimisticKey: pending.key,
    })),
  consumeOptimisticWith: (delivered, key, clientMessageId) =>
    set((state) => {
      // Optimistic bubbles are reconciled ONLY by their prompt identity
      // (clientMessageId, or the composer's key as a legacy fallback). Text
      // matching and single-pending guesses misattribute concurrent prompts,
      // so a bubble without an identity match stays pending until recovery.
      const pendingIndex = clientMessageId
        ? state.pendingOptimistic.findIndex((item) => item.clientMessageId === clientMessageId)
        : key
          ? state.pendingOptimistic.findIndex((item) => item.key === key)
          : -1;
      const pending = pendingIndex >= 0 ? state.pendingOptimistic[pendingIndex] : undefined;
      const nextPending = pending
        ? state.pendingOptimistic.filter((_, index) => index !== pendingIndex)
        : state.pendingOptimistic;
      const nextKey = nextPending.at(-1)?.key ?? null;
      if (pending) {
        const messageIndex = state.messages.findIndex((message) => message.id === pending.messageId);
        if (messageIndex >= 0) {
          const messages = [...state.messages];
          messages[messageIndex] = {
            ...messages[messageIndex],
            ...delivered,
            id: delivered.id || messages[messageIndex].id,
            text: delivered.text || messages[messageIndex].text,
            entryId: delivered.entryId ?? messages[messageIndex].entryId,
          };
          return { messages, pendingOptimistic: nextPending, optimisticKey: nextKey };
        }
      }
      if (delivered.id && state.messages.some((message) => message.id === delivered.id)) {
        return { pendingOptimistic: nextPending, optimisticKey: nextKey };
      }
      if (delivered.role === "user") {
        let duplicateIndex = -1;
        for (let index = state.messages.length - 1; index >= 0; index -= 1) {
          if (state.messages[index]?.role === "user") {
            duplicateIndex = index;
            break;
          }
        }
        const duplicate = duplicateIndex >= 0 ? state.messages[duplicateIndex] : undefined;
        if (duplicate?.text === delivered.text) {
          const messages = [...state.messages];
          messages[duplicateIndex] = { ...messages[duplicateIndex], ...delivered };
          return { messages, pendingOptimistic: nextPending, optimisticKey: nextKey };
        }
      }
      return { messages: [...state.messages, delivered], pendingOptimistic: nextPending, optimisticKey: nextKey };
    }),
  dropLastIfOptimistic: (key) =>
    set((state) => {
      const pending = state.pendingOptimistic.find((item) => item.key === key);
      if (!pending) return {};
      const nextPending = state.pendingOptimistic.filter((item) => item.key !== key);
      return {
        messages: state.messages.filter((message) => message.id !== pending.messageId),
        pendingOptimistic: nextPending,
        optimisticKey: nextPending.at(-1)?.key ?? null,
      };
    }),
  dropAllOptimistic: () =>
    set((state) => ({
      messages: state.messages.filter((message) => !state.pendingOptimistic.some((item) => item.messageId === message.id)),
      pendingOptimistic: [],
      optimisticKey: null,
    })),
  setStreamingBucket: (bucket, id) =>
    set((state) => ({ streamingBuckets: { ...state.streamingBuckets, [bucket]: id } })),
  clearStreamingBuckets: () => set({ streamingBuckets: {} }),
  ensureStreamingAssistant: (bucket) => {
    const state = get();
    const existing = state.streamingBuckets[bucket];
    if (existing && state.messages.some((message) => message.id === existing)) return existing;
    const message: SessionMessage = {
      role: "assistant",
      id: `streaming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: "",
      ts: new Date().toISOString(),
    };
    set((current) => ({
      messages: [...current.messages, message],
      streamingBuckets: { ...current.streamingBuckets, [bucket]: message.id },
    }));
    return message.id;
  },

  upsertToolCard: (summary) =>
    set((state) => {
      const lastAssistant = [...state.messages].reverse().find((message) => message.role === "assistant");
      const existing = state.toolCards.find((card) => card.toolCallId === summary.toolCallId);
      if (existing) {
        return {
          toolCards: state.toolCards.map((card) =>
            card.toolCallId === summary.toolCallId
              ? {
                  ...card,
                  toolName: summary.toolName,
                  kind: (summary.kind ?? card.kind) as ToolCardState["kind"],
                  target: summary.target ?? card.target,
                  op: summary.op ?? card.op,
                  status: summary.status,
                  startedAt: card.startedAt ?? summary.startedAt,
                  endedAt: summary.endedAt ?? card.endedAt,
                  argsJson: summary.argsJson ?? card.argsJson,
                  resultText: summary.resultText ?? card.resultText,
                  isError: summary.isError ?? card.isError,
                  afterMessageId: card.afterMessageId ?? lastAssistant?.id,
                }
              : card,
          ),
        };
      }
      return {
        toolCards: [
          ...state.toolCards,
          {
            toolCallId: summary.toolCallId,
            toolName: summary.toolName,
            kind: summary.kind,
            target: summary.target,
            op: summary.op,
            status: summary.status,
            startedAt: summary.startedAt,
            endedAt: summary.endedAt,
            argsJson: summary.argsJson,
            resultText: summary.resultText,
            isError: summary.isError,
            afterMessageId: lastAssistant?.id,
          },
        ],
      };
    }),

  appendBashTail: (delta) =>
    set((state) => {
      const next = (state.bashTail + delta).slice(-4_000);
      return { bashTail: next };
    }),

  setQueuedMessages: (queuedMessages) => set({ queuedMessages }),
  setAgent: (agent) => set({ agent, compacting: agent?.isCompacting ?? false }),
  patchAgent: (patch) =>
    set((state) => ({
      agent: state.agent
        ? { ...state.agent, ...patch, usage: patch.usage ?? state.agent.usage ?? EMPTY_USAGE }
        : (patch as AgentStateSnapshot),
    })),
  setModels: (models) => set({ models }),
  setCommands: (commands) => set({ commands }),
  setAuth: (auth) => set({ auth }),
  setDesktopSettings: (desktopSettings) => set({ desktopSettings }),
  setThinkingActive: (thinkingActive) => set({ thinkingActive }),
  setCompacting: (compacting) => set({ compacting }),
  setRetrying: (retrying) => set({ retrying }),

  setGitSnapshot: (gitSnapshot) => set({ gitSnapshot }),
  setSessionTree: (sessionTree) => set({ sessionTree }),
  bumpWorkspaceEpoch: () => set((state) => ({ workspaceEpoch: state.workspaceEpoch + 1 })),
  openViewer: async (path) => {
    set({ viewer: { open: true, path, loading: true, error: null, file: null } });
    const res = await ipc.readFile({ path });
    const current = useAppStore.getState().viewer;
    if (current.path !== path) return; // switched away meanwhile
    if (res.ok) set({ viewer: { open: true, path, loading: false, error: null, file: res.data } });
    else set({ viewer: { open: true, path, loading: false, error: res.message, file: null } });
  },
  closeViewer: () => set({ viewer: { open: false, path: null, loading: false, error: null, file: null } }),

  setLayout: (patch) =>
    set((state) => ({ layout: { ...state.layout, ...patch } })),
  toggleLeftPanel: () =>
    set((state) => ({ layout: { ...state.layout, leftPanelOpen: !state.layout.leftPanelOpen } })),
  toggleFocusMode: () =>
    set((state) => ({ layout: { ...state.layout, focusMode: !state.layout.focusMode } })),
  toggleRightPanel: () => {
    const next = !get().layout.rightPanelOpen;
    set((state) => ({
      layout: {
        ...state.layout,
        rightPanelOpen: next,
      },
    }));
    void ipc.updateDesktopSettings({ rightPanelOpen: next }).then((res) => {
      if (res.ok) get().setDesktopSettings(res.data);
    });
  },
  setRightTab: (rightTab) =>
    set((state) => ({
      layout: { ...state.layout, rightTab, rightPanelOpen: true },
    })),
  setCommandPaletteOpen: (commandPaletteOpen) =>
    set((state) => ({
      layout: { ...state.layout, commandPaletteOpen },
    })),
  setTreeOpen: (treeOpen) =>
    set((state) => ({
      layout: { ...state.layout, treeOpen },
    })),
  setModelCenterOpen: (modelCenterOpen) =>
    set((state) => ({
      layout: { ...state.layout, modelCenterOpen },
    })),
  setSettingsOpen: (settingsOpen) =>
    set((state) => ({
      layout: { ...state.layout, settingsOpen },
    })),
  setResourceCenterOpen: (resourceCenterOpen) =>
    set((state) => ({
      layout: { ...state.layout, resourceCenterOpen },
    })),
  setTrustCenterOpen: (trustCenterOpen) =>
    set((state) => ({
      layout: { ...state.layout, trustCenterOpen },
    })),
}));

export type { ThinkingLevel };
