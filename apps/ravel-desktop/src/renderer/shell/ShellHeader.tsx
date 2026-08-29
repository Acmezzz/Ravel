import * as React from "react";
import {
  ChevronDown,
  GitBranch,
  Info,
  Layers,
  Minimize2,
  Moon,
  MoreHorizontal,
  Network,
  Puzzle,
  Settings,
  Square,
  Sun,
  MonitorSmartphone,
} from "lucide-react";
import { Button, IconButton } from "../ui/Button";
import { Popover } from "../ui/Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/Tooltip";
import { useAppStore } from "../store/useAppStore";
import { ipc } from "../ipc/client";
import type { ThinkingLevel } from "../types/dto";
import type { ThemeMode } from "../theme/palettes";
import { clickableRole } from "../lib/a11y";
import { ContextDonut, StatusGlyph } from "../components/layout/Header";
import { ModelPicker } from "../components/layout/ModelPicker";
import { ModelCenter } from "../components/layout/ModelCenter";
import { ResourceCenter } from "../components/layout/ResourceCenter";
import { SettingsDialog } from "../components/layout/SettingsDialog";
import { SessionInfoDialog } from "../components/layout/SessionInfoDialog";
import { ShellSurfaceTabs } from "./ShellSurfaceTabs";

const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "思考 off",
  minimal: "思考 minimal",
  low: "思考 low",
  medium: "思考 medium",
  high: "思考 high",
  xhigh: "思考 xhigh",
  max: "思考 max",
};

/**
 * The shell's single chrome row (44px).
 *
 * This replaces the previous stack of three bars (TitleBar + a tabs row + the
 * legacy Header). Everything that used to live in those bars now lives here in
 * one band: identity (monogram / Ravel / workspace / branch), the segmented
 * surface switcher in the optical centre, and the Agent control cluster
 * (status glyph, model, thinking depth, context gauge, compact/stop, focus,
 * theme, more) plus the guarded window controls.
 *
 * All Agent actions keep calling through `ipc` exactly as before — no new
 * Renderer capability is introduced, and the drag region excludes controls.
 */
export function ShellHeader(): React.ReactElement {
  const agent = useAppStore((s) => s.agent);
  const branch = useAppStore((s) => s.gitSnapshot?.branch ?? null);
  const dirtyCount = useAppStore(
    (s) => (s.gitSnapshot?.staged?.length ?? 0) + (s.gitSnapshot?.unstaged?.length ?? 0),
  );
  const bootstrapError = useAppStore((s) => s.bootstrapError);
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const compacting = useAppStore((s) => s.compacting);
  const running = useAppStore((s) => s.connection === "running");
  const themeMode = useAppStore((s) => s.themeMode);
  const settingsOpen = useAppStore((s) => s.layout.settingsOpen);

  const setAgent = useAppStore((s) => s.setAgent);
  const setConnection = useAppStore((s) => s.setConnection);
  const setWorkerError = useAppStore((s) => s.setWorkerError);
  const setComposerError = useAppStore((s) => s.setComposerError);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setModelCenterOpen = useAppStore((s) => s.setModelCenterOpen);

  const [maximized, setMaximized] = React.useState(false);
  const [modelAnchor, setModelAnchor] = React.useState<HTMLElement | null>(null);
  const [thinkingAnchor, setThinkingAnchor] = React.useState<HTMLElement | null>(null);
  const [utilityAnchor, setUtilityAnchor] = React.useState<HTMLElement | null>(null);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void ipc.isMaximized().then((res) => {
      if (res.ok) setMaximized(res.data.maximized);
    });
    return ipc.onWindowStateChanged((data) => setMaximized(Boolean(data?.maximized)));
  }, []);

  const workspaceLabel = React.useMemo(() => {
    const cwd = agent?.cwd;
    if (!cwd) return "";
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? cwd;
  }, [agent?.cwd]);

  const modelLabel = agent?.model ? agent.model.id : "未选模型";
  const usagePercent = agent?.usage.percent ?? null;
  const usageLabel =
    agent?.usage.tokens != null && agent?.usage.contextWindow
      ? `${agent.usage.tokens}/${agent.usage.contextWindow}`
      : agent?.usage.contextWindow
        ? `${agent.usage.contextWindow} ctx`
        : "暂无数据";
  const thinkingLevels: ThinkingLevel[] = agent?.thinkingLevels?.length
    ? agent.thinkingLevels
    : ["off", "minimal", "low", "medium", "high"];
  const thinkingDisabled = shutdownPhase !== "idle" || agent?.supportsThinking === false;
  const nextTheme: ThemeMode = themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
  const ThemeIcon = themeMode === "light" ? Sun : themeMode === "dark" ? Moon : MonitorSmartphone;

  const retryWorker = React.useCallback(async () => {
    if (!canRetryWorker) return;
    setBusy(true);
    setConnection("connecting");
    setComposerError("正在重试 Agent worker…");
    const result = await ipc.retryWorker();
    if (!result.ok) {
      setWorkerError(result.message, true);
      setComposerError(`重试失败：${result.message}`);
      setConnection("error");
    }
    setBusy(false);
  }, [canRetryWorker, setComposerError, setConnection, setWorkerError]);

  const handleAbort = React.useCallback(async () => {
    if (shutdownPhase !== "idle") return;
    setBusy(true);
    try {
      await ipc.abort();
      setConnection("ready");
    } finally {
      setBusy(false);
    }
  }, [setConnection, shutdownPhase]);

  const handleCompact = React.useCallback(async () => {
    if (shutdownPhase !== "idle") return;
    setBusy(true);
    try {
      const res = await ipc.compact();
      if (res.ok) setAgent(res.data);
    } finally {
      setBusy(false);
    }
  }, [setAgent, shutdownPhase]);

  const handleSetThinking = React.useCallback(
    async (level: ThinkingLevel) => {
      if (shutdownPhase !== "idle") return;
      setThinkingAnchor(null);
      const res = await ipc.setThinkingLevel({ level });
      if (res.ok) setAgent(res.data);
    },
    [setAgent, shutdownPhase],
  );

  return (
    <header className="ravel-titlebar" style={dragStyle} data-shell-header>
      <div className="ravel-titlebar-identity">
        <span className="ravel-titlebar-mark" aria-hidden="true">R</span>
        <span className="ravel-titlebar-brand">Ravel</span>
        <span className="ravel-titlebar-rule" aria-hidden="true" />
        {workspaceLabel ? (
          <span className="ravel-titlebar-workspace" title={agent?.cwd ?? workspaceLabel}>
            {workspaceLabel}
          </span>
        ) : null}
        {branch ? (
          <span className="ravel-titlebar-chip" title={`当前分支：${branch}`}>
            <GitBranch size={11} strokeWidth={1.9} aria-hidden="true" />
            {branch}
          </span>
        ) : null}
        {dirtyCount > 0 ? (
          <span className="ravel-titlebar-chip is-dirty" title={`${dirtyCount} 个未提交变更`}>
            {dirtyCount} 个未提交变更
          </span>
        ) : null}
      </div>

      <div className="ravel-titlebar-center" style={noDragStyle}>
        <ShellSurfaceTabs />
      </div>

      <div className="ravel-titlebar-actions" style={noDragStyle}>
        <StatusGlyph bootstrapError={bootstrapError} />

        <div
          className={shutdownPhase !== "idle" ? "ravel-titlebar-pill is-disabled" : "ravel-titlebar-pill"}
          {...(shutdownPhase !== "idle" ? {} : clickableRole)}
          onClick={(event) => {
            if (shutdownPhase !== "idle") return;
            setModelAnchor(event.currentTarget);
          }}
        >
          <span className="ravel-titlebar-pill-label">{modelLabel}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
        </div>
        <ModelPicker anchor={modelAnchor} onClose={() => setModelAnchor(null)} />

        <button
          type="button"
          className="ravel-titlebar-pill is-ghost"
          disabled={thinkingDisabled}
          aria-disabled={thinkingDisabled}
          onClick={(event) => {
            if (thinkingDisabled) return;
            setThinkingAnchor(event.currentTarget);
          }}
        >
          {THINKING_LABEL[agent?.thinkingLevel ?? "off"]}
        </button>
        <Popover
          open={Boolean(thinkingAnchor)}
          anchor={thinkingAnchor}
          onOpenChange={(next) => {
            if (!next) setThinkingAnchor(null);
          }}
          ariaLabel="思考深度"
          className="ravel-titlebar-menu"
        >
          {thinkingLevels.map((level) => (
            <button
              key={level}
              type="button"
              className="ravel-titlebar-menu-item"
              aria-pressed={agent?.thinkingLevel === level}
              onClick={() => void handleSetThinking(level)}
            >
              {THINKING_LABEL[level]}
            </button>
          ))}
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="ravel-titlebar-usage">
              <ContextDonut percent={usagePercent ?? 0} />
              <span className="mono-num ravel-titlebar-usage-label">{usageLabel}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>{`上下文 ${usageLabel}`}</TooltipContent>
        </Tooltip>

        {canRetryWorker ? (
          <Button size="sm" className="ravel-titlebar-danger" onClick={() => void retryWorker()} disabled={busy}>
            重试 Worker
          </Button>
        ) : running ? (
          <Button
            size="sm"
            className="ravel-titlebar-danger"
            leading={<Square size={12} strokeWidth={0} fill="currentColor" aria-hidden="true" />}
            onClick={() => void handleAbort()}
            disabled={busy}
          >
            停止
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                size="sm"
                label="压缩上下文"
                className="ravel-titlebar-icon"
                onClick={() => void handleCompact()}
                disabled={busy || compacting}
              >
                <Minimize2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{compacting ? "压缩中…" : "压缩上下文"}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              size="sm"
              label="切换主题"
              className="ravel-titlebar-icon"
              onClick={(event) => setThemeMode(nextTheme, { x: event.clientX, y: event.clientY })}
            >
              <ThemeIcon size={15} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>{`主题：${themeMode === "light" ? "浅色" : themeMode === "dark" ? "深色" : "跟随系统"}`}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              size="sm"
              label="更多工作台操作"
              className="ravel-titlebar-icon"
              onClick={(event) => setUtilityAnchor(event.currentTarget)}
            >
              <MoreHorizontal size={15} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>更多操作</TooltipContent>
        </Tooltip>
        <Popover
          open={Boolean(utilityAnchor)}
          anchor={utilityAnchor}
          onOpenChange={(next) => {
            if (!next) setUtilityAnchor(null);
          }}
          ariaLabel="更多工作台操作"
          className="ravel-titlebar-menu"
        >
          <button
            type="button"
            className="ravel-titlebar-menu-item"
            onClick={() => {
              setUtilityAnchor(null);
              setModelCenterOpen(true);
            }}
            disabled={shutdownPhase !== "idle"}
          >
            <Layers size={14} strokeWidth={1.8} aria-hidden="true" />
            模型中心
          </button>
          <button
            type="button"
            className="ravel-titlebar-menu-item"
            aria-label="打开资源中心"
            onClick={() => {
              setUtilityAnchor(null);
              useAppStore.getState().setResourceCenterOpen(true);
            }}
            disabled={shutdownPhase !== "idle"}
          >
            <Puzzle size={14} strokeWidth={1.8} aria-hidden="true" />
            资源中心
          </button>
          <button
            type="button"
            className="ravel-titlebar-menu-item"
            onClick={() => {
              setUtilityAnchor(null);
              if (!running) setTreeOpen(true);
            }}
            disabled={running}
          >
            <Network size={14} strokeWidth={1.8} aria-hidden="true" />
            会话分支树
          </button>
          <button
            type="button"
            className="ravel-titlebar-menu-item"
            onClick={() => {
              setUtilityAnchor(null);
              setInfoOpen(true);
            }}
          >
            <Info size={14} strokeWidth={1.8} aria-hidden="true" />
            会话信息 / 导出
          </button>
          <div className="ravel-titlebar-menu-sep" />
          <button
            type="button"
            className="ravel-titlebar-menu-item"
            onClick={() => {
              setUtilityAnchor(null);
              setSettingsOpen(true);
            }}
          >
            <Settings size={14} strokeWidth={1.8} aria-hidden="true" />
            设置
          </button>
        </Popover>

        <span className="ravel-titlebar-rule" aria-hidden="true" />

        <div className="ravel-titlebar-window">
          <button type="button" className="ravel-window-btn" aria-label="最小化窗口" title="最小化" onClick={() => void ipc.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button
            type="button"
            className="ravel-window-btn"
            aria-label={maximized ? "向下还原窗口" : "最大化窗口"}
            title={maximized ? "还原" : "最大化"}
            onClick={() => void ipc.toggleMaximize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button type="button" className="ravel-window-btn is-close" aria-label="关闭窗口" title="关闭" onClick={() => void ipc.closeWindow()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
        </div>
      </div>

      <ModelCenter />
      <ResourceCenter />
      <SessionInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
