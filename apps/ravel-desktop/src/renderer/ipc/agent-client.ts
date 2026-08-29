import type {
  IpcResult,
  PromptImage,
  AgentStateSnapshot,
  ThinkingLevel,
  SlashCommandInfo,
  AuthStatus,
  DesktopSettings,
  PlanReviewResult,
  PermissionRuleRow,
  TelemetrySnapshot,
  SearchResultBundle,
  ModelInfo,
} from "../types/dto";
import type { PromptSessionReference } from "./utils";
import { ok } from "./utils";

/** Agent-runtime, model, auth, commands, plan/permissions, and window controls. */
export const agentClient = {
  prompt: async (text: string, behavior?: "steer" | "followUp", images?: PromptImage[], clientMessageId?: string, references?: PromptSessionReference[]): Promise<IpcResult<void>> =>
    ok(await window.omega?.prompt?.(text, behavior, images, clientMessageId, references)),
  abort: async (): Promise<IpcResult<void>> => ok(await window.omega?.abort?.()),
  onTransport: (callback: (data: { state: string; error?: string; canRetry?: boolean; sessionId?: string; foreground?: boolean }) => void): (() => void) =>
    window.omega?.onTransport?.(callback) ?? (() => {}),
  onStatus: (callback: (data: unknown) => void): (() => void) => window.omega?.onStatus?.(callback) ?? (() => {}),
  onEvent: (callback: (data: unknown) => void): (() => void) => window.omega?.onEvent?.(callback) ?? (() => {}),
  updateSettings: async (req: {
    steeringMode?: "all" | "one-at-a-time";
    followUpMode?: "all" | "one-at-a-time";
    autoCompaction?: boolean;
    autoRetry?: boolean;
  }): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.updateSettings?.(req)),
  clearQueue: async (): Promise<IpcResult<{ steering: string[]; followUp: string[] }>> =>
    ok(await window.omega?.clearQueue?.()),
  getThinking: async (req: { entryId: string }): Promise<IpcResult<{ text: string | null }>> =>
    ok(await window.omega?.getThinking?.(req)),
  getToolDetail: async (req: { toolCallId: string }): Promise<IpcResult<{ toolCallId: string; toolName?: string; argsJson?: string; resultText?: string; isError?: boolean }>> => ok(await window.omega?.getToolDetail?.(req)),
  telemetry: async (): Promise<IpcResult<TelemetrySnapshot>> => ok(await window.omega?.telemetry?.()),
  projectSearch: async (req: { query: string }): Promise<IpcResult<SearchResultBundle>> => ok(await window.omega?.projectSearch?.(req)),
  recentEvents: async (req: { sessionId?: string; after: number; runtimeEpoch?: number }): Promise<IpcResult<{ events: Array<{ event: unknown; meta: unknown }>; gap: boolean; first: number; last: number; nextAfter?: number | null; runtimeEpoch?: number }>> => ok(await window.omega?.recentEvents?.(req)),
  sessionReady: async (): Promise<IpcResult<{ ready: boolean }>> =>
    ok(await window.omega?.sessionReady?.()),
  retryWorker: async (): Promise<IpcResult<{ state: string; sessionId?: string; cwd?: string }>> => ok(await window.omega?.retryWorker?.()),
  getState: async (): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.getState?.()),
  listModels: async (): Promise<IpcResult<ModelInfo[]>> => ok(await window.omega?.listModels?.()),
  setModel: async (req: { provider: string; modelId: string }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setModel?.(req)),
  setThinkingLevel: async (req: { level: ThinkingLevel }): Promise<IpcResult<AgentStateSnapshot>> =>
    ok(await window.omega?.setThinkingLevel?.(req)),
  listCommands: async (): Promise<IpcResult<SlashCommandInfo[]>> => ok(await window.omega?.listCommands?.()),
  compact: async (): Promise<IpcResult<AgentStateSnapshot>> => ok(await window.omega?.compact?.()),
  authStatus: async (): Promise<IpcResult<AuthStatus>> => ok(await window.omega?.authStatus?.()),
  setProviderApiKey: async (req: { providerId: string; apiKey: string }): Promise<IpcResult<AuthStatus>> =>
    ok(await window.omega?.setProviderApiKey?.(req)),
  removeProviderApiKey: async (req: { providerId: string }): Promise<IpcResult<AuthStatus>> =>
    ok(await window.omega?.removeProviderApiKey?.(req)),
  configureCustomProvider: async (req: Record<string, unknown>): Promise<IpcResult<{ provider: Record<string, unknown>; models: ModelInfo[] }>> => ok(await window.omega?.configureCustomProvider?.(req)),
  getSystemPrompt: async (): Promise<IpcResult<{ systemPrompt: string }>> => ok(await window.omega?.getSystemPrompt?.()),
  getDesktopSettings: async (): Promise<IpcResult<DesktopSettings>> => ok(await window.omega?.getDesktopSettings?.()),
  updateDesktopSettings: async (req: Partial<DesktopSettings>): Promise<IpcResult<DesktopSettings>> =>
    ok(await window.omega?.updateDesktopSettings?.(req)),
  setPermissionProfile: async (req: { profile: DesktopSettings["permissionProfile"] }): Promise<IpcResult<DesktopSettings>> =>
    ok(await window.omega?.setPermissionProfile?.(req)),
  setModeProfile: async (req: { mode: DesktopSettings["modeProfile"] }): Promise<IpcResult<{ modeProfile: DesktopSettings["modeProfile"] }>> =>
    ok(await window.omega?.setModeProfile?.(req)),
  planReview: async (): Promise<IpcResult<PlanReviewResult>> => ok(await window.omega?.planReview?.()),
  approvePlan: async (): Promise<IpcResult<{ mode: string }>> => ok(await window.omega?.approvePlan?.()),
  permissionRulesList: async (): Promise<IpcResult<{ items: PermissionRuleRow[] }>> => ok(await window.omega?.permissionRulesList?.()),
  permissionRulesAdd: async (req: { permission: string; pattern: string; action: "allow" | "ask" | "deny"; project?: boolean }): Promise<IpcResult<{ items: PermissionRuleRow[] }>> =>
    ok(await window.omega?.permissionRulesAdd?.(req)),
  permissionRulesRemove: async (req: { id: string; scope: "user" | "project" }): Promise<IpcResult<{ items: PermissionRuleRow[] }>> =>
    ok(await window.omega?.permissionRulesRemove?.(req)),
  minimize: async (): Promise<IpcResult<void>> => ok(await window.omega?.minimize?.()),
  toggleMaximize: async (): Promise<IpcResult<{ maximized: boolean }>> => ok(await window.omega?.toggleMaximize?.()),
  closeWindow: async (): Promise<IpcResult<void>> => ok(await window.omega?.closeWindow?.()),
  isMaximized: async (): Promise<IpcResult<{ maximized: boolean }>> => ok(await window.omega?.isMaximized?.()),
  onWindowStateChanged: (callback: (data: { maximized: boolean }) => void): (() => void) =>
    window.omega?.onWindowStateChanged?.(callback) ?? (() => {}),
};

export type AgentClient = typeof agentClient;