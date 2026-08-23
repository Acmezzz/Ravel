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
import AssessmentIcon from "@mui/icons-material/Assessment";
import ExploreIcon from "@mui/icons-material/Explore";
import StopIcon from "@mui/icons-material/Stop";
import CompressIcon from "@mui/icons-material/Compress";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { ThinkingLevel } from "../../types/dto";
import type { ThemeMode } from "../../theme/palettes";
import { SettingsDialog } from "./SettingsDialog";
import { SessionInfoDialog } from "./SessionInfoDialog";
import { ModelPicker } from "./ModelPicker";
import { ModelCenter } from "./ModelCenter";
import { ProjectSwitcher } from "./ProjectSwitcher";

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

/** Vertical hairline separating header clusters — grouping is information. */
function Divider(): React.ReactElement {
  return <Box sx={{ width: 1, alignSelf: "stretch", my: 1.25, background: "var(--omega-border)", flex: "0 0 auto" }} />;
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
  const label = bootstrapError
    ? "初始化失败"
    : workerError && canRetryWorker
      ? "可重试"
      : workerError
        ? "Worker 失败"
        : shutdownPhase === "closing"
      ? "正在停止"
      : shutdownPhase === "flushing"
        ? "保存会话"
        : shutdownPhase === "exiting"
          ? "正在退出"
          : compacting
            ? "压缩中"
            : thinkingActive
              ? "思考中"
              : connection === "running"
                ? "运行中"
                : connection === "error"
                  ? "错误"
                  : connection === "connecting"
                    ? "连接中"
                    : "就绪";

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
            fontSize: 16,
            fontWeight: 700,
            cursor: canRetryWorker ? "pointer" : "default",
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

function formatUsage(percent: number | null, tokens: number | null, contextWindow: number | null): string {
  if (tokens !== null && contextWindow) return `${tokens}/${contextWindow}`;
  if (contextWindow) return `${contextWindow} ctx`;
  return "—";
}

export function Header(): React.ReactElement {
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const bootstrapError = useAppStore((s) => s.bootstrapError);
  const rightOpen = useAppStore((s) => s.layout.rightPanelOpen);
  const rightTab = useAppStore((s) => s.layout.rightTab);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const setRightTab = useAppStore((s) => s.setRightTab);
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const agent = useAppStore((s) => s.agent);
  const running = useAppStore((s) => s.connection === "running");
  const compacting = useAppStore((s) => s.compacting);
  const shuttingDown = shutdownPhase !== "idle";
  const canRetryWorker = useAppStore((s) => s.canRetryWorker);
  const workerError = useAppStore((s) => s.workerError);
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
          gap: 1.25,
          px: { xs: 1.5, md: 2 },
          rowGap: 0.75,
          minHeight: { xs: 56, md: 60 },
          flexWrap: "wrap",
          "& > *": { flexShrink: 0 },
        }}
      >
        {/* identity cluster */}
        <StatusGlyph bootstrapError={bootstrapError} />
        <Box sx={{ minWidth: 0, maxWidth: 200 }}>
          <Typography sx={{ fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.15 }}>Omega</Typography>
          <Typography className="mono-num" sx={{ color: "var(--omega-text-muted)", fontSize: 11 }} noWrap title={workerError ?? undefined}>
            {workerError ? "Worker 未就绪" : agent?.sessionName || "新会话"}
          </Typography>
        </Box>

        <Divider />

        <ProjectSwitcher />

        <Divider />

        {/* model cluster */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box
              onClick={(e) => {
                if (!shuttingDown) setModelAnchor(e.currentTarget);
              }}
              sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              px: 1.25,
              py: 0.5,
              borderRadius: "10px",
              border: "1px solid var(--omega-border)",
              cursor: shuttingDown ? "default" : "pointer",
              opacity: shuttingDown ? 0.55 : 1,
              maxWidth: 230,
              "&:hover": { borderColor: "var(--omega-accent)", background: "var(--omega-hover-fill)" },
            }}
          >
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "var(--omega-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {modelLabel}
            </Typography>
            <ExpandMoreIcon sx={{ fontSize: 15, color: "var(--omega-text-muted)", flex: "0 0 auto" }} />
          </Box>
          <Button
            size="small"
            disabled={shuttingDown}
            onClick={() => setModelCenterOpen(true)}
            sx={{ textTransform: "none", fontSize: 11.5, color: "var(--omega-text-muted)", minWidth: 0, px: 1 }}
          >
            模型中心
          </Button>
        </Box>
        <ModelPicker anchor={modelAnchor} onClose={() => setModelAnchor(null)} />
        <ModelCenter />

          <Chip
          size="small"
          label={THINKING_LABEL[agent?.thinkingLevel ?? "off"]}
          onClick={(e) => {
            if (!shuttingDown) setThinkingAnchor(e.currentTarget);
          }}
          disabled={shuttingDown || agent?.supportsThinking === false}
          sx={{ cursor: "pointer", fontSize: 11.5 }}
        />
        <Menu anchorEl={thinkingAnchor} open={Boolean(thinkingAnchor)} onClose={() => setThinkingAnchor(null)}>
          {thinkingLevels.map((level) => (
            <MenuItem key={level} selected={agent?.thinkingLevel === level} onClick={() => void handleSetThinking(level)}>
              {THINKING_LABEL[level] ?? level}
            </MenuItem>
          ))}
        </Menu>

        <Divider />

        {/* data cluster */}
        <Tooltip title={`上下文 ${usageLabel}`}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 0.5 }}>
            <ContextDonut percent={usagePercent ?? 0} />
            <Typography className="mono-num" sx={{ fontSize: 11, color: "var(--omega-text-muted)", display: { xs: "none", md: "block" } }}>
              {usageLabel}
            </Typography>
          </Box>
        </Tooltip>

        <Divider />

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
            sx={{ textTransform: "none", borderRadius: "999px" }}
          >
            重试 Worker
          </Button>
        ) : running ? (
          <Button
            size="small"
            color="error"
            startIcon={<StopIcon />}
            onClick={() => void handleAbort()}
            disabled={busy}
            sx={{ textTransform: "none", borderRadius: "999px" }}
          >
            停止
          </Button>
        ) : (
          <Tooltip title="压缩上下文">
            <span>
              <IconButton size="small" onClick={() => void handleCompact()} disabled={busy || compacting} sx={{ color: "var(--omega-text-muted)" }}>
                <CompressIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Box sx={{ flexGrow: 1 }} />

        {/* utility cluster */}
        <Tooltip title={`主题：${THEME_LABEL[themeMode]}（点击切换）`}>
          <IconButton
            size="small"
            onClick={(e) => setThemeMode(nextTheme, { x: e.clientX, y: e.clientY })}
            sx={{ color: "var(--omega-text-muted)" }}
          >
            <ThemeIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={running ? "生成中无法切换分支" : "会话分支树"}>
          <span>
            <IconButton size="small" onClick={() => setTreeOpen(true)} disabled={running} sx={{ color: "var(--omega-text-muted)" }}>
              <AccountTreeIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="会话信息 / 导出">
          <IconButton size="small" onClick={() => setInfoOpen(true)} sx={{ color: "var(--omega-text-muted)" }}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <SessionInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />

        <Tooltip title="设置">
          <IconButton size="small" onClick={() => setSettingsOpen(true)} sx={{ color: "var(--omega-text-muted)" }}>
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <Divider />

        <Tooltip title="工作流">
          <Chip
            icon={<AssessmentIcon sx={{ fontSize: 15 }} />}
            label="Workflow"
            size="small"
            variant={rightTab === "workflow" && rightOpen ? "filled" : "outlined"}
            color="primary"
            onClick={() => setRightTab("workflow")}
            sx={{ cursor: "pointer", display: { xs: "none", sm: "inline-flex" }, fontSize: 11.5 }}
          />
        </Tooltip>
        <Tooltip title="探索 Scout">
          <Chip
            icon={<ExploreIcon sx={{ fontSize: 15 }} />}
            label="Scout"
            size="small"
            variant={rightTab === "scout" && rightOpen ? "filled" : "outlined"}
            color="secondary"
            onClick={() => setRightTab("scout")}
            sx={{ cursor: "pointer", display: { xs: "none", sm: "inline-flex" }, fontSize: 11.5 }}
          />
        </Tooltip>

        <Tooltip title={rightOpen ? "收起右栏" : "展开右栏"}>
          <IconButton size="small" onClick={toggleRightPanel} sx={{ color: "var(--omega-text-muted)" }}>
            {rightOpen ? <KeyboardArrowRight /> : <KeyboardArrowLeft />}
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
