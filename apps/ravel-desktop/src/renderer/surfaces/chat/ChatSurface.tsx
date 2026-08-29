/**
 * 任务五：Chat 表面组合根。
 *
 * 组合：会话侧栏（SessionSidebar，复用 SessionList/ActivityList）+
 * 中央消息流与 Composer（复用 ChatPanel，其内部即 ChatTranscript + ChatComposer）+
 * 上下文抽屉（会话上下文占用 / Git 快照 / 权限 / 连接与 worker 重试）。
 *
 * 采用“有意义地复用 ChatPanel”的非另起灶策略：不复制一套相互矛盾的消息布局，
 * ChatPanel 既有的 message start/end、text/thinking delta、tool states、compaction、
 * abort/retry、optimistic、空态均原样保留，只在此层叠加表面的会话侧栏与上下文抽屉。
 */
import * as React from "react";
import { Bot, Database, GitBranch, RefreshCw, SquareTerminal, TriangleAlert } from "lucide-react";
import { Button } from "../../ui/Button";
import { ChatPanel } from "../../components/chat/ChatPanel";
import { SessionSidebar } from "./SessionSidebar";
import { useChatSurface } from "./useChatSurface";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";

const BORDER = "var(--ravel-border)";
const BG = "var(--ravel-bg-panel)";
const MUTED = "var(--ravel-text-muted)";
const DIM = "var(--ravel-text-dim)";
const ACCENT = "var(--ravel-accent)";
const WARNING = "var(--ravel-warning)";
const DANGER = "var(--ravel-danger)";
const SUCCESS = "var(--ravel-success)";
const SELECTED = "var(--ravel-selected)";

function connectionLabel(connection: string): string {
  switch (connection) {
    case "connecting":
      return "连接中…";
    case "ready":
      return "就绪";
    case "running":
      return "生成中";
    case "closing":
      return "关闭中";
    case "error":
      return "异常";
    default:
      return connection;
  }
}

/** 权限模式的可见状态：受限/不可用给出可见警告，闭环“无权限”可见性要求。 */
function permissionChip(mode: string, available: boolean): { label: string; color: string } {
  if (!available) return { label: "无可用权限", color: DANGER };
  if (mode === "restricted") return { label: "受限模式", color: WARNING };
  if (mode === "elevated") return { label: "提权模式", color: ACCENT };
  return { label: "默认权限", color: SUCCESS };
}

/**
 * 顶部可见状态条：透明地展示 worker 重连/错误（可重试）与受限/无权限。
 */
function ChatStatusStrip(): React.ReactElement | null {
  const workerError = useAppStore((s) => s.workerError);
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);
  const permission = useAppStore((s) => s.permission);
  const setConnection = useAppStore((s) => s.setConnection);
  const setWorkerError = useAppStore((s) => s.setWorkerError);
  const setComposerError = useAppStore((s) => s.setComposerError);
  const [retrying, setRetrying] = React.useState(false);

  const retry = React.useCallback(async () => {
    if (!canRetryWorker || retrying) return;
    setRetrying(true);
    setConnection("connecting");
    setComposerError("正在重试 Agent worker…");
    const result = await ipc.retryWorker();
    if (!result.ok) {
      setWorkerError(result.message, true);
      setComposerError(`重试失败：${result.message}`);
      setConnection("error");
    }
    setRetrying(false);
  }, [canRetryWorker, retrying, setConnection, setComposerError, setWorkerError]);

  const chips: Array<{ key: string; text: string; color: string }> = [];
  if (workerError) chips.push({ key: "worker", text: workerError, color: DANGER });
  if (permission) {
    const chip = permissionChip(permission.mode, permission.available);
    chips.push({ key: "permission", text: chip.label, color: chip.color });
  }
  if (chips.length === 0) return null;

  return (
    <div
      className="ravel-chat-status-strip"
      role="status"
      aria-live="polite"
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "6px 12px",
        borderBottom: `1px solid ${BORDER}`,
        fontSize: "0.6875rem",
        color: MUTED,
        background: "var(--ravel-bg-rail)",
      }}
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="omega-chip"
          style={{ color: chip.color, borderColor: chip.color }}
          title={chip.key === "permission" && permission ? permission.note : undefined}
        >
          {chip.text}
        </span>
      ))}
      {canRetryWorker ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void retry()}
          disabled={retrying}
        >
          {retrying ? "重试中…" : "重连 Agent worker"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 上下文抽屉：把会话上下文占用 / Git 快照 / 权限 / 连接与 worker 重连收敛为一个
 * 可折叠侧栏，并以 --ravel-* 着色。
 */
function ContextDrawer(): React.ReactElement {
  const v = useChatSurface();
  const [open, setOpen] = React.useState(false);

  const connectionColor =
    v.connection === "error" || v.workerError
      ? DANGER
      : v.connection === "running" || v.compacting
        ? WARNING
        : v.connection === "ready"
          ? SUCCESS
          : MUTED;

  const usagePct = v.context.percent;
  const usageText = v.context.tokens !== null && v.context.contextWindow
    ? `${v.context.tokens} / ${v.context.contextWindow}`
    : v.context.contextWindow
      ? `${v.context.contextWindow} ctx`
      : "暂无数据";

  const dirtyCount =
    (v.gitSnapshot?.staged?.length ?? 0) + (v.gitSnapshot?.unstaged?.length ?? 0);

  const permission = v.permission
    ? permissionChip(v.permission.mode, v.permission.available)
    : null;

  if (!open) {
    return (
      <button
        type="button"
        className="ravel-chat-context-rail"
        aria-label="展开上下文抽屉"
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          paddingInline: 6,
          borderLeft: `1px solid ${BORDER}`,
          background: "var(--ravel-bg-rail)",
          cursor: "pointer",
          color: "inherit",
          font: "inherit",
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Database size={16} aria-hidden="true" style={{ color: ACCENT }} />
      </button>
    );
  }

  return (
    <aside
      className="ravel-chat-context-drawer"
      aria-label="上下文抽屉"
      style={{
        width: 264,
        minWidth: 264,
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: BG,
        borderLeft: `1px solid ${BORDER}`,
      }}
    >
      <div
        className="ravel-chat-context-header"
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          borderBottom: `1px solid ${BORDER}`,
          fontSize: "0.6875rem",
          fontWeight: 600,
          color: MUTED,
        }}
      >
        <span className="overline-label" style={{ margin: 0 }}>上下文</span>
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)} aria-label="收起上下文抽屉">
          收起
        </Button>
      </div>

      <div className="ravel-chat-context-body" style={{ minHeight: 0, flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 上下文占用 */}
        <section className="omega-context-section">
          <div className="overline-label" style={{ margin: 0 }}>上下文占用</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--ravel-border)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, usagePct ?? 0))}%`, height: "100%", background: usagePct !== null && usagePct >= 90 ? DANGER : ACCENT }} />
            </div>
            <span className="mono-num" style={{ fontSize: "0.6875rem", color: MUTED }}>
              {usagePct !== null ? `${usagePct}%` : "—"}
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "0.6875rem", color: DIM }}>
            {usageText}
            {v.context.total ? ` · ${v.context.input} in / ${v.context.output} out` : ""}
          </p>
        </section>

        {/* Git 快照 */}
        <section className="omega-context-section">
          <div className="overline-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <GitBranch size={12} aria-hidden="true" /> Git 工作区
          </div>
          {v.gitSnapshot?.isGitRepo ? (
            <>
              <p style={{ margin: "4px 0 0", fontSize: "0.6875rem", color: MUTED }}>
                分支：<span className="mono-num">{v.gitSnapshot.branch}</span>
                <span style={{ color: dirtyCount > 0 ? WARNING : SUCCESS }}> · {dirtyCount > 0 ? `${dirtyCount} 处变更` : "干净"}</span>
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "0.65625rem", color: DIM }} title={v.gitSnapshot.repoRoot}>
                {v.gitSnapshot.repoRoot}
              </p>
            </>
          ) : (
            <p style={{ margin: "4px 0 0", fontSize: "0.6875rem", color: DIM }}>非 Git 仓库</p>
          )}
        </section>

        {/* 权限 */}
        <section className="omega-context-section">
          <div className="overline-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <Bot size={12} aria-hidden="true" /> 权限
          </div>
          {permission ? (
            <>
              <p style={{ margin: "4px 0 0", fontSize: "0.6875rem", color: permission.color }}>
                {permission.label}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "0.65625rem", color: DIM }}>
                {v.permission?.toolsAllowed?.length
                  ? `可用工具：${v.permission.toolsAllowed.length}`
                  : v.permission?.available
                    ? "工具集受限"
                    : "未建立可用权限"}
              </p>
            </>
          ) : (
            <p style={{ margin: "4px 0 0", fontSize: "0.6875rem", color: DIM }}>暂无权限信息</p>
          )}
        </section>

        {/* 连接 / Worker */}
        <section className="omega-context-section">
          <div className="overline-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <SquareTerminal size={12} aria-hidden="true" /> Agent
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "0.6875rem", color: connectionColor }}>
            连接：{connectionLabel(v.connection)}
            {v.compacting ? " · 压缩中" : ""}
          </p>
          {v.workerError ? (
            <p style={{ margin: "4px 0 0", fontSize: "0.65625rem", color: DANGER, display: "flex", alignItems: "flex-start", gap: 4 }}>
              <TriangleAlert size={12} aria-hidden="true" style={{ marginTop: 2, flex: "0 0 auto" }} />
              <span style={{ minWidth: 0 }}>{v.workerError}</span>
            </p>
          ) : null}
          {v.canRetryWorker ? (
            <p style={{ margin: "4px 0 0" }}>
              <Button size="sm" variant="outline" onClick={() => {
                useAppStore.setState({ canRetryWorker: false });
                void (async () => {
                  useAppStore.getState().setConnection("connecting");
                  useAppStore.getState().setComposerError("正在重试 Agent worker…");
                  const result = await ipc.retryWorker();
                  if (!result.ok) {
                    useAppStore.getState().setWorkerError(result.message, true);
                    useAppStore.getState().setComposerError(`重试失败：${result.message}`);
                    useAppStore.getState().setConnection("error");
                  }
                })();
              }}>
                <RefreshCw size={12} aria-hidden="true" /> 重连 Agent worker
              </Button>
            </p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}

export function ChatSurface(): React.ReactElement {
  const v = useChatSurface();
  return (
    <div
      className="ravel-chat-surface"
      data-surface="chat-chat"
      data-busy={v.busy ? "true" : "false"}
      data-empty={v.empty ? "true" : "false"}
      style={{ display: "flex", width: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", background: BG }}
    >
      <SessionSidebar />
      <div
        className="ravel-chat-stage"
        style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, flex: "1 1 auto" }}
      >
        <ChatStatusStrip />
        {/* ChatPanel 即中央流 + Composer（其内部为 ChatTranscript + ChatComposer）。 */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: "1 1 auto", background: SELECTED }}>
          <ChatPanel />
        </div>
      </div>
      <ContextDrawer />
    </div>
  );
}