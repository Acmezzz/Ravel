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

// ===== Histos =====

export type HistosJsonValue =
  | null
  | boolean
  | number
  | string
  | HistosJsonValue[]
  | { [key: string]: HistosJsonValue };

export type HistosSourceSet = { [key: string]: HistosJsonValue };
export type HistosFactSourceType =
  | "session_entry"
  | "session_span"
  | "operation"
  | "tool"
  | "approval"
  | "file"
  | "skill"
  | "mcp_config"
  | "checkpoint"
  | "graph_revision"
  | "flow_revision"
  | "context_set"
  | "web_resource"
  | "agent_spec"
  | "agent_run"
  | "eval_result";
export type HistosLens = "structural" | "semantic" | "mixed";
export type HistosGranularity = "operation" | "entry" | "span" | "file" | "cluster";

export interface HistosQueryDTO {
  sourceSet: HistosSourceSet;
  lens: HistosLens;
  granularity: HistosGranularity;
}

export type HistosFactSelector =
  | { kind: "span"; start: number; length: number }
  | { kind: "hunk"; startLine: number; endLine: number }
  | { kind: "json_path"; path: string }
  | { kind: "node"; nodeRevisionId: string }
  | { kind: "edge"; edgeRevisionId: string };

export type HistosFactAddress = {
  sourceType: HistosFactSourceType;
  objectId: string;
  revisionId: string;
  selector?: HistosFactSelector;
};

export interface HistosEvidenceDTO {
  revisionId: string;
  addressId: string;
  role: string;
  address?: HistosFactAddress;
}

export interface HistosTraceAnchorDTO {
  sessionId: string;
  entryId?: string;
  toolCallId?: string;
  assistantEntryId?: string;
  resultEntryId?: string;
}

export interface HistosNodeRevisionDTO {
  nodeRevisionId: string;
  nodeId: string;
  kind: string;
  title: string | null;
  createdAt: number;
  artifactSha: string | null;
  anchor?: HistosTraceAnchorDTO;
  parentId?: string | null;
}

export interface HistosEdgeRevisionDTO {
  edgeRevisionId: string;
  edgeId: string;
  srcNodeId: string;
  dstNodeId: string;
  kind: string;
  createdAt: number;
  artifactSha: string | null;
  anchor?: HistosTraceAnchorDTO;
}

export interface HistosRevisionParentDTO {
  childId: string;
  parentId: string;
}

export interface HistosGraphDTO extends HistosQueryDTO {
  workspaceId?: string;
  schemaVersion?: number;
  nodes: HistosNodeRevisionDTO[];
  edges: HistosEdgeRevisionDTO[];
  evidence: HistosEvidenceDTO[];
  parents: HistosRevisionParentDTO[];
  diagnostics?: Array<{ line: number; code: string; message: string }>;
}

export type HistosSelection = string | {
  nodeRevisionId?: string;
  edgeRevisionId?: string;
  id?: string;
};

export type HistosGetGraphRequest = HistosQueryDTO;

export type HistosSpecSurface = "session" | "invocation" | "child" | "workflow";
export type HistosSpecExecutor = "agent-loop" | "skill-inject" | "orchestrator" | "flow-engine";
export type HistosSpecTrust = "draft" | "reviewed" | "approved";

export interface HistosListCapabilitiesRequest {
  names?: string[];
}

/** Public projection of a materialized agent capability/spec node. */
export interface HistosCapabilityDTO {
  name: string;
  nodeId: string;
  revisionId: string;
  surface: HistosSpecSurface;
  executor: HistosSpecExecutor;
  trust: HistosSpecTrust;
  wired: boolean;
}

export interface HistosInvokeNodeRequest {
  nodeId: string;
  revisionId?: string;
  prompt?: string;
  args?: HistosJsonValue;
  dryRun?: boolean;
}

export interface HistosInvocationPlanUnit {
  key: string;
  spec: string;
  tools: string[];
  model?: string;
  prompt: string;
  dependsOn?: string[];
  maxConcurrency?: number;
}

export interface HistosInvocationPlanDTO {
  specName: string;
  specRevisionId: string | null;
  surface: HistosSpecSurface;
  executor: HistosSpecExecutor;
  trust: HistosSpecTrust;
  wired: boolean;
  dryRun: boolean;
  tools: string[];
  droppedTools: string[];
  budget: Partial<Record<"maxSteps" | "maxRuntimeMs" | "maxTokens", number>>;
  completion: "human-review" | "evidence" | "round-cap" | null;
  maxConcurrency: number;
  maxDepth: number;
  units: HistosInvocationPlanUnit[] | null;
  waves: HistosInvocationPlanUnit[][] | null;
  memoKey: string;
}

export type HistosInvokeNodeResultDTO =
  | { ok: true; plan: HistosInvocationPlanDTO; nodeId: string; execution?: HistosInvocationExecutionDTO }
  | { ok: false; code: string; message: string; diagnostics: Array<{ code: string; message: string }> };

/** Present only when a non-dry-run invocation actually executed through the worker. */
export interface HistosInvocationExecutionDTO {
  status?: string;
  ok?: boolean;
  uncertain?: boolean;
  sessionId?: string | null;
  error?: string | null;
  output?: string | null;
}

export interface HistosAgentSpecInput {
  name: string;
  description: string;
  strategy?: "single" | "parallel" | "chain";
  model?: string;
  prompt?: string;
  tools?: string[];
  maxConcurrency?: number;
  maxDepth?: number;
  steps?: Array<{ spec: string; prompt?: string; maxConcurrency?: number }>;
}
export interface HistosAgentRunInput {
  specName: string;
  specRevisionId: string;
  strategy: string;
  input?: string;
  ok?: boolean;
  aborted?: boolean;
  timedOut?: boolean;
  completedCount?: number;
  unitCount?: number;
  units?: Array<{ key?: string; sessionId?: string; text?: string; endedAt?: number }>;
}
export interface HistosApplyWebResourcesRequest {
  urls?: string[];
  resources?: Array<Record<string, unknown>>;
  granularity?: "entry" | "span";
  timeoutMs?: number;
  chunkLength?: number;
}
export interface HistosApplyWebResourcesResultDTO {
  nodeCount: number;
  edgeCount: number;
  diagnostics: Array<{ code: string; message: string }>;
}
export interface HistosApplyAgentActivityRequest {
  specs?: HistosAgentSpecInput[];
  runs?: HistosAgentRunInput[];
}
export interface HistosApplyAgentActivityResultDTO {
  nodeCount: number;
  edgeCount: number;
}
export interface HistosEvalResultInput {
  evalSet: string;
  groupKey: string;
  testName: string;
  file: string;
  harness: string;
  baseline: string;
  candidates: string[];
  repetition: number;
  outcome: "scored" | "unscored" | "skipped" | "pending" | "errored";
  score?: number;
  totalTokens?: number;
  totalMs?: number;
  estimatedCostUsd?: number;
}
export interface HistosApplyEvalResultsRequest { results: HistosEvalResultInput[] }
export interface HistosApplyEvalResultsResultDTO {
  nodeCount: number;
  edgeCount: number;
  artifactCount: number;
  sha256s: string[];
}
export interface HistosCondenseGraphRequest extends HistosQueryDTO {
  budget?: number;
  parentSha?: string;
}
export interface HistosExecuteFlowRequest { sha256: string }
export type HistosExecuteFlowResultDTO = {
  ok: true;
  flowSha: string;
  operationId: string;
} | {
  ok: false;
  code:
    | "approval_required"
    | "validation_failed"
    | "session_mismatch"
    | "session_busy";
};
export interface HistosCondenseGraphResultDTO {
  ok: boolean;
  code?: string;
  sha256?: string;
  artifact?: HistosArtifactDTO;
  diagnostics: Array<{ code: string; message: string }>;
}
export interface HistosRebuildRequest extends HistosQueryDTO {
  maxFiles?: number;
}
export interface HistosGetNodeRequest extends HistosQueryDTO {
  nodeId: string;
}
export interface HistosFreezeContextRequest extends HistosQueryDTO {
  selection: HistosSelection[];
  targetSessionId?: string;
  budget?: number;
}
export interface HistosConvertToFlowRequest extends HistosQueryDTO {
  selectedNodeRevisionIds?: string[];
  selectedEdgeRevisionIds?: string[];
  parentSha?: string;
}
export interface HistosGetArtifactRequest extends HistosQueryDTO {
  sha256: string;
}

export interface HistosArtifactDTO extends HistosQueryDTO {
  schemaVersion: number;
  workspaceId: string;
  kind: "graph_revision" | "flow_revision" | "context_set" | "view_state";
  nodes: HistosNodeRevisionDTO[];
  edges: HistosEdgeRevisionDTO[];
  evidence: HistosEvidenceDTO[];
  parents: HistosRevisionParentDTO[];
  neighborSummaries?: Array<Pick<HistosNodeRevisionDTO, "nodeRevisionId" | "nodeId" | "kind" | "title" | "createdAt" | "artifactSha"> & { parentId?: string | null }>;
  selection?: HistosEvidenceDTO[];
  sha256?: string;
  positions?: Array<{ id: string; x: number; y: number }>;
}

export interface HistosFactAppendResultDTO {
  ok: boolean;
  error?: string;
}

export interface HistosRebuildResultDTO {
  workspaceId?: string;
  nodeCount: number;
  edgeCount: number;
  artifactCount: number;
}

export type HistosContextFreezeResultDTO = {
  ok?: true;
  sha256: string;
  artifact: HistosArtifactDTO;
  targetSessionId: string | null;
  diagnostics?: Array<{ code: string; message: string }>;
  budget?: { budget: number; selectedBytes: number; neighborCount: number; omittedNeighborCount: number };
  factAppend?: HistosFactAppendResultDTO;
} | {
  ok: false;
  code: "budget_exceeded" | "selection_not_found";
  message: string;
  diagnostics: Array<{ code: string; message: string }>;
  result: { action: string; message: string; budget?: number; minimumBudget?: number; missingSelection?: string[]; breakdown?: { condensedTextBytes: number; directEvidenceBytes: number; selectedStructureBytes: number } };
};

export interface HistosFlowValidationDTO {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface HistosConvertToFlowResultDTO {
  sha256: string;
  artifact: HistosArtifactDTO;
  validation: HistosFlowValidationDTO;
}

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
  scope: "user" | "project";
  enabled: boolean;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  hasAuth?: boolean;
  /** OAuth login config (B5); needsAuth is computed against the credential vault. */
  auth?: { clientId: string; scopes: string[] };
  needsAuth?: boolean;
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

export interface PtyDataDTO {
  sessionId: string;
  chunk: string;
  sequence: number;
  isFinal: boolean;
}

export interface PtyExitDTO {
  sessionId: string;
  exitCode: number | null;
  signal: number | null;
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
  /** Session mode + goal continuation state (B2); absent on older workers. */
  mode?: "default" | "plan" | "goal";
  goal?: { rounds: number; elapsedMs: number } | null;
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
  modeProfile: "default" | "plan" | "goal";
  sessionRecovery: Record<string, { state: string; running: boolean; unread: boolean; error: string | null; retryAttempt?: number; retryMaxAttempts?: number; retryDelayMs?: number; updatedAt: string }>;
  keybindings: { commandPalette: string; newSession: string; abort: string; zoomIn: string; zoomOut: string; zoomReset: string };
  customProviders: Record<string, { id: string; name: string; baseUrl: string; api: string; headers: Record<string, string>; authHeader: boolean; models: Array<Record<string, unknown>> }>;
  windowBounds: DesktopWindowBounds | null;
}

/** Plan-mode review surface (next-cycle B1). The path is main-derived. */
export interface PlanReviewResult {
  path: string | null;
  exists: boolean;
  content: string;
}

/** Persistent per-tool permission rule row (next-cycle B3). */
export interface PermissionRuleRow {
  id: string;
  scope: "user" | "project";
  permission: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
}

/** Remote skill registry index entry (next-cycle B6). */
export interface RegistryEntry {
  name: string;
  url: string;
  description?: string;
}

/** One concurrently-staged registry entry; per-entry errors are non-blocking. */
export interface RegistryStagedResult {
  name: string;
  filename?: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  error?: string;
  code?: string;
}

/** Scheduled Flow trigger config (next-cycle B8); fires are flow_trigger facts. */
export interface FlowScheduleRow {
  id: string;
  flowSha: string;
  kind: "interval" | "daily";
  intervalMinutes?: number;
  timeOfDay?: string;
  maxRuns: number;
  runCount: number;
  lastFiredAt: number | null;
  enabled: boolean;
  createdAt: number;
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
  /** SHA-256 of the skill file; path/name stay stable across overwrites. */
  contentHash?: string;
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

/**
 * Fact-graph triple shape (adapted from the oh-my-pi Mnemopi Triple model).
 * One FactTriple is the atomic unit of the Histos fact graph — a normalized
 * `(subject, predicate, object)` edge with a time window, source, and
 * confidence. The graph is the secondary index over the durable session
 * JSONL fact stream; the JSONL is the source of truth.
 */
export interface HistosFactTripleDTO {
  id?: string;
  subject: string;
  predicate: string;
  object: string;
  source: string;
  scope?: string;
  tag?: string | null;
  confidence?: number;
  validFrom?: number | null;
  validUntil?: number | null;
  createdAt?: number;
}

export interface HistosFactQueryDTO {
  subject?: string;
  predicate?: string;
  object?: string;
  scope?: string;
  tag?: string;
  asOf?: number;
  limit?: number;
}

export interface HistosFactStatsDTO {
  tripleCount: number;
  distinctSubjects: number;
  distinctPredicates: number;
  lastWriteAt?: string;
}

export interface HistosFactQueryResultDTO {
  ok: boolean;
  triples: HistosFactTripleDTO[];
  code?: string;
  message?: string;
}

export interface HistosFactWriteResultDTO {
  ok: boolean;
  count: number;
  code?: string;
  message?: string;
}

export interface HistosFactClearResultDTO {
  ok: boolean;
  count: number;
  code?: string;
  message?: string;
}

export interface HistosFactEventDTO {
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * P0 traceability: archive (tombstone, reversible) / restore (revoke) /
 * purge (physical erase) requests and results. targetKind is the schema
 * closed set; purge results name the owning sessions for content that
 * still lives in a session JSONL.
 */
export type HistosTombstoneTargetKind = "triple" | "node" | "edge" | "artifact" | "session_index";

export interface HistosEntriesRequestDTO {
  kind: HistosTombstoneTargetKind;
  ids: string[];
  reason?: string;
}

export interface HistosArchiveResultDTO {
  ok: boolean;
  targetKind: HistosTombstoneTargetKind;
  archivedCount: number;
  archived: string[];
  skippedCount: number;
  code?: string;
  message?: string;
}

export interface HistosRestoreRequestDTO {
  tombstoneIds: string[];
}

export interface HistosRestoreResultDTO {
  ok: boolean;
  restoredCount: number;
  restored: Array<{ tombstoneId: string; targetKind: HistosTombstoneTargetKind; targetId: string }>;
  notFound: string[];
  code?: string;
  message?: string;
}

export interface HistosPurgeResultDTO {
  ok: boolean;
  targetKind: HistosTombstoneTargetKind;
  purgedCount: number;
  purged: string[];
  sessions?: string[];
  hint?: string;
  purgeFact?: { targetKind: HistosTombstoneTargetKind; targetIds: string[]; reason?: string };
  purgeRecord?: { ok: boolean; error?: string };
  code?: string;
  message?: string;
}

/** P4 repo source: scan limits only; the repository root is Main-resolved. */
export interface HistosIndexRepoRequestDTO {
  maxFiles?: number;
  maxDepth?: number;
}

export interface HistosIndexRepoResultDTO {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  diagnostics: Array<{ code?: string; message: string }>;
  code?: string;
  message?: string;
}
