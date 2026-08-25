import * as React from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import KeyboardArrowRight from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowLeft from "@mui/icons-material/KeyboardArrowLeft";
import StopIcon from "@mui/icons-material/Stop";
import CompressIcon from "@mui/icons-material/Compress";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import { useAppStore, type ConnectionState, type ShutdownPhase } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { ThinkingLevel } from "../../types/dto";
import type { ThemeMode } from "../../theme/palettes";
import { SettingsDialog } from "./SettingsDialog";
import { SessionInfoDialog } from "./SessionInfoDialog";
import { ModelPicker } from "./ModelPicker";
import { ModelCenter } from "./ModelCenter";
import { ResourceCenter } from "./ResourceCenter";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { clickableRole } from "../../lib/a11y";

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "思考 off",
  minimal: "思考 min",
  low: "思考 low",
  medium: "思考 mid",
  high: "思考 high",
  xhigh: "思考 xhigh",
  max: "思考 max",
};

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
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

function statusLabelOf(s: StatusInputs): string {
  if (s.bootstrapError) return "初始化失败";
  if (s.workerError && s.canRetryWorker) return "可重试";
  if (s.workerError) return "Worker 失败";
  if (s.shutdownPhase === "closing") return "正在停止";
  if (s.shutdownPhase === "flushing") return "保存会话";
  if (s.shutdownPhase === "exiting") return "正在退出";
  if (s.compacting) return "压缩中";
  if (s.thinkingActive) return "思考中";
  if (s.connection === "running") return "运行中";
  if (s.connection === "error") return "错误";
  if (s.connection === "connecting") return "连接中";
  return "就绪";
}

/** Vertical hairline separating header clusters — grouping is information. */
function Divider(): React.ReactElement {
  return (
    <Box
      sx={{
        width: "1px",
        height: 20,
        alignSelf: "center",
        background: "var(--omega-border-strong)",
        opacity: 0.55,
        flex: "0 0 auto",
      }}
    />
  );
}

/**
 * Signature element: the ∞ mark is a live instrument. The outer ring spins
 * while a turn runs (slow) or compaction works (fast); the infinity core
 * breathes while the model thinks; idle is perfectly still. Reduced motion
 * freezes everything. The core sits in a recessed instrument well.
 */
function StatusGlyph({ bootstrapError }: { bootstrapError: string | null }): React.ReactElement {
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const thinkingActive = useAppStore((s) => s.thinkingActive);
  const compacting = useAppStore((s) => s.compacting);
  const workerError = useAppStore((s) => s.workerError);
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);

  const failed = Boolean(bootstrapError) || Boolean(workerError) || connection === "error";
  const liveColor =
    failed
      ? "var(--omega-danger)"
      : shutdownPhase !== "idle"
        ? "var(--omega-warning)"
        : compacting
          ? "var(--omega-warning)"
          : "var(--omega-accent)";
  const label = statusLabelOf({ bootstrapError, workerError, canRetryWorker, shutdownPhase, compacting, thinkingActive, connection });

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
    <Tooltip title={`状态：${label}${bootstrapError || workerError ? `（${bootstrapError ?? workerError}）` : ""}`}>
      <Box
        data-omega-glyph={label}
        sx={{
          position: "relative",
          width: 40,
          height: 40,
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
        }}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: "absolute", inset: 0 }}>
          <circle cx="20" cy="20" r="18" fill="none" stroke={failed ? "var(--omega-danger)" : "var(--omega-border)"} strokeWidth="1.5" opacity={failed ? 0.9 : 0.7} />
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
        <Box
          className={`status-core ${thinkingActive && !failed ? "is-thinking" : ""}`}
          {...(canRetryWorker ? clickableRole : {})}
          aria-label={canRetryWorker ? "重试 Agent worker" : `当前状态：${label}`}
          onClick={() => {
            if (canRetryWorker) void retryWorker();
          }}
          sx={{
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            borderRadius: "9px",
            border: `1px solid ${failed ? "var(--omega-danger)" : "var(--omega-border-strong)"}`,
            background: "var(--omega-bg-soft)",
            boxShadow: `${canRetryWorker ? "var(--omega-inset-highlight)" : "var(--omega-inset-recessed)"}`,
            transition: "transform 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), box-shadow 140ms var(--omega-ease-out)",
            cursor: canRetryWorker ? "pointer" : "default",
            "&:hover": canRetryWorker ? { transform: "translateY(-0.5px)", boxShadow: "var(--omega-shadow-sm), var(--omega-inset-highlight)" } : undefined,
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
            <path d={INFINITY_PATH} fill="none" stroke={failed ? "var(--omega-danger)" : thinkingActive || connection === "running" || compacting ? liveColor : "var(--omega-text-muted)"} strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </Box>
      </Box>
    </Tooltip>
  );
}

/** Compact context gauge: recessed instrument dial with threshold ticks. */
function ContextDonut({ percent }: { percent: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = clamped >= 85 ? "var(--omega-danger)" : clamped >= 65 ? "var(--omega-warning)" : "var(--omega-accent)";
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
    <Tooltip title={`上下文已用 ${Math.round(clamped)}%`}>
      <Box sx={{ position: "relative", width: 24, height: 24, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
        <svg width="24" height="24" viewBox="0 0 24 24">
          <line {...warnTick} stroke="var(--omega-border-strong)" strokeWidth="1" strokeLinecap="round" opacity={clamped < 65 ? 0.9 : 0.35} />
          <line {...dangerTick} stroke="var(--omega-danger)" strokeWidth="1" strokeLinecap="round" opacity={clamped < 85 ? 0.55 : 1} />
          <circle cx="12" cy="12" r={radius} fill="none" stroke="var(--omega-border)" strokeWidth="3" opacity="0.9" />
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
            style={{ transition: "stroke-dasharray 400ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), stroke 200ms var(--omega-ease-out)" }}
          />
        </svg>
        <Typography className="mono-num" sx={{ fontSize: 7.5, fontWeight: 700, color: "var(--omega-text-muted)", position: "absolute" }}>
          {Math.round(clamped)}
        </Typography>
      </Box>
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
  const rightOpen = useAppStore((s) => s.layout.rightPanelOpen);
  const leftOpen = useAppStore((s) => s.layout.leftPanelOpen);
  const focusMode = useAppStore((s) => s.layout.focusMode);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel);
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
  const ThemeIcon = themeMode === "light" ? LightModeIcon : themeMode === "dark" ? DarkModeIcon : SettingsBrightnessIcon;

  const statusLabel = statusLabelOf({ bootstrapError, workerError, canRetryWorker, shutdownPhase, compacting, thinkingActive, connection });
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

  const iconBtnSx = { color: "var(--omega-text-muted)" } as const;

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        background: "var(--omega-bg-rail)",
        border: "none",
        borderBottom: "1px solid var(--omega-border)",
      }}
    >
      <Toolbar
        sx={{
          gap: 1,
          px: 1.5,
          minHeight: 54,
          flexWrap: { xs: "wrap", md: "nowrap" },
          overflow: { xs: "auto", md: "hidden" },
        }}
      >
        {/* identity cluster */}
        <StatusGlyph bootstrapError={bootstrapError} />
        <Box sx={{ minWidth: 0, flex: "0 1 auto", maxWidth: 180 }}>
          <Typography sx={{ fontWeight: 650, fontSize: 14, lineHeight: 1.2, color: "var(--omega-text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sessionTitle}>
            {sessionTitle}
          </Typography>
          <Typography
            className="mono-num"
            sx={{
              fontSize: 10.5,
              lineHeight: 1.3,
              color:
                bootstrapError || workerError
                  ? "var(--omega-danger)"
                  : shuttingDown || compacting
                    ? "var(--omega-warning)"
                    : running
                      ? "var(--omega-accent-strong)"
                      : "var(--omega-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {statusLabel}
          </Typography>
        </Box>

        <Divider />

        <ProjectSwitcher />

        <Divider />

        {/* model cluster */}
        <Box
          {...(shuttingDown ? {} : clickableRole)}
          onClick={(e) => {
            if (!shuttingDown) setModelAnchor(e.currentTarget);
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1.25,
            height: 30,
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: 220,
            borderRadius: "9px",
            border: "1px solid var(--omega-border)",
            background: "var(--omega-bg-soft)",
            boxShadow: "var(--omega-inset-highlight)",
            cursor: shuttingDown ? "default" : "pointer",
            opacity: shuttingDown ? 0.55 : 1,
            transition: "background-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), border-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), opacity 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), transform 140ms var(--omega-ease-out), box-shadow 140ms var(--omega-ease-out)",
            "&:hover": shuttingDown ? undefined : { borderColor: "var(--omega-accent-line)", background: "var(--omega-accent-soft)", transform: "translateY(-0.5px)", boxShadow: "var(--omega-shadow-sm), var(--omega-inset-highlight)" },
          }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: "var(--omega-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {modelLabel}
          </Typography>
          <ExpandMoreIcon sx={{ fontSize: 15, color: "var(--omega-text-muted)", flex: "0 0 auto" }} />
        </Box>
        <Chip
          size="small"
          label={THINKING_LABEL[agent?.thinkingLevel ?? "off"]}
          onClick={(e) => {
            if (shuttingDown || agent?.supportsThinking === false) return;
            setThinkingAnchor(e.currentTarget);
          }}
          aria-disabled={shuttingDown || agent?.supportsThinking === false}
          sx={{
            cursor: shuttingDown || agent?.supportsThinking === false ? "default" : "pointer",
            pointerEvents: shuttingDown || agent?.supportsThinking === false ? "none" : "auto",
            opacity: shuttingDown || agent?.supportsThinking === false ? 0.5 : 1,
            fontSize: 10.5,
            height: 24,
            flex: "0 0 auto",
            border: "1px solid var(--omega-border)",
            background: "var(--omega-bg-soft)",
            color: "var(--omega-text-muted)",
            "&:hover": shuttingDown || agent?.supportsThinking === false ? undefined : { borderColor: "var(--omega-accent-line)", color: "var(--omega-accent)" },
          }}
        />
        <ModelPicker anchor={modelAnchor} onClose={() => setModelAnchor(null)} />
        <ModelCenter />
        <ResourceCenter />
        <Menu anchorEl={thinkingAnchor} open={Boolean(thinkingAnchor)} onClose={() => setThinkingAnchor(null)}>
          {thinkingLevels.map((level) => (
            <MenuItem key={level} selected={agent?.thinkingLevel === level} onClick={() => void handleSetThinking(level)}>
              {THINKING_LABEL[level] ?? level}
            </MenuItem>
          ))}
        </Menu>

        {/* data cluster */}
        <Tooltip title={`上下文 ${usageLabel}`}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 0.25, flex: "0 0 auto" }}>
            <ContextDonut percent={usagePercent ?? 0} />
            <Typography className="mono-num" sx={{ fontSize: 10.5, color: "var(--omega-text-muted)", display: { xs: "none", md: "block" } }}>
              {usageLabel}
            </Typography>
          </Box>
        </Tooltip>

        {/* action cluster */}
        {canRetryWorker ? (
          <Button
            size="small"
            color="error"
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
            sx={{ textTransform: "none", borderRadius: "999px", px: 1.75, flex: "0 0 auto" }}
          >
            重试 Worker
          </Button>
        ) : running ? (
          <Button
            size="small"
            startIcon={<StopIcon sx={{ fontSize: 15 }} />}
            onClick={() => void handleAbort()}
            disabled={busy}
            sx={{
              textTransform: "none",
              borderRadius: "999px",
              px: 1.75,
              fontWeight: 600,
              flex: "0 0 auto",
              color: "var(--omega-danger)",
              background: "var(--omega-danger-soft)",
              border: "1px solid transparent",
              transition: "background-color 140ms var(--omega-ease-out), border-color 140ms var(--omega-ease-out), transform 140ms var(--omega-ease-out), box-shadow 140ms var(--omega-ease-out)",
              "&:hover": { background: "var(--omega-danger-soft)", borderColor: "var(--omega-danger)", transform: "translateY(-0.5px)", boxShadow: "0 0 12px rgba(240, 117, 132, 0.25)" },
              "&:active": { transform: "translateY(0.5px)" },
            }}
          >
            停止
          </Button>
        ) : (
          <Tooltip title="压缩上下文">
            <span style={{ flex: "0 0 auto" }}>
              <IconButton size="small" onClick={() => void handleCompact()} disabled={busy || compacting} sx={iconBtnSx}>
                <CompressIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Box sx={{ flexGrow: 1, minWidth: 0 }} />

        {/* utility cluster */}
        <Tooltip title={focusMode ? "退出 Focus Mode" : "Focus Mode"}>
          <IconButton size="small" onClick={toggleFocusMode} sx={{ ...iconBtnSx, color: focusMode ? "var(--omega-accent)" : iconBtnSx.color }}>
            <CenterFocusStrongIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={leftOpen ? "收起左栏" : "展开左栏"}>
          <IconButton size="small" aria-label={leftOpen ? "收起左侧导航" : "展开左侧导航"} aria-expanded={leftOpen} aria-controls="omega-left-drawer" onClick={toggleLeftPanel} sx={iconBtnSx}>
            <MenuOpenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={rightOpen ? "收起右栏" : "展开右栏"}>
          <IconButton size="small" aria-label={rightOpen ? "收起右侧面板" : "展开右侧面板"} aria-expanded={rightOpen} aria-controls="omega-right-drawer" onClick={toggleRightPanel} sx={iconBtnSx}>
            {rightOpen ? <KeyboardArrowRight /> : <KeyboardArrowLeft />}
          </IconButton>
        </Tooltip>
        <Tooltip title="更多工作台操作">
          <IconButton size="small" onClick={(e) => setUtilityAnchor(e.currentTarget)} sx={iconBtnSx}>
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={utilityAnchor} open={Boolean(utilityAnchor)} onClose={() => setUtilityAnchor(null)}>
          <MenuItem onClick={() => { setUtilityAnchor(null); setModelCenterOpen(true); }} disabled={shuttingDown}><HubOutlinedIcon fontSize="small" sx={{ mr: 1 }} />模型中心</MenuItem>
          <MenuItem onClick={() => { setUtilityAnchor(null); useAppStore.getState().setResourceCenterOpen(true); }} disabled={shuttingDown}><ExtensionOutlinedIcon fontSize="small" sx={{ mr: 1 }} />资源中心</MenuItem>
          <MenuItem onClick={(e) => { setUtilityAnchor(null); setThemeMode(nextTheme, { x: e.clientX, y: e.clientY }); }}><ThemeIcon fontSize="small" sx={{ mr: 1 }} />主题：{THEME_LABEL[themeMode]}</MenuItem>
          <MenuItem onClick={() => { setUtilityAnchor(null); if (!running) setTreeOpen(true); }} disabled={running}><AccountTreeIcon fontSize="small" sx={{ mr: 1 }} />会话分支树</MenuItem>
          <MenuItem onClick={() => { setUtilityAnchor(null); setInfoOpen(true); }}><InfoOutlinedIcon fontSize="small" sx={{ mr: 1 }} />会话信息 / 导出</MenuItem>
          <MenuItem onClick={() => { setUtilityAnchor(null); setSettingsOpen(true); }}><SettingsIcon fontSize="small" sx={{ mr: 1 }} />设置</MenuItem>
        </Menu>
        <SessionInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </Toolbar>
    </AppBar>
  );
}
