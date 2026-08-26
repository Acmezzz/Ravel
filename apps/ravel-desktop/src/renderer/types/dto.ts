/**
 * Controlled DTOs consumed by the renderer.
 *
 * These are the ONLY shapes the renderer ever sees. They are produced by the
 * Electron main process and scrubbed before crossing IPC. See
 * system_design.md §3.1–§3.5 and the security red line.
 */

/** Unified IPC envelope returned by every `omega:*` invoke. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

// ===== agent_* (V1 placeholders) =====

export interface AgentPermissionState {
  available: boolean;
  mode: "default" | "elevated" | "restricted";
  toolsAllowed: string[];
  note: string;
}

export interface AgentPlan {
  available: boolean;
  steps: string[];
  source: "event" | "derived" | "none";
  note: string;
}

// ===== diff / approval =====

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffHunk {
  header: string;
  lines: Array<{
    type: "context" | "add" | "del";
    oldLine?: number;
    newLine?: number;
    content: string;
  }>;
  raw?: string;
}

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface WorkspaceDiff {
  generatedAt: string;
  repoRoot: string;
  isGitRepo: boolean;
  files: DiffFile[];
}

export interface ChangeApprovalResult {
  applied: boolean;
  action: "accept" | "reject";
  revertedFiles: string[];
  errors: string[];
}

// ===== workspace =====

export type ProjectTrustDecision = "trusted" | "untrusted" | "undecided";
export type ProjectTrustChoice = "once" | "always" | "never";

export interface ProjectTrustInfo {
  cwd: string;
  requiresTrust: boolean;
  decision: ProjectTrustDecision;
  saved: ProjectTrustDecision;
  sessionOnly: boolean;
  resourcesDormant: boolean;
}

export interface WorkspaceInfo {
  workspaceId: string;
  realRoot: string;
  displayPath: string;
  active?: boolean;
  trust?: ProjectTrustDecision;
  requiresTrust?: boolean;
  resourcesDormant?: boolean;
}

// ===== sessions =====

export interface SessionSummary {
  id: string;
  title: string;
  projectKey?: string;
  workspace: string;
  workspaceId?: string;
  workspaceLabel?: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "archived";
  messageCount?: number;
  parentSessionId?: string;
}

export interface SessionListPage {
  items: SessionSummary[];
  total: number;
  nextOffset: number | null;
  treeIndex?: Record<string, string[]>;
}

/** One cross-session row of the 动态 view (live or fact-derived). */
export interface ActivityRow {
  sessionId: string;
  status: "running" | "waiting" | "failed" | "done";
  pendingApprovals: number;
  lastError: string | null;
  lastOutcome: string | null;
  updatedAt: string;
  title?: string;
  workspace?: string;
}

export interface ActivitySnapshotPage {
  items: ActivityRow[];
  total: number;
  nextOffset: null;
}

/** One local stdio MCP server definition row (user or project scope). */
export interface McpServerRow {
  name: string;
  command: string;
  args: string[];
  scope: "user" | "project";
  enabled: boolean;
}

export interface McpBundle {
  items: McpServerRow[];
  /** False when the ravel-mcp-bridge execution extension is not discoverable. */
  bridgeLoaded: boolean;
}

export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

export interface TimelineOperation {
  id: string;
  kind: string;
  status: "open" | "completed" | "aborted" | "failed" | "declined";
  startedAt?: string;
  finishedAt?: string;
}

/** Per-turn token/cache economics for the telemetry panel (newest first). */
export interface TelemetryTurn {
  id: string;
  ts: string | null;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  promptTokens: number;
  cacheHitRate: number | null;
  missedTokens: number;
  tokensPerSecond: number | null;
}

export interface TelemetryTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  prompt: number;
  wasteTokens: number;
  missCount: number;
  hitRate: number | null;
}

export interface TelemetrySnapshot {
  totals: TelemetryTotals;
  turns: TelemetryTurn[];
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchResultBundle {
  engine: "rg" | "git-grep" | null;
  results: SearchMatch[];
  truncated: boolean;
}

/** One shadow-git checkpoint on the workspace chain (newest first). */
export interface CheckpointInfo {
  id: string;
  ts: number;
  label: string;
}

export interface ApprovalFact {
  askedId: string | null;
  runId: string;
  toolCallId: string;
  outcome: ApprovalOutcome | null;
  /** Why the outcome happened; null on legacy decisions. */
  reasonCode?: string | null;
  /** Permission profile in effect when the ask was issued; null on legacy asks. */
  policyProfile?: string | null;
  uiRequestId?: string;
  askedAt?: string;
  decidedAt?: string;
}

export interface TranscriptMarker {
  kind: "compaction";
  entryId: string;
  afterEntryId: string | null;
  ts?: string;
}

/** Projected cross-session edge (@session mention) anchored to a user entry. */
export interface SessionReferenceFact {
  sourceEntryId: string;
  clientMessageId: string;
  targetSessionId: string;
  targetTitle: string;
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  id: string;
  text: string;
  ts: string;
  entryId?: string;
  thinking?: string;
  thinkingDeferred?: boolean;
}

export interface ToolCardSummary {
  toolCallId: string;
  toolName: string;
  status: string;
  kind?: string;
  target?: string;
  argsJson?: string;
  resultText?: string;
  isError?: boolean;
  afterMessageId?: string;
  approval?: ApprovalOutcome;
}

export interface SessionRecord extends SessionSummary {
  messages: SessionMessage[];
  toolCards?: ToolCardSummary[];
  markers?: TranscriptMarker[];
  operations?: TimelineOperation[];
  approvals?: ApprovalFact[];
  references?: SessionReferenceFact[];
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  selected?: boolean;
}

export interface UsageSnapshot {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  input: number;
  output: number;
  total: number;
  cost: number;
}

export interface PromptImage {
  mimeType: string;
  data: string;
}

export interface AgentStateSnapshot {
  ready: boolean;
  cwd: string;
  sessionId: string;
  sessionName: string | null;
  model: Omit<ModelInfo, "selected"> | null;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  supportsThinking: boolean;
  isStreaming: boolean;
  isIdle: boolean;
  isCompacting: boolean;
  usage: UsageSnapshot;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  autoCompaction: boolean;
  autoRetry: boolean;
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalMessages: number;
  };
  modelFallbackMessage: string | null;
  projectTrusted?: boolean;
  queuedMessages?: {
    steering: string[];
    followUp: string[];
    pendingCount: number;
  };
  tree?: SessionTree;
  messages?: SessionMessage[];
  toolCards?: ToolCardSummary[];
  markers?: TranscriptMarker[];
  operations?: TimelineOperation[];
  approvals?: ApprovalFact[];
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  source: "builtin" | "extension" | "prompt" | "skill";
  action: "prompt" | "compact" | "new";
}

export interface AuthProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  source: string | null;
}

export interface AuthStatus {
  providers: AuthProviderStatus[];
  label: string;
  ready: boolean;
}

export interface DesktopWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface DesktopSettings {
  themeMode: "system" | "light" | "dark";
  language: "zh-CN" | "en-US";
  workerCap: number;
  workerIdleTtlMs: number;
  lastSessionId: string | null;
  lastWorkspace: string | null;
  rightPanelOpen: boolean;
  permissionProfile: "trusted" | "workspace-only" | "read-only" | "ask-before-command";
  sessionRecovery: Record<string, { state: string; running: boolean; unread: boolean; error: string | null; retryAttempt?: number; retryMaxAttempts?: number; retryDelayMs?: number; updatedAt: string }>;
  keybindings: { commandPalette: string; newSession: string; abort: string; zoomIn: string; zoomOut: string; zoomReset: string };
  customProviders: Record<string, { id: string; name: string; baseUrl: string; api: string; headers: Record<string, string>; authHeader: boolean; models: Array<Record<string, unknown>> }>;
  windowBounds: DesktopWindowBounds | null;
}

export interface TreeNodeRow {
  id: string;
  parentId: string | null;
  depth: number;
  role: string;
  preview: string;
  isLeaf: boolean;
  label?: string;
}

export interface SessionTree {
  nodes: TreeNodeRow[];
  activePath: string[];
  leafId: string | null;
}

export interface ForkCandidate {
  entryId: string;
  text: string;
}

export type ResourceScope = "user" | "project" | "temporary";
export type ResourceOrigin = "package" | "top-level";

export interface ExtensionResource {
  name: string;
  path: string;
  commands: number;
  tools: number;
  enabled?: boolean;
  scope?: ResourceScope;
  origin?: ResourceOrigin;
  source?: string;
  baseDir?: string;
  dormant?: boolean;
}

export interface SkillResource {
  name: string;
  description: string;
  filePath: string;
  enabled?: boolean;
  scope?: ResourceScope;
  origin?: ResourceOrigin;
  source?: string;
  baseDir?: string;
  disableModelInvocation?: boolean;
  dormant?: boolean;
}

export interface PromptResource {
  name: string;
  description: string;
  argumentHint?: string;
  filePath: string;
  enabled?: boolean;
  scope?: ResourceScope;
  origin?: ResourceOrigin;
  source?: string;
  baseDir?: string;
  dormant?: boolean;
}

export interface ConfiguredPackageInfo {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
}

export interface ResourceBundle {
  extensions: ExtensionResource[];
  skills: SkillResource[];
  prompts: PromptResource[];
  packages?: ConfiguredPackageInfo[];
  projectTrusted?: boolean;
  skillCommandsEnabled?: boolean;
}

export type ExtensionUIKind = "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text";
export type ExtensionUINotifyType = "info" | "warning" | "error";
export type ExtensionUIWidgetPlacement = "aboveEditor" | "belowEditor";

export interface ExtensionUIRequestBase {
  type: "extension_ui_request";
  id: string;
  method: ExtensionUIKind;
  sessionId: string;
  runId: string | null;
  generation: number;
}

export type ExtensionUIRequest =
  | (ExtensionUIRequestBase & { method: "select"; title: string; options: string[]; timeout?: number })
  | (ExtensionUIRequestBase & { method: "confirm"; title: string; message: string; timeout?: number })
  | (ExtensionUIRequestBase & { method: "input"; title: string; placeholder?: string; timeout?: number })
  | (ExtensionUIRequestBase & { method: "editor"; title: string; prefill?: string })
  | (ExtensionUIRequestBase & { method: "notify"; message: string; notifyType?: ExtensionUINotifyType })
  | (ExtensionUIRequestBase & { method: "setStatus"; statusKey: string; statusText?: string })
  | (ExtensionUIRequestBase & { method: "setWidget"; widgetKey: string; widgetLines?: string[]; widgetPlacement?: ExtensionUIWidgetPlacement })
  | (ExtensionUIRequestBase & { method: "setTitle"; title: string })
  | (ExtensionUIRequestBase & { method: "set_editor_text"; text: string });

export type ExtensionUIResponse = {
  type: "extension_ui_response";
  id: string;
  sessionId: string;
  runId: string | null;
  generation: number;
} & ({ value: string } | { confirmed: boolean } | { cancelled: true });

export interface ExtensionUIStatus {
  key: string;
  text: string;
  sessionId: string;
}

export interface ExtensionUIWidget {
  key: string;
  lines: string[];
  placement: ExtensionUIWidgetPlacement;
  sessionId: string;
}

export interface DirEntryInfo {
  name: string;
  isDir: boolean;
  size: number;
}

export interface DirListing {
  path: string;
  entries: DirEntryInfo[];
}

export type UploadConflictMode = "cancel" | "overwrite" | "keep-both";

export interface UploadTargetInfo {
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number | null;
  hash: string | null;
  token: string | null;
}

export interface FileReadResult {
  path: string;
  size: number;
  binary: boolean;
  content?: string;
  truncated?: boolean;
  mimeType?: string;
  dataUrl?: string;
  docx?: boolean;
  safe?: boolean;
  offset?: number;
  nextOffset?: number | null;
  totalLines?: number;
}

export interface GitWorktreeInfo {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  dirty: boolean;
  current: boolean;
  headShort?: string;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  recentCommit?: { hash: string; message: string; timestamp: string };
}

export interface GitWorktreeList {
  repoRoot: string;
  isGitRepo: boolean;
  worktrees: GitWorktreeInfo[];
}

export interface BashResultDTO {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
}

export interface GitSnapshot {
  generatedAt: string;
  repoRoot: string;
  isGitRepo: boolean;
  branch: string;
  log: GitCommitInfo[];
  unstaged: DiffFile[];
  staged: DiffFile[];
  snapshotToken: string;
}

export interface GitApplyResult {
  applied: boolean;
  errors: string[];
}

export interface GitStageItem {
  path: string;
  hunks?: string[];
}

export interface GitStageRequest {
  snapshotToken: string;
  items: GitStageItem[];
}
