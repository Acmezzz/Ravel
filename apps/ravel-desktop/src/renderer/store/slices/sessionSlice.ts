/**
 * Session slice — activity session list, loaded transcript, agent runtime.
 *
 * Single source of truth for the *shape* (field types) and *defaults* of the
 * state keys describing the conversation: session listing, active session,
 * message transcript, tool cards, compaction markers, approvals, operations,
 * references, queued/optimistic/streaming messages, navigation requests, and
 * the agent runtime status (plan, permission, thinking/compacting/retrying,
 * composer text, session tree).
 *
 * Not a separate store — supplies types + default values that the single
 * `useAppStore` instance spreads in; all mutators (loadTranscript, appendMessage,
 * consumeOptimisticWith, ensureStreamingAssistant, ...) stay in `useAppStore.ts`.
 */
import type {
  SessionSummary,
  ActivityRow,
  SessionTree,
  AgentPermissionState,
  AgentPlan,
  AgentStateSnapshot,
  ApprovalOutcome,
  TimelineOperation,
  TranscriptMarker,
  ApprovalFact,
  SessionReferenceFact,
} from "../../types/dto";
import type { ToolExecutionSummaryEvent } from "../../types/events";

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

export interface TranscriptNavigationRequest {
  sessionId: string;
  entryId?: string;
  toolCallId?: string;
  nonce: number;
}

/** Session/transcript/agent-runtime state fields only (no actions). */
export interface SessionSliceState {
  sessions: SessionSummary[];
  sessionTotal: number;
  sessionNextOffset: number | null;
  sessionActivity: Record<string, SessionActivity>;
  /** UIKit rows keyed by sessionId (live tracker + fact-derived merges). */
  activityRows: Record<string, ActivityRow>;
  activeSessionId: string | null;
  messages: import("../../types/dto").SessionMessage[];
  toolCards: ToolCardState[];
  markers: TranscriptMarker[];
  approvals: ApprovalFact[];
  operations: TimelineOperation[];
  references: SessionReferenceFact[];
  queuedMessages: QueuedMessages;
  pendingOptimistic: PendingOptimisticMessage[];
  optimisticKey: string | null;
  streamingBuckets: Record<string, string>;
  lastAgentStartAt: number;
  transcriptNavigation: TranscriptNavigationRequest | null;
  sessionTree: SessionTree | null;

  agent: AgentStateSnapshot | null;
  permission: AgentPermissionState | null;
  plan: AgentPlan | null;
  thinkingActive: boolean;
  compacting: boolean;
  retrying: boolean;
  composerError: string | null;
  composerPrefill: string | null;
}

/** Fresh default field values (new object each call — avoid shared mutation). */
export function createSessionDefaults(): SessionSliceState {
  const noneMessages: import("../../types/dto").SessionMessage[] = [];
  return {
    sessions: [],
    sessionTotal: 0,
    sessionNextOffset: null,
    sessionActivity: {},
    activityRows: {},
    activeSessionId: null,
    messages: noneMessages,
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
    transcriptNavigation: null,
    sessionTree: null,
    agent: null,
    permission: null,
    plan: null,
    thinkingActive: false,
    compacting: false,
    retrying: false,
    composerError: null,
    composerPrefill: null,
  };
}