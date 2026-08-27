import * as React from "react";
import { Copy, Pencil, Search, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT, type MessageKey, type TranslateParams } from "../../lib/i18n";

function SearchIcon(): React.ReactElement {
  return <Search className="omega-session-icon" aria-hidden="true" />;
}

function EditIcon(): React.ReactElement {
  return <Pencil className="omega-session-icon" aria-hidden="true" />;
}

function DeleteIcon(): React.ReactElement {
  return <Trash2 className="omega-session-icon" aria-hidden="true" />;
}

function CopyIcon(): React.ReactElement {
  return <Copy className="omega-session-icon" aria-hidden="true" />;
}

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

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  id: string;
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
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);

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

  const menuOpen = contextMenu !== null;
  React.useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!contextMenuRef.current || !target || !contextMenuRef.current.contains(target)) setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleMenuRename = React.useCallback(() => {
    const item = sessions.find((session) => session.id === contextMenu?.id);
    if (item) setRenaming({ id: item.id, name: item.title });
    setContextMenu(null);
  }, [sessions, contextMenu]);

  const handleMenuCopyId = React.useCallback(() => {
    if (contextMenu?.id) void navigator.clipboard?.writeText(contextMenu.id);
    setContextMenu(null);
  }, [contextMenu]);

  const handleMenuDelete = React.useCallback(() => {
    const item = sessions.find((session) => session.id === contextMenu?.id);
    if (item) setDeleting({ id: item.id, title: item.title });
    setContextMenu(null);
  }, [sessions, contextMenu]);

  if (sessions.length === 0) {
    return (
      <div style={{ padding: "1rem", color: "var(--omega-text-dim)", fontSize: "0.75rem", textAlign: "center" }}>
        {t("sessions.empty")}
      </div>
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
    <div>
      <div style={{ paddingLeft: 4, paddingRight: 4, paddingBottom: 8 }}>
        <div className="omega-session-search-wrap">
          <span className="omega-session-search-icon">
            <SearchIcon />
          </span>
          <TextField
            className="omega-session-search"
            label={t("sessions.search")}
            placeholder={t("sessions.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {query.trim() ? (
          <p
            role="status"
            aria-live="polite"
            style={{ margin: 0, padding: "4px 6px 0", fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}
          >
            {filtered.length > 0 ? t("sessions.matchCount", { n: filtered.length }) : t("sessions.noMatch")}
          </p>
        ) : null}
      </div>
      {loadError ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6, paddingRight: 6, paddingBottom: 8 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--omega-danger)", minWidth: 0 }}>{loadError}</span>
          {failedSessionId ? (
            <Button size="sm" variant="quiet" onClick={() => void handleLoad(failedSessionId)} disabled={loadingSessionId !== null}>
              {t("sessions.retryLoad")}
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" onClick={() => { setLoadError(null); setFailedSessionId(null); }}>
            {t("sessions.dismissError")}
          </Button>
        </div>
      ) : null}
      {[...groups.entries()].map(([workspace, items]) => {
        const isCurrentWorkspace = Boolean(items[0] && activeWorkspace && items[0].workspace === activeWorkspace);
        return (
        <section key={workspace} className="omega-session-group">
          <div className="omega-session-group-header" title={workspace}>
            <span className="omega-session-group-name">{workspace}</span>
            {isCurrentWorkspace ? <span className="omega-session-current-badge">{t("sessions.badgeCurrent")}</span> : null}
          </div>
          <div role="list">
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
                <div key={session.id} role="listitem">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={active ? "true" : undefined}
                    aria-label={session.title}
                    className={`omega-session-row${active ? " omega-session-row-active" : ""}${nested ? " omega-session-row-nested" : ""}`}
                    onClick={() => void handleLoad(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handleLoad(session.id);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ mouseX: event.clientX - 2, mouseY: event.clientY - 4, id: session.id });
                    }}
                  >
                    <span className="omega-session-body">
                      <span className="omega-session-primary">
                        {unread ? (
                          <span
                            className="pulse-dot"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "var(--omega-accent)",
                              boxShadow: "0 0 6px var(--omega-accent)",
                              flex: "0 0 auto",
                            }}
                          />
                        ) : null}
                        <span
                          className="omega-session-title"
                          style={{ fontWeight: active || unread ? 600 : 500 }}
                        >
                          {nested ? `↳ ${session.title}` : session.title}
                        </span>
                        {status ? (
                          <span
                            className={`omega-chip omega-session-chip${failed ? " omega-session-chip-danger" : isCompacting ? " omega-session-chip-warning" : " omega-session-chip-accent"}`}
                          >
                            {status}
                          </span>
                        ) : null}
                      </span>
                      <span className="mono-num omega-session-secondary">
                        {relativeTime(t, session.updatedAt)}
                        {session.messageCount ? ` · ${t("sessions.messageCount", { n: session.messageCount })}` : ""}
                        {session.parentSessionId ? ` · ${t("sessions.branched")}` : ""}
                      </span>
                    </span>
                    <span className="omega-session-actions">
                      {active ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <IconButton
                                  size="sm"
                                  label={t("sessions.copyBranchAria")}
                                  className="omega-session-action"
                                  disabled={connection === "running" || cloning}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void cloneActive();
                                  }}
                                >
                                  <CopyIcon />
                                </IconButton>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {connection === "running" ? t("sessions.copyDisabledRunning") : cloning ? t("sessions.copying") : t("sessions.copyBranchTooltip")}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <IconButton
                                size="sm"
                                label={t("sessions.renameAria")}
                                className="omega-session-action"
                                onClick={(e) => openRename(session.id, e)}
                              >
                                <EditIcon />
                              </IconButton>
                            </TooltipTrigger>
                            <TooltipContent>{t("sessions.renameTooltip")}</TooltipContent>
                          </Tooltip>
                        </>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <IconButton
                            size="sm"
                            label={t("sessions.deleteAria", { title: session.title })}
                            className="omega-session-action omega-session-action-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleting({ id: session.id, title: session.title });
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>{t("sessions.deleteTooltip")}</TooltipContent>
                      </Tooltip>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        );
      })}
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          role="menu"
          className="omega-menu-content omega-session-context-menu"
          style={{ top: contextMenu.mouseY, left: contextMenu.mouseX }}
        >
          <button type="button" role="menuitem" className="omega-menu-item" onClick={handleMenuRename}>
            {t("sessions.menu.rename")}
          </button>
          <button type="button" role="menuitem" className="omega-menu-item" onClick={handleMenuCopyId}>
            {t("sessions.menu.copyId")}
          </button>
          <button type="button" role="menuitem" className="omega-menu-item" onClick={handleMenuDelete}>
            {t("sessions.menu.delete")}
          </button>
        </div>
      ) : null}
      {sessionNextOffset != null ? (
        <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 12 }}>
          <Button
            fullWidth
            size="sm"
            variant="quiet"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            style={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}
          >
            {loadingMore ? t("sessions.loadingMore") : t("sessions.loadMore", { loaded: sessions.length, total: sessionTotal })}
          </Button>
        </div>
      ) : null}
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent>
          <DialogTitle>{t("sessions.renameTitle")}</DialogTitle>
          <div className="omega-dialog-content-area">
            <TextField
              autoFocus
              label={t("sessions.renameLabel")}
              value={renaming?.name ?? ""}
              onChange={(e) => setRenaming((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="quiet" onClick={() => setRenaming(null)}>
              {t("sessions.cancel")}
            </Button>
            <Button variant="solid" onClick={() => void commitRename()}>
              {t("sessions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogTitle>{t("sessions.deleteTitle")}</DialogTitle>
          <div className="omega-dialog-content-area">
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--omega-text-muted)" }}>
              {t("sessions.deleteBody", { title: deleting?.title ?? "" })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="quiet" onClick={() => setDeleting(null)}>
              {t("sessions.cancel")}
            </Button>
            <Button variant="solid" className="omega-button-danger-solid" onClick={() => void commitDelete()}>
              {t("sessions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
