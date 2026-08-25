import * as React from "react";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SearchIcon from "@mui/icons-material/SearchOutlined";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT, type MessageKey, type TranslateParams } from "../../lib/i18n";

function groupKey(session: { workspace: string; workspaceId?: string; workspaceLabel?: string }): string {
  if (session.workspaceId) return session.workspaceLabel ? `${session.workspaceLabel} · ${session.workspaceId.slice(-8)}` : session.workspaceId;
  return session.workspace || "其他工作区";
}

function relativeTime(t: (key: MessageKey, params?: TranslateParams) => string, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("sessions.justNow");
  if (minutes < 60) return t("sessions.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("sessions.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("sessions.daysAgo", { n: days });
  return date.toLocaleDateString();
}

export function SessionList(): React.ReactElement {
  const t = useT();
  const sessions = useAppStore((s) => s.sessions);
  const sessionActivity = useAppStore((s) => s.sessionActivity);
  const compacting = useAppStore((s) => s.compacting);
  const connection = useAppStore((s) => s.connection);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeWorkspace = useAppStore((s) => s.agent?.cwd);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const applySessionPage = useAppStore((s) => s.applySessionPage);
  const sessionNextOffset = useAppStore((s) => s.sessionNextOffset);
  const sessionTotal = useAppStore((s) => s.sessionTotal);
  const loadTranscript = useAppStore((s) => s.loadTranscript);
  const clearConversation = useAppStore((s) => s.clearConversation);
  const setAgent = useAppStore((s) => s.setAgent);
  const [query, setQuery] = React.useState("");
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState<{ id: string; title: string } | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [cloning, setCloning] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [failedSessionId, setFailedSessionId] = React.useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = React.useState<string | null>(null);
  const requestEpochRef = React.useRef(0);
  const [contextMenu, setContextMenu] = React.useState<{ mouseX: number; mouseY: number; id: string } | null>(null);

  const loadMore = React.useCallback(async () => {
    if (sessionNextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const list = await ipc.listSessions({ offset: sessionNextOffset });
      if (list.ok) applySessionPage(list.data, "append");
    } finally {
      setLoadingMore(false);
    }
  }, [sessionNextOffset, loadingMore, applySessionPage]);

  const handleLoad = React.useCallback(
    async (id: string) => {
      const requestEpoch = ++requestEpochRef.current;
      setLoadingSessionId(id);
      setLoadError(null);
      setFailedSessionId(null);
      try {
        const res = await ipc.loadSession({ sessionId: id });
        if (requestEpoch !== requestEpochRef.current) return;
        if (res.ok) {
        setActiveSession(id);
        loadTranscript(res.data);
        const state = await ipc.getState();
        if (requestEpoch !== requestEpochRef.current) return;
        if (state.ok) {
          setAgent(state.data);
          useAppStore.getState().setConnection(state.data.isStreaming ? "running" : "ready");
        }
        const list = await ipc.listSessions();
        if (requestEpoch !== requestEpochRef.current) return;
        if (list.ok) applySessionPage(list.data);
        else {
          setLoadError(list.message);
          setFailedSessionId(id);
        }
      } else {
        setLoadError(res.message);
        setFailedSessionId(id);
      }
      } catch (reason) {
        if (requestEpoch === requestEpochRef.current) {
          setLoadError(reason instanceof Error ? reason.message : String(reason));
          setFailedSessionId(id);
        }
      } finally {
        if (requestEpoch === requestEpochRef.current) setLoadingSessionId(null);
      }
    },
    [setActiveSession, loadTranscript, setAgent, applySessionPage],
  );

  const openRename = React.useCallback(
    (id: string, event: React.MouseEvent) => {
      const session = sessions.find((s) => s.id === id);
      setRenaming({ id, name: session?.title ?? "" });
      event.stopPropagation();
    },
    [sessions],
  );

  const commitRename = React.useCallback(async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    setRenaming(null);
    if (!name) return;
    const res = await ipc.setSessionName({ name, sessionId: renaming.id });
    if (res.ok) {
      setAgent(res.data);
      const list = await ipc.listSessions();
      if (list.ok) applySessionPage(list.data);
    }
  }, [renaming, setAgent, applySessionPage]);

  const cloneActive = React.useCallback(async () => {
    if (cloning || connection === "running") return;
    setCloning(true);
    try {
      const res = await ipc.clone();
      if (res.ok) {
        setActiveSession(res.data.record.id);
        loadTranscript(res.data.record);
        const state = await ipc.getState();
        if (state.ok) setAgent(state.data);
        const list = await ipc.listSessions();
        if (list.ok) applySessionPage(list.data);
      }
    } finally {
      setCloning(false);
    }
  }, [cloning, connection, setActiveSession, loadTranscript, setAgent, applySessionPage]);

  const commitDelete = React.useCallback(async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    const res = await ipc.deleteSession({ sessionId: target.id });
    if (res.ok) {
      if (target.id === activeSessionId) {
        clearConversation();
        const state = await ipc.getState();
        if (state.ok) {
          setAgent(state.data);
          setActiveSession(state.data.sessionId);
        }
      }
      const list = await ipc.listSessions();
      if (list.ok) applySessionPage(list.data);
    }
  }, [deleting, activeSessionId, clearConversation, setAgent, setActiveSession, applySessionPage]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (session) => session.title.toLowerCase().includes(q) || session.workspace.toLowerCase().includes(q),
    );
  }, [sessions, query]);

  if (sessions.length === 0) {
    return (
      <Box sx={{ p: 2, color: "var(--omega-text-dim)", fontSize: "0.75rem", textAlign: "center" }}>
        {t("sessions.empty")}
      </Box>
    );
  }

  const byId = new Map(filtered.map((session) => [session.id, session]));
  const childIds = new Set(filtered.filter((session) => session.parentSessionId && byId.has(session.parentSessionId)).map((session) => session.id));
  const roots = filtered.filter((session) => !childIds.has(session.id));
  const childrenOf = (id: string) => filtered.filter((session) => session.parentSessionId === id);

  const groups = new Map<string, typeof filtered>();
  for (const session of roots) {
    const key = groupKey(session);
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }

  return (
    <Box>
      <Box sx={{ px: 0.5, pb: 1 }}>
        <TextField
          fullWidth
          size="small"
          label={t("sessions.search")}
          placeholder={t("sessions.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: "0.9375rem", color: "var(--omega-text-dim)" }} />
              </InputAdornment>
            ),
            sx: { fontSize: "0.8125rem", borderRadius: "10px", background: "var(--omega-bg-soft)", boxShadow: "var(--omega-inset-recessed)" },
          }}
        />
        {query.trim() ? (
          <Typography role="status" aria-live="polite" sx={{ display: "block", fontSize: "0.65625rem", color: "var(--omega-text-dim)", px: 0.75, pt: 0.5 }}>
            {filtered.length > 0 ? t("sessions.matchCount", { n: filtered.length }) : t("sessions.noMatch")}
          </Typography>
        ) : null}
      </Box>
      {loadError ? <Box role="alert" sx={{ display: "flex", alignItems: "center", gap: 1, px: 0.75, pb: 1 }}><Typography sx={{ fontSize: "0.75rem", color: "var(--omega-danger)", minWidth: 0 }}>{loadError}</Typography>{failedSessionId ? <Button size="small" onClick={() => void handleLoad(failedSessionId)} disabled={loadingSessionId !== null} sx={{ textTransform: "none", flex: "0 0 auto" }}>{t("sessions.retryLoad")}</Button> : null}<Button size="small" onClick={() => { setLoadError(null); setFailedSessionId(null); }} sx={{ textTransform: "none", flex: "0 0 auto" }}>{t("sessions.dismissError")}</Button></Box> : null}
      {[...groups.entries()].map(([workspace, items]) => {
        const isCurrentWorkspace = Boolean(items[0] && activeWorkspace && items[0].workspace === activeWorkspace);
        return (
        <Box key={workspace} sx={{ mb: 1.25 }}>
          <Box
            sx={{
              px: 1,
              py: 0.5,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              minWidth: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              fontSize: "0.65625rem",
              letterSpacing: 0,
            }}
            title={workspace}
          >
            <Typography
              component="span"
              sx={{ fontSize: "0.65625rem", fontFamily: "inherit", color: "var(--omega-text-dim)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {workspace}
            </Typography>
            {isCurrentWorkspace ? (
              <Typography
                component="span"
                sx={{ fontSize: "0.65625rem", fontWeight: 700, color: "var(--omega-accent-strong)", background: "var(--omega-accent-soft)", borderRadius: "5px", px: 0.6, py: 0.1, flex: "0 0 auto" }}
              >
                {t("sessions.badgeCurrent")}
              </Typography>
            ) : null}
          </Box>
          <List dense sx={{ p: 0 }}>
            {items.flatMap((session) => [session, ...childrenOf(session.id)]).map((session) => {
              const active = session.id === activeSessionId;
              const nested = Boolean(session.parentSessionId && byId.has(session.parentSessionId));
              const activity = sessionActivity[session.id];
              const running = Boolean(activity?.running || (active && connection === "running"));
              const unread = Boolean(activity?.unread && !active);
              const isCompacting = Boolean(activity?.compacting || (active && compacting));
              const failed = Boolean(activity?.failed);
              const status = failed ? t("sessions.status.failed") : isCompacting ? t("sessions.status.compacting") : running ? t("sessions.status.running") : unread ? t("sessions.status.unread") : nested ? t("sessions.status.nested") : null;
              return (
                <ListItemButton
                  key={session.id}
                  selected={active}
                  onClick={() => void handleLoad(session.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ mouseX: event.clientX - 2, mouseY: event.clientY - 4, id: session.id });
                  }}
                  sx={{
                    borderRadius: "9px",
                    mb: 0.25,
                    px: 1.25,
                    py: 0.75,
                    pl: nested ? 2.75 : 1.25,
                    border: "1px solid transparent",
                    position: "relative",
                    transition: "background-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), border-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), opacity 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
                    "&::before": {
                      content: '""',
                      position: "absolute",
                      left: 0,
                      top: "22%",
                      bottom: "22%",
                      width: 2,
                      borderRadius: 2,
                      background: "var(--omega-accent)",
                      opacity: 0,
                      transform: "scaleY(0.4)",
                      transition: "opacity 160ms var(--omega-ease-out), transform 160ms var(--omega-ease-out)",
                    },
                    "&.Mui-selected": {
                      background: "var(--omega-selected)",
                      borderColor: "var(--omega-accent-line)",
                      boxShadow: "var(--omega-inset-highlight)",
                    },
                    "&.Mui-selected::before": { opacity: 1, transform: "scaleY(1)" },
                    "&.Mui-selected:hover": { background: "var(--omega-selected)" },
                    "&:hover": { background: "var(--omega-hover-fill)" },
                    "& .row-actions": { opacity: 0 },
                    "&:hover .row-actions, &:focus-within .row-actions": { opacity: 1 },
                    "@media (hover: none)": { "& .row-actions": { opacity: 1 } },
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                        {unread ? <Box className="pulse-dot" sx={{ width: 6, height: 6, borderRadius: "50%", background: "var(--omega-accent)", boxShadow: "0 0 6px var(--omega-accent)", flex: "0 0 auto" }} /> : null}
                        <Typography sx={{ fontSize: "0.8125rem", fontWeight: active || unread ? 600 : 500, letterSpacing: "0.002em", color: "var(--omega-text)", minWidth: 0 }} noWrap>
                          {nested ? `↳ ${session.title}` : session.title}
                        </Typography>
                        {status ? (
                          <Chip
                            size="small"
                            label={status}
                            sx={{
                              height: 17,
                              fontSize: "0.65625rem",
                              fontWeight: 600,
                              border: "none",
                              background: failed ? "var(--omega-danger-soft)" : isCompacting ? "var(--omega-warning-soft)" : "var(--omega-accent-soft)",
                              color: failed ? "var(--omega-danger)" : isCompacting ? "var(--omega-warning)" : "var(--omega-accent)",
                            }}
                          />
                        ) : null}
                      </Box>
                    }
                    secondary={
                      <Typography className="mono-num" sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }} component="span" noWrap>
                        {relativeTime(t, session.updatedAt)}
                        {session.messageCount ? ` · ${t("sessions.messageCount", { n: session.messageCount })}` : ""}
                        {session.parentSessionId ? ` · ${t("sessions.branched")}` : ""}
                      </Typography>
                    }
                  />
                  <Box className="row-actions" sx={{ display: "flex", alignItems: "center", gap: 0.25, transition: "opacity .12s ease" }}>
                    {active ? (
                      <>
                        <Tooltip title={connection === "running" ? t("sessions.copyDisabledRunning") : cloning ? t("sessions.copying") : t("sessions.copyBranchTooltip")}>
                          <span>
                              <IconButton
                              size="small"
                              aria-label={t("sessions.copyBranchAria")}
                              disabled={connection === "running" || cloning}
                              onClick={(e) => {
                                e.stopPropagation();
                                void cloneActive();
                              }}
                              sx={{ color: "var(--omega-text-dim)", minWidth: 40, minHeight: 40, "&:hover": { color: "var(--omega-accent)" } }}
                            >
                              <ContentCopyIcon sx={{ fontSize: "0.9375rem" }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t("sessions.renameTooltip")}>
                          <IconButton
                            size="small"
                            aria-label={t("sessions.renameAria")}
                            onClick={(e) => openRename(session.id, e)}
                            sx={{ color: "var(--omega-text-dim)", minWidth: 32, minHeight: 32, "&:hover": { color: "var(--omega-accent)" } }}
                          >
                            <EditIcon sx={{ fontSize: "0.9375rem" }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    ) : null}
                    <Tooltip title={t("sessions.deleteTooltip")}>
                      <IconButton
                        size="small"
                        aria-label={t("sessions.deleteAria", { title: session.title })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting({ id: session.id, title: session.title });
                        }}
                        sx={{ color: "var(--omega-text-dim)", minWidth: 32, minHeight: 32, "&:hover": { color: "var(--omega-danger)" } }}
                      >
                        <DeleteIcon sx={{ fontSize: "0.9375rem" }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ListItemButton>
              );
            })}
          </List>
        </Box>
        );
      })}
      <Menu open={contextMenu !== null} onClose={() => setContextMenu(null)} anchorReference="anchorPosition" anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}>
        <MenuItem onClick={() => { const item = sessions.find((session) => session.id === contextMenu?.id); if (item) setRenaming({ id: item.id, name: item.title }); setContextMenu(null); }}>{t("sessions.menu.rename")}</MenuItem>
        <MenuItem onClick={() => { if (contextMenu?.id) void navigator.clipboard?.writeText(contextMenu.id); setContextMenu(null); }}>{t("sessions.menu.copyId")}</MenuItem>
        <MenuItem onClick={() => { const item = sessions.find((session) => session.id === contextMenu?.id); if (item) setDeleting({ id: item.id, title: item.title }); setContextMenu(null); }}>{t("sessions.menu.delete")}</MenuItem>
      </Menu>
      {sessionNextOffset != null ? (
        <Box sx={{ px: 1, pb: 1.5 }}>
          <Button
            fullWidth
            size="small"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            sx={{ textTransform: "none", fontSize: "0.75rem", color: "var(--omega-text-muted)" }}
          >
            {loadingMore ? t("sessions.loadingMore") : t("sessions.loadMore", { loaded: sessions.length, total: sessionTotal })}
          </Button>
        </Box>
      ) : null}
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>{t("sessions.renameTitle")}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t("sessions.renameLabel")}
            value={renaming?.name ?? ""}
            onChange={(e) => setRenaming((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRenaming(null)} sx={{ textTransform: "none" }}>
            {t("sessions.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void commitRename()} sx={{ textTransform: "none" }}>
            {t("sessions.save")}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>{t("sessions.deleteTitle")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text-muted)" }}>
            {t("sessions.deleteBody", { title: deleting?.title ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleting(null)} sx={{ textTransform: "none" }}>
            {t("sessions.cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={() => void commitDelete()} sx={{ textTransform: "none" }}>
            {t("sessions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
