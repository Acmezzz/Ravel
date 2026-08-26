import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import NotificationImportantOutlinedIcon from "@mui/icons-material/NotificationImportantOutlined";
import { useAppStore } from "../../store/useAppStore";
import { openSessionInStore } from "../../lib/open-session";
import { useT } from "../../lib/i18n";
import { clearRow, filterRows, isAttention, readClearedMap, writeClearedMap, type ActivityFilter } from "../../lib/activity-projection";
import type { ActivityRow } from "../../types/dto";

function statusColor(status: ActivityRow["status"]): string {
  if (status === "waiting") return "var(--omega-warning)";
  if (status === "failed") return "var(--omega-danger)";
  if (status === "running") return "var(--omega-accent)";
  return "var(--omega-text-dim)";
}

function statusIcon(status: ActivityRow["status"]): React.ReactElement {
  if (status === "running") return <CircularProgress size={16} thickness={5} sx={{ color: statusColor(status) }} />;
  if (status === "waiting") return <NotificationImportantOutlinedIcon sx={{ fontSize: 18, color: statusColor(status) }} />;
  if (status === "failed") return <ErrorOutlineIcon sx={{ fontSize: 18, color: statusColor(status) }} />;
  return <CheckCircleOutlineIcon sx={{ fontSize: 18, color: statusColor(status) }} />;
}

/**
 * 动态 view: cross-session projection over live tracker rows + fact-derived
 * rows. Pure presentation — filtering/clearing semantics live in
 * activity-projection.ts.
 */
export function ActivityList(): React.ReactElement {
  const t = useT();
  const sessions = useAppStore((s) => s.sessions);
  const sessionActivity = useAppStore((s) => s.sessionActivity);
  const activityRowsMap = useAppStore((s) => s.activityRows);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [filter, setFilter] = React.useState<ActivityFilter>("attention");
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [cleared, setCleared] = React.useState<Record<string, string>>(readClearedMap);

  const rows = React.useMemo(() => Object.values(activityRowsMap), [activityRowsMap]);
  const visible = React.useMemo(
    () => filterRows(rows, filter, "", cleared, sessionActivity),
    [rows, filter, cleared, sessionActivity],
  );

  // Join with the session list for titles/workspaces the tracker does not carry.
  const sessionById = React.useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);

  const clearOne = React.useCallback((row: ActivityRow) => {
    setCleared((current) => {
      const next = clearRow(current, row);
      writeClearedMap(next);
      return next;
    });
  }, []);

  const clearVisible = React.useCallback(() => {
    setCleared((current) => {
      let next = current;
      for (const row of visible) {
        if (row.status !== "running") next = clearRow(next, row);
      }
      writeClearedMap(next);
      return next;
    });
  }, [visible]);

  const openSession = React.useCallback(async (sessionId: string) => {
    setLoadingId(sessionId);
    try {
      await openSessionInStore(sessionId);
    } finally {
      setLoadingId(null);
    }
  }, []);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <Box sx={{ px: 0.5, pb: 0.75, display: "flex", alignItems: "center", gap: 0.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_e, value) => value && setFilter(value)}
          sx={{ flex: 1, minWidth: 0, "& .MuiToggleButton-root": { fontSize: "0.6875rem", px: 0.75, py: 0.25, textTransform: "none" } }}
        >
          <ToggleButton value="all">{t("activity.filter.all")}</ToggleButton>
          <ToggleButton value="attention">{t("activity.filter.attention")}</ToggleButton>
          <ToggleButton value="running">{t("activity.filter.running")}</ToggleButton>
        </ToggleButtonGroup>
        {filter !== "running" && visible.length > 0 ? (
          <Tooltip title={t("activity.clearAll")}>
            <Button size="small" onClick={clearVisible} sx={{ textTransform: "none", fontSize: "0.6875rem", minWidth: 0, px: 0.75, flex: "0 0 auto" }}>
              {t("activity.clearAll")}
            </Button>
          </Tooltip>
        ) : null}
      </Box>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
        {visible.length === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, mt: 6, px: 3, textAlign: "center" }}>
            <InboxOutlinedIcon sx={{ fontSize: 28, color: "var(--omega-text-dim)" }} />
            <Typography variant="body2" sx={{ color: "var(--omega-text-dim)" }}>
              {t("activity.empty")}
            </Typography>
          </Box>
        ) : (
          visible.map((row) => {
            const session = sessionById.get(row.sessionId);
            const title = row.title ?? session?.title ?? row.sessionId.slice(0, 12);
            const workspaceLabel = session?.workspaceLabel ?? session?.workspace ?? row.workspace ?? "";
            const unread = sessionActivity[row.sessionId]?.unread ?? false;
            const attention = isAttention(row, cleared, unread);
            const dismissible = row.status !== "running";
            return (
              <ListItemButton
                key={row.sessionId}
                dense
                selected={row.sessionId === activeSessionId}
                disabled={loadingId === row.sessionId}
                onClick={() => void openSession(row.sessionId)}
                sx={{
                  alignItems: "flex-start",
                  py: 0.75,
                  borderRadius: 1,
                  mb: 0.25,
                  "&.Mui-selected": { background: "var(--omega-selected)", "&:hover": { background: "var(--omega-selected)" } },
                  "&:hover": { background: "var(--omega-hover-fill)" },
                }}
              >
                <Box sx={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", mr: 1, mt: 0.25, borderRadius: 999, background: "var(--omega-bg-soft)", boxShadow: "var(--omega-inset-recessed)", flex: "0 0 auto" }}>
                  {statusIcon(row.status)}
                </Box>
                <ListItemText
                  primary={
                    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                      <Typography component="span" variant="body2" noWrap sx={{ fontWeight: attention ? 700 : 500, color: attention ? "var(--omega-text)" : "var(--omega-text-muted)" }}>
                        {title}
                      </Typography>
                      {unread ? (
                        <Typography component="span" variant="caption" sx={{ px: 0.5, borderRadius: 0.5, background: "var(--omega-accent-soft)", color: "var(--omega-accent)", fontWeight: 700, fontSize: "0.625rem", flex: "0 0 auto" }}>
                          {t("activity.badge.new")}
                        </Typography>
                      ) : null}
                    </Box>
                  }
                  secondary={
                    <Typography component="span" variant="caption" noWrap display="block" sx={{ color: row.status === "failed" ? "var(--omega-danger)" : "var(--omega-text-muted)" }}>
                      {[workspaceLabel, row.status === "failed" ? row.lastError : null].filter(Boolean).join(" · ")}
                    </Typography>
                  }
                />
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.25, alignSelf: "center", flex: "0 0 auto" }}>
                  <Typography component="span" variant="caption" sx={{ color: statusColor(row.status), fontWeight: 600, whiteSpace: "nowrap" }}>
                    {t(`activity.status.${row.status}` as const)}
                  </Typography>
                  {dismissible ? (
                    <Tooltip title={t("activity.clearOne")}>
                      <IconButton
                        size="small"
                        aria-label={`${t("activity.clearOne")} ${title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          clearOne(row);
                        }}
                        sx={{
                          color: row.status === "waiting" || row.status === "failed" ? "var(--omega-warning)" : "var(--omega-text-dim)",
                          opacity: 0,
                          "@media (hover: none)": { opacity: 1 },
                          ".MuiListItemButton-root:hover &": { opacity: 1 },
                          "&:focus-visible": { opacity: 1 },
                          "&:hover": { color: "var(--omega-danger)" },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </Box>
              </ListItemButton>
            );
          })
        )}
      </Box>
    </Box>
  );
}
