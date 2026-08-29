import * as React from "react";
import { ChevronDown, Focus, Workflow, Info, Minimize2, MonitorSmartphone, Moon, MoreHorizontal, Network, Puzzle, Settings, Square, Sun } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Popover } from "../../ui/Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore, type ConnectionState, type ShutdownPhase } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { ThinkingLevel } from "../../types/dto";
import type { ThemeMode } from "../../theme/palettes";
import { useT, useLanguage, translate, type MessageKey, type Language } from "../../lib/i18n";
import { SettingsDialog } from "./SettingsDialog";
import { SessionInfoDialog } from "./SessionInfoDialog";
import { ModelPicker } from "./ModelPicker";
import { ModelCenter } from "./ModelCenter";
import { ResourceCenter } from "./ResourceCenter";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { clickableRole } from "../../lib/a11y";

const THINKING_KEY: Record<ThinkingLevel, MessageKey> = {
  off: "thinking.off",
  minimal: "thinking.minimal",
  low: "thinking.low",
  medium: "thinking.medium",
  high: "thinking.high",
  xhigh: "thinking.xhigh",
  max: "thinking.max",
};

const THEME_KEY: Record<ThemeMode, MessageKey> = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system",
};

interface StatusInputs {
  bootstrapError: string | null;
  workerError: string | null;
  canRetryWorker: boolean;
  shutdownPhase: ShutdownPhase;
  compacting: boolean;
  thinkingActive: boolean;
  connection: ConnectionState;
}

function statusLabelOf(s: StatusInputs, language: Language): string {
  if (s.bootstrapError) return translate(language, "status.initFailed");
  if (s.workerError && s.canRetryWorker) return translate(language, "status.retryable");
  if (s.workerError) return translate(language, "status.workerFailed");
  if (s.shutdownPhase === "closing") return translate(language, "status.closing");
  if (s.shutdownPhase === "flushing") return translate(language, "status.flushing");
  if (s.shutdownPhase === "exiting") return translate(language, "status.exiting");
  if (s.compacting) return translate(language, "status.compacting");
  if (s.thinkingActive) return translate(language, "status.thinking");
  if (s.connection === "running") return translate(language, "status.running");
  if (s.connection === "error") return translate(language, "status.error");
  if (s.connection === "connecting") return translate(language, "status.connecting");
  return translate(language, "status.ready");
}

/** Vertical hairline separating header clusters — grouping is information. */
function Divider(): React.ReactElement {
  return <div className="omega-header-divider" />;
}

function StopIcon(): React.ReactElement {
  return <Square className="omega-icon-14" fill="currentColor" aria-hidden="true" />;
}

function CompressIcon(): React.ReactElement {
  return <Minimize2 className="omega-icon-16" aria-hidden="true" />;
}

function FocusIcon(): React.ReactElement {
  return <Focus className="omega-icon-16" aria-hidden="true" />;
}

function MoreIcon(): React.ReactElement {
  return <MoreHorizontal className="omega-icon-16" aria-hidden="true" />;
}

function ExpandIcon(): React.ReactElement {
  return <ChevronDown className="omega-icon-14" aria-hidden="true" />;
}

function HubIcon(): React.ReactElement {
  return <Workflow className="omega-icon-14" aria-hidden="true" />;
}

function ExtensionIcon(): React.ReactElement {
  return <Puzzle className="omega-icon-14" aria-hidden="true" />;
}

function TreeIcon(): React.ReactElement {
  return <Network className="omega-icon-14" aria-hidden="true" />;
}

function InfoIcon(): React.ReactElement {
  return <Info className="omega-icon-14" aria-hidden="true" />;
}

function SettingsIcon(): React.ReactElement {
  return <Settings className="omega-icon-14" aria-hidden="true" />;
}

function LightModeIcon(): React.ReactElement {
  return <Sun className="omega-icon-14" aria-hidden="true" />;
}

function DarkModeIcon(): React.ReactElement {
  return <Moon className="omega-icon-14" aria-hidden="true" />;
}

function SystemModeIcon(): React.ReactElement {
  return <MonitorSmartphone className="omega-icon-14" aria-hidden="true" />;
}

function ThemeIcon({ mode }: { mode: ThemeMode }): React.ReactElement {
  if (mode === "light") return <LightModeIcon />;
  if (mode === "dark") return <DarkModeIcon />;
  return <SystemModeIcon />;
}

/**
 * Signature element: the ∞ mark is a live instrument. The outer ring spins
 * while a turn runs (slow) or compaction works (fast); the infinity core
 * breathes while the model thinks; idle is perfectly still. Reduced motion
 * freezes everything. The core sits in a recessed instrument well.
 */
export function StatusGlyph({ bootstrapError }: { bootstrapError: string | null }): React.ReactElement {
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const thinkingActive = useAppStore((s) => s.thinkingActive);
  const compacting = useAppStore((s) => s.compacting);
  const workerError = useAppStore((s) => s.workerError);
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);

  const failed = Boolean(bootstrapError) || Boolean(workerError) || connection === "error";
  const language = useLanguage();
  const liveColor =
    failed
      ? "var(--ravel-danger)"
      : shutdownPhase !== "idle"
        ? "var(--ravel-warning)"
        : compacting
          ? "var(--ravel-warning)"
          : "var(--ravel-accent)";
  const label = statusLabelOf({ bootstrapError, workerError, canRetryWorker, shutdownPhase, compacting, thinkingActive, connection }, language);

  const retryWorker = React.useCallback(async () => {
    if (!canRetryWorker) return;
    useAppStore.getState().setConnection("connecting");
    useAppStore.getState().setComposerError("正在重试 Agent worker…");
    const result = await ipc.retryWorker();
    if (!result.ok) {
      useAppStore.getState().setWorkerError(result.message, true);
      useAppStore.getState().setComposerError(`重试失败：${result.message}`);
      useAppStore.getState().setConnection("error");
    }
  }, [canRetryWorker]);

  // Lemniscate (∞) drawn as one continuous path so the stroke reads as a
  // single filament — the workshop-lamp wire, not a typed character.
  const INFINITY_PATH = "M 16 16 C 16 9.5, 25 9.5, 25 16 C 25 22.5, 16 22.5, 16 16 C 16 9.5, 7 9.5, 7 16 C 7 22.5, 16 22.5, 16 16 Z";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="omega-status-glyph" data-omega-glyph={label}>
          <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: "absolute", inset: 0 }}>
            <circle cx="20" cy="20" r="18" fill="none" stroke={failed ? "var(--ravel-danger)" : "var(--ravel-border)"} strokeWidth="1.5" opacity={failed ? 0.9 : 0.7} />
            {(connection === "running" || compacting || shutdownPhase !== "idle") && !failed && (
              <circle
                className={`status-ring ${compacting ? "is-compacting" : "is-running"}`}
                cx="20"
                cy="20"
                r="18"
                fill="none"
                stroke={liveColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="30 83"
                style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
              />
            )}
          </svg>
          <div
            className={`status-core omega-status-core${thinkingActive && !failed ? " is-thinking" : ""}${failed ? " is-failed" : ""}${canRetryWorker ? " is-retryable" : ""}`}
            {...(canRetryWorker ? { ...clickableRole, "aria-label": "重试 Agent worker" } : {})}
            onClick={() => {
              if (canRetryWorker) void retryWorker();
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 32 32"
              aria-hidden
              style={{
                display: "block",
                filter: thinkingActive && !failed ? "drop-shadow(0 0 4px rgba(232, 180, 74, 0.55))" : undefined,
              }}
            >
              <path d={INFINITY_PATH} fill="none" stroke={failed ? "var(--ravel-danger)" : thinkingActive || connection === "running" || compacting ? liveColor : "var(--ravel-text-muted)"} strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{`状态：${label}${bootstrapError || workerError ? `（${bootstrapError ?? workerError}）` : ""}`}</TooltipContent>
    </Tooltip>
  );
}

/** Compact context gauge: recessed instrument dial with threshold ticks. */
export function ContextDonut({ percent }: { percent: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = clamped >= 85 ? "var(--ravel-danger)" : clamped >= 65 ? "var(--ravel-warning)" : "var(--ravel-accent)";
  // Threshold ticks at 65% (warning) and 85% (danger) — the dial carries its own redlines.
  const tickAngle = (pct: number) => (pct / 100) * 360 - 90;
  const tickPoint = (pct: number, r1: number, r2: number) => {
    const a = (tickAngle(pct) * Math.PI) / 180;
    return {
      x1: 12 + r1 * Math.cos(a),
      y1: 12 + r1 * Math.sin(a),
      x2: 12 + r2 * Math.cos(a),
      y2: 12 + r2 * Math.sin(a),
    };
  };
  const warnTick = tickPoint(65, 10.2, 12);
  const dangerTick = tickPoint(85, 10.2, 12);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="omega-donut">
          <svg width="24" height="24" viewBox="0 0 24 24">
            <line {...warnTick} stroke="var(--ravel-border-strong)" strokeWidth="1" strokeLinecap="round" opacity={clamped < 65 ? 0.9 : 0.35} />
            <line {...dangerTick} stroke="var(--ravel-danger)" strokeWidth="1" strokeLinecap="round" opacity={clamped < 85 ? 0.55 : 1} />
            <circle cx="12" cy="12" r={radius} fill="none" stroke="var(--ravel-border)" strokeWidth="3" opacity="0.9" />
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
              transform="rotate(-90 12 12)"
              style={{ transition: "stroke-dasharray var(--ravel-dur-slow) var(--ravel-ease-out, cubic-bezier(0.22,1,0.36,1)), stroke var(--ravel-dur-normal) var(--ravel-ease-out)" }}
            />
          </svg>
          <span className="mono-num omega-donut-label">{Math.round(clamped)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{`上下文已用 ${Math.round(clamped)}%`}</TooltipContent>
    </Tooltip>
  );
}

function formatUsage(_percent: number | null, tokens: number | null, contextWindow: number | null): string {
  if (tokens !== null && contextWindow) return `${tokens}/${contextWindow}`;
  if (contextWindow) return `${contextWindow} ctx`;
  return "暂无数据";
}

export function Header(): React.ReactElement {
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const bootstrapError = useAppStore((s) => s.bootstrapError);
  const focusMode = useAppStore((s) => s.layout.focusMode);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const agent = useAppStore((s) => s.agent);
  const running = useAppStore((s) => s.connection === "running");
  const compacting = useAppStore((s) => s.compacting);
  const thinkingActive = useAppStore((s) => s.thinkingActive);
  const shuttingDown = shutdownPhase !== "idle";
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);
  const workerError = useAppStore((s) => s.workerError);
  const extensionTitle = useAppStore((s) => s.extensionTitle);
  const setAgent = useAppStore((s) => s.setAgent);
  const setConnection = useAppStore((s) => s.setConnection);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const t = useT();
  const language = useLanguage();

  const [thinkingAnchor, setThinkingAnchor] = React.useState<HTMLElement | null>(null);
  const settingsOpen = useAppStore((s) => s.layout.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setModelCenterOpen = useAppStore((s) => s.setModelCenterOpen);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [modelAnchor, setModelAnchor] = React.useState<HTMLElement | null>(null);
  const [utilityAnchor, setUtilityAnchor] = React.useState<HTMLElement | null>(null);
  const [busy, setBusy] = React.useState(false);

  const modelLabel = agent?.model ? agent.model.id : "未选模型";
  const usagePercent = agent?.usage.percent ?? null;
  const usageLabel = formatUsage(usagePercent, agent?.usage.tokens ?? null, agent?.usage.contextWindow ?? null);
  const thinkingLevels = agent?.thinkingLevels?.length
    ? agent.thinkingLevels
    : (["off", "minimal", "low", "medium", "high"] as ThinkingLevel[]);
  const nextTheme: ThemeMode = themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
  const thinkingDisabled = shuttingDown || agent?.supportsThinking === false;
  const failed = Boolean(bootstrapError) || Boolean(workerError);
  const statusTone = failed ? "is-failed" : shuttingDown || compacting ? "is-busy" : running ? "is-running" : "is-ready";

  const statusLabel = statusLabelOf({ bootstrapError, workerError, canRetryWorker, shutdownPhase, compacting, thinkingActive, connection }, language);
  const sessionTitle = workerError ? "Worker 未就绪" : extensionTitle || agent?.sessionName || "新会话";

  const handleAbort = React.useCallback(async () => {
    if (shuttingDown) return;
    setBusy(true);
    try {
      await ipc.abort();
      setConnection("ready");
    } finally {
      setBusy(false);
    }
  }, [setConnection, shuttingDown]);

  const handleCompact = React.useCallback(async () => {
    if (shuttingDown) return;
    setBusy(true);
    try {
      const res = await ipc.compact();
      if (res.ok) setAgent(res.data);
    } finally {
      setBusy(false);
    }
  }, [setAgent, shuttingDown]);

  const handleSetThinking = React.useCallback(
    async (level: ThinkingLevel) => {
      if (shuttingDown) return;
      setThinkingAnchor(null);
      const res = await ipc.setThinkingLevel({ level });
      if (res.ok) setAgent(res.data);
    },
    [setAgent, shuttingDown],
  );

  return (
    <header className="omega-header">
      <StatusGlyph bootstrapError={bootstrapError} />
      <div className="omega-header-identity">
        <div className="omega-header-title" title={sessionTitle}>{sessionTitle}</div>
        <div className={`mono-num omega-header-status ${statusTone}`}>{statusLabel}</div>
      </div>

      <Divider />

      <ProjectSwitcher />

      <Divider />

      <div className="omega-header-model-cluster">
        <div
          className={shuttingDown ? "omega-header-model is-disabled" : "omega-header-model"}
          {...(shuttingDown ? {} : clickableRole)}
          onClick={(e) => {
            if (!shuttingDown) setModelAnchor(e.currentTarget);
          }}
        >
          <span className="omega-header-model-label">{modelLabel}</span>
          <ExpandIcon />
        </div>
        <button
          type="button"
          className="omega-header-thinking"
          disabled={thinkingDisabled}
          aria-disabled={thinkingDisabled}
          onClick={(e) => {
            if (thinkingDisabled) return;
            setThinkingAnchor(e.currentTarget);
          }}
        >
          {t(THINKING_KEY[agent?.thinkingLevel ?? "off"])}
        </button>
        <ModelPicker anchor={modelAnchor} onClose={() => setModelAnchor(null)} />
        <ModelCenter />
        <ResourceCenter />
        <Popover
          open={Boolean(thinkingAnchor)}
          anchor={thinkingAnchor}
          onOpenChange={(next) => { if (!next) setThinkingAnchor(null); }}
          ariaLabel="思考深度"
          className="omega-header-menu"
        >
          {thinkingLevels.map((level) => (
            <button
              type="button"
              key={level}
              className="omega-menu-item"
              aria-pressed={agent?.thinkingLevel === level}
              onClick={() => void handleSetThinking(level)}
            >
              {t(THINKING_KEY[level])}
            </button>
          ))}
        </Popover>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="omega-header-usage">
            <ContextDonut percent={usagePercent ?? 0} />
            <span className="mono-num omega-header-usage-label">{usageLabel}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{`上下文 ${usageLabel}`}</TooltipContent>
      </Tooltip>

      {canRetryWorker ? (
        <Button
          size="sm"
          className="omega-button-danger-soft"
          onClick={() => {
            void (async () => {
              setBusy(true);
              useAppStore.getState().setConnection("connecting");
              useAppStore.getState().setComposerError("正在重试 Agent worker…");
              const result = await ipc.retryWorker();
              if (!result.ok) {
                useAppStore.getState().setWorkerError(result.message, true);
                useAppStore.getState().setComposerError(`重试失败：${result.message}`);
                useAppStore.getState().setConnection("error");
              }
              setBusy(false);
            })();
          }}
          disabled={busy}
        >
          重试 Worker
        </Button>
      ) : running ? (
        <Button size="sm" className="omega-button-danger-soft" leading={<StopIcon />} onClick={() => void handleAbort()} disabled={busy}>
          停止
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton size="sm" label="压缩上下文" onClick={() => void handleCompact()} disabled={busy || compacting}>
              <CompressIcon />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>压缩上下文</TooltipContent>
        </Tooltip>
      )}

      <div className="omega-header-spacer" />

      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            active={focusMode}
            label={focusMode ? "退出专注模式" : "进入专注模式"}
            onClick={toggleFocusMode}
          >
            <FocusIcon />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>{focusMode ? "退出专注模式" : "专注模式"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton size="sm" label="更多工作台操作" onClick={(e) => setUtilityAnchor(e.currentTarget)}>
            <MoreIcon />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>更多工作台操作</TooltipContent>
      </Tooltip>
      <Popover
        open={Boolean(utilityAnchor)}
        anchor={utilityAnchor}
        onOpenChange={(next) => { if (!next) setUtilityAnchor(null); }}
        ariaLabel="更多工作台操作"
        className="omega-header-menu"
      >
        <button type="button" className="omega-menu-item" onClick={() => { setUtilityAnchor(null); setModelCenterOpen(true); }} disabled={shuttingDown}>
          <HubIcon />模型中心
        </button>
        <button type="button" className="omega-menu-item" aria-label="打开资源中心" onClick={() => { setUtilityAnchor(null); useAppStore.getState().setResourceCenterOpen(true); }} disabled={shuttingDown}>
          <ExtensionIcon />资源中心
        </button>
        <button type="button" className="omega-menu-item" onClick={(e) => { setUtilityAnchor(null); setThemeMode(nextTheme, { x: e.clientX, y: e.clientY }); }}>
          <ThemeIcon mode={themeMode} />{t("menu.theme")}：{t(THEME_KEY[themeMode])}
        </button>
        <div className="omega-menu-separator" />
        <button type="button" className="omega-menu-item" onClick={() => { setUtilityAnchor(null); if (!running) setTreeOpen(true); }} disabled={running}>
          <TreeIcon />会话分支树
        </button>
        <button type="button" className="omega-menu-item" onClick={() => { setUtilityAnchor(null); setInfoOpen(true); }}>
          <InfoIcon />会话信息 / 导出
        </button>
        <button type="button" className="omega-menu-item" onClick={() => { setUtilityAnchor(null); setSettingsOpen(true); }}>
          <SettingsIcon />设置
        </button>
      </Popover>
      <SessionInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
