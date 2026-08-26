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
import NotificationImportantOutlinedIcon from "@mui/icons-material/NotificationImportantOutlined";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { openSessionInStore } from "../../lib/open-session";
import { activitySignature, filterRows, readClearedMap, writeClearedMap, type ActivityFilter } from "../../lib/activity-projection";
import type { ActivityRow } from "../../types/dto";

function statusColor(status: ActivityRow["status"]): string {
  if (status === "waiting") return "#b45309";
  if (status === "failed") return "#dc2626";
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

  const clearRow = React.useCallback((row: ActivityRow) => {
    setCleared((current) => {
      const next = { ...current, [row.sessionId]: activitySignature(row) };
      writeClearedMap(next);
      return next;
    });
  }, []);

  const clearVisible = React.useCallback(() => {
    setCleared((current) => {
      const next = { ...current };
      for (const row of visible) {
        if (row.status === "done") next[row.sessionId] = activitySignature(row);
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
          <Typography variant="body2" sx={{ color: "var(--omega-text-dim)", textAlign: "center", mt: 4, px: 2 }}>
            {t("activity.empty")}
          </Typography>
        ) : (
          visible.map((row) => {
            const session = sessionById.get(row.sessionId);
            const title = row.title ?? session?.title ?? row.sessionId.slice(0, 12);
            const workspaceLabel = session?.workspaceLabel ?? session?.workspace ?? row.workspace ?? "";
            const unread = sessionActivity[row.sessionId]?.unread ?? false;
            const attention = row.status === "waiting" || row.status === "failed" || unread;
            return (
              <ListItemButton
                key={row.sessionId}
                dense
                selected={row.sessionId === activeSessionId}
                disabled={loadingId === row.sessionId}
                onClick={() => void openSession(row.sessionId)}
                sx={{ alignItems: "flex-start", py: 0.75, borderRadius: 1, mb: 0.25 }}
              >
                <Box sx={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", mr: 1, mt: 0.25, borderRadius: 999, background: "var(--omega-selected)", flex: "0 0 auto" }}>
                  {statusIcon(row.status)}
                </Box>
                <ListItemText
                  primary={
                    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                      <Typography component="span" variant="body2" noWrap sx={{ fontWeight: attention ? 700 : 500, color: "var(--omega-text)" }}>
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
                    <>
                      <Typography component="span" variant="caption" noWrap display="block" sx={{ color: "var(--omega-text-muted)" }}>
                        {[workspaceLabel, row.status === "failed" ? row.lastError : null].filter(Boolean).join(" · ")}
                      </Typography>
                    </>
                  }
                />
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.25, alignSelf: "center", flex: "0 0 auto" }}>
                  <Typography component="span" variant="caption" sx={{ color: statusColor(row.status), fontWeight: 600, whiteSpace: "nowrap" }}>
                    {t(`activity.status.${row.status}` as const)}
                  </Typography>
                  {(row.status === "done" || (!attention && row.status !== "running")) && (
                    <Tooltip title={t("activity.clearOne")}>
                      <IconButton
                        size="small"
                        aria-label={t("activity.clearOne")}
                        onClick={(event) => {
                          event.stopPropagation();
                          clearRow(row);
                        }}
                        sx={{ color: "var(--omega-text-dim)", "&:hover": { color: "var(--omega-text)" } }}
                      >
                        <CloseIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </ListItemButton>
            );
          })
        )}
      </Box>
    </Box>
  );
}
