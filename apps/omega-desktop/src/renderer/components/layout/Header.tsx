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
 * Signature element: the Ω mark is a live instrument. The ring spins while a
 * turn runs (slow) or compaction works (fast); the core breathes while the
 * model thinks; idle is perfectly still. Reduced motion freezes everything.
 */
function StatusGlyph({ bootstrapError }: { bootstrapError: string | null }): React.ReactElement {
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const thinkingActive = useAppStore((s) => s.thinkingActive);
  const compacting = useAppStore((s) => s.compacting);
  const workerError = useAppStore((s) => s.workerError);
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);

  const failed = Boolean(bootstrapError) || Boolean(workerError) || connection === "error";
  const ringColor =
    failed
      ? "var(--omega-danger)"
      : shutdownPhase !== "idle"
        ? "var(--omega-warning)"
        : compacting
          ? "var(--omega-warning)"
          : connection === "running"
            ? "var(--omega-accent)"
            : "transparent";
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
          {(connection === "running" || compacting) && !failed && (
            <circle
              className={`status-ring ${compacting ? "is-compacting" : "is-running"}`}
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke={ringColor}
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
            color: failed ? "var(--omega-danger)" : "var(--omega-accent)",
            background: "var(--omega-accent-soft)",
            boxShadow: "var(--omega-inset-highlight)",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            transition: "transform 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), box-shadow 140ms",
            cursor: canRetryWorker ? "pointer" : "default",
            "&:hover": canRetryWorker ? { transform: "scale(1.05)" } : undefined,
          }}
        >
          Ω
        </Box>
      </Box>
    </Tooltip>
  );
}

/** Compact context donut replacing the linear bar — data reads as an instrument. */
function ContextDonut({ percent }: { percent: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = clamped >= 85 ? "var(--omega-danger)" : clamped >= 65 ? "var(--omega-warning)" : "var(--omega-accent)";
  return (
    <Tooltip title={`上下文已用 ${Math.round(clamped)}%`}>
      <Box sx={{ position: "relative", width: 24, height: 24, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r={radius} fill="none" stroke="var(--omega-border)" strokeWidth="3" />
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
  return "—";
}

export function Header(): React.ReactElement {
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const bootstrapError = useAppStore((s) => s.bootstrapError);
  const rightOpen = useAppStore((s) => s.layout.rightPanelOpen);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
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
          flexWrap: "nowrap",
          overflow: "hidden",
        }}
      >
        {/* identity cluster */}
        <StatusGlyph bootstrapError={bootstrapError} />
        <Box sx={{ minWidth: 0, flex: "0 1 auto", maxWidth: 180 }}>
          <Typography sx={{ fontWeight: 650, fontSize: 13.5, lineHeight: 1.2, color: "var(--omega-text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sessionTitle}>
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
                      ? "var(--omega-accent)"
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
            cursor: shuttingDown ? "default" : "pointer",
            opacity: shuttingDown ? 0.55 : 1,
            transition: "all 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
            "&:hover": { borderColor: "var(--omega-accent-line)", background: "var(--omega-accent-soft)" },
          }}
        >
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "var(--omega-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
            fontSize: 11,
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
            <Typography className="mono-num" sx={{ fontSize: 11, color: "var(--omega-text-muted)", display: { xs: "none", md: "block" } }}>
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
              "&:hover": { background: "var(--omega-danger-soft)", borderColor: "var(--omega-danger)" },
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
        <Tooltip title="模型中心">
          <IconButton size="small" onClick={() => setModelCenterOpen(true)} disabled={shuttingDown} sx={iconBtnSx}>
            <HubOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="资源中心">
          <IconButton size="small" onClick={() => useAppStore.getState().setResourceCenterOpen(true)} disabled={shuttingDown} sx={iconBtnSx}>
            <ExtensionOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={`主题：${THEME_LABEL[themeMode]}（点击切换）`}>
          <IconButton
            size="small"
            onClick={(e) => setThemeMode(nextTheme, { x: e.clientX, y: e.clientY })}
            sx={iconBtnSx}
          >
            <ThemeIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={running ? "生成中无法切换分支" : "会话分支树"}>
          <span>
            <IconButton size="small" onClick={() => setTreeOpen(true)} disabled={running} sx={iconBtnSx}>
              <AccountTreeIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="会话信息 / 导出">
          <IconButton size="small" onClick={() => setInfoOpen(true)} sx={iconBtnSx}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <SessionInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />

        <Tooltip title="设置">
          <IconButton size="small" onClick={() => setSettingsOpen(true)} sx={iconBtnSx}>
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <Divider />

        <Tooltip title={rightOpen ? "收起右栏" : "展开右栏"}>
          <IconButton size="small" onClick={toggleRightPanel} sx={iconBtnSx}>
            {rightOpen ? <KeyboardArrowRight /> : <KeyboardArrowLeft />}
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
