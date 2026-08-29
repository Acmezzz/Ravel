/**
 * 任务五：Chat Surface 的会话视图派生 hook。
 *
 * Chat 表面（会话侧栏 / 上下文抽屉 / 顶部状态）不应各自散拉全局 store，这里把
 * store 的会话列表、连接/worker、权限、Git 快照、上下文占用与消息计数收敛为一个
 * 稳定的会话视图对象，供 surfaces/chat/* 复用。
 *
 * 有意的取舍：此处不订阅 `messages`/`toolCards`/`markers`/`operations` 的完整内容，
 * 只订阅 `messages.length` 这一标量。因为 ChatSurface 是 ChatPanel/Composer 的父节点，
 * 订阅消息体内容会让整个表面（含笨重的 Composer）在每个流式 delta 时重绘，破坏
 * “80 tok/s 不全局重绘”目标。逐 token 的流式与工具卡细节仍由 MessageBubble/
 * ToolCard/MessageList/Composer 通过细粒度 selector 自取。
 */
import * as React from "react";
import { useAppStore, type ConnectionState } from "../../store/useAppStore";
import type {
  AgentPermissionState,
  GitSnapshot,
  SessionSummary,
} from "../../types/dto";

export interface ChatContextUsage {
  percent: number | null;
  tokens: number | null;
  contextWindow: number | null;
  input: number;
  output: number;
  total: number;
}

export interface ChatSurfaceView {
  activeSessionId: string | null;
  sessions: SessionSummary[];
  /** 会话微状态（后台 running/unread/compacting/failed）。 */
  sessionActivity: Record<string, { running: boolean; unread: boolean; compacting: boolean; failed: boolean }>;
  connection: ConnectionState;
  thinkingActive: boolean;
  compacting: boolean;
  retrying: boolean;
  workerError: string | null;
  canRetryWorker: boolean;
  composerError: string | null;
  permission: AgentPermissionState | null;
  gitSnapshot: GitSnapshot | null;
  context: ChatContextUsage;
  messageCount: number;
  empty: boolean;
  busy: boolean;
}

/**
 * 把全局 store 收敛为 Chat 表面用会话视图。
 *
 * 返回对象每次渲染都是新引用，因此只适合在 ChatSurface / SessionSidebar /
 * 上下文抽屉这些低频、非流式热区里用；不要在逐 token 刷新的子组件里用。
 */
export function useChatSurface(): ChatSurfaceView {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionActivity = useAppStore((s) => s.sessionActivity);
  const connection = useAppStore((s) => s.connection);
  const thinkingActive = useAppStore((s) => s.thinkingActive);
  const compacting = useAppStore((s) => s.compacting);
  const retrying = useAppStore((s) => s.retrying);
  const workerError = useAppStore((s) => s.workerError);
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);
  const composerError = useAppStore((s) => s.composerError);
  const permission = useAppStore((s) => s.permission);
  const gitSnapshot = useAppStore((s) => s.gitSnapshot);
  const agent = useAppStore((s) => s.agent);
  const messageCount = useAppStore((s) => s.messages.length);

  const context = React.useMemo<ChatContextUsage>(
    () => ({
      percent: agent?.usage.percent ?? null,
      tokens: agent?.usage.tokens ?? null,
      contextWindow: agent?.usage.contextWindow ?? null,
      input: agent?.usage.input ?? 0,
      output: agent?.usage.output ?? 0,
      total: agent?.usage.total ?? 0,
    }),
    [agent],
  );

  const empty = messageCount === 0;
  const busy = connection === "running" || thinkingActive || compacting || retrying;

  return {
    activeSessionId,
    sessions,
    sessionActivity,
    connection,
    thinkingActive,
    compacting,
    retrying,
    workerError,
    canRetryWorker,
    composerError,
    permission,
    gitSnapshot,
    context,
    messageCount,
    empty,
    busy,
  };
}