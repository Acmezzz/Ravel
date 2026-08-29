import * as React from "react";
import { Button, IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../store/useAppStore";
import { openSessionInStore } from "../../lib/open-session";
import { useT } from "../../lib/i18n";
import { clearRow, filterRows, isAttention, readClearedMap, writeClearedMap, type ActivityFilter } from "../../lib/activity-projection";
import type { ActivityRow } from "../../types/dto";

function statusColor(status: ActivityRow["status"]): string { if (status === "waiting") return "var(--ravel-warning)"; if (status === "failed") return "var(--ravel-danger)"; if (status === "running") return "var(--ravel-accent)"; return "var(--ravel-text-dim)"; }
function statusIcon(status: ActivityRow["status"]): React.ReactElement { if (status === "running") return <span className="omega-spinner omega-activity-spinner" />; if (status === "waiting") return <span aria-hidden="true">!</span>; if (status === "failed") return <span aria-hidden="true">×</span>; return <span aria-hidden="true">✓</span>; }

/** Dynamic cross-session projection. Rows are virtualized; clearing remains UI state. */
export function ActivityList(): React.ReactElement {
  const t = useT();
  const sessions = useAppStore((state) => state.sessions);
  const sessionActivity = useAppStore((state) => state.sessionActivity);
  const activityRowsMap = useAppStore((state) => state.activityRows);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const [filter, setFilter] = React.useState<ActivityFilter>("attention");
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [cleared, setCleared] = React.useState<Record<string, string>>(readClearedMap);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const rows = React.useMemo(() => Object.values(activityRowsMap), [activityRowsMap]);
  const visible = React.useMemo(() => filterRows(rows, filter, "", cleared, sessionActivity), [rows, filter, cleared, sessionActivity]);
  const sessionById = React.useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const clearOne = React.useCallback((row: ActivityRow) => setCleared((current) => { const next = clearRow(current, row); writeClearedMap(next); return next; }), []);
  const clearVisible = React.useCallback(() => setCleared((current) => { let next = current; for (const row of visible) if (row.status !== "running") next = clearRow(next, row); writeClearedMap(next); return next; }), [visible]);
  const openSession = React.useCallback(async (sessionId: string) => { setLoadingId(sessionId); try { await openSessionInStore(sessionId); } finally { setLoadingId(null); } }, []);
  const virtualizer = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => 58, overscan: 8, getItemKey: (index) => visible[index]?.sessionId ?? index });
  return <div className="omega-activity-list">
    <div className="omega-activity-filter" role="group" aria-label="活动筛选">{(["all", "attention", "running"] as const).map((value) => <button key={value} type="button" className={`omega-filter-button${filter === value ? " is-active" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`activity.filter.${value}`)}</button>)}{filter !== "running" && visible.length > 0 ? <Tooltip><TooltipTrigger asChild><Button size="sm" variant="quiet" onClick={clearVisible}>{t("activity.clearAll")}</Button></TooltipTrigger><TooltipContent>{t("activity.clearAll")}</TooltipContent></Tooltip> : null}</div>
    <div ref={scrollRef} className="omega-activity-scroll">{visible.length === 0 ? <div className="omega-activity-empty"><span aria-hidden="true">□</span><span>{t("activity.empty")}</span></div> : <div className="omega-activity-virtual" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualItem) => { const row = visible[virtualItem.index]; if (!row) return null; const session = sessionById.get(row.sessionId); const title = row.title ?? session?.title ?? row.sessionId.slice(0, 12); const workspaceLabel = session?.workspaceLabel ?? session?.workspace ?? row.workspace ?? ""; const unread = sessionActivity[row.sessionId]?.unread ?? false; const attention = isAttention(row, cleared, unread); const dismissible = row.status !== "running"; return <div key={virtualItem.key} ref={virtualizer.measureElement} data-index={virtualItem.index} className="omega-activity-item" style={{ transform: `translateY(${virtualItem.start}px)` }}><button type="button" className={`omega-activity-row${row.sessionId === activeSessionId ? " is-active" : ""}`} disabled={loadingId === row.sessionId} onClick={() => void openSession(row.sessionId)}><span className={`omega-activity-icon omega-activity-${row.status}`}>{statusIcon(row.status)}</span><span className="omega-activity-copy"><span className={attention ? "is-attention" : ""}>{title}{unread ? <small>{t("activity.badge.new")}</small> : null}</span><span className={row.status === "failed" ? "is-danger" : ""}>{[workspaceLabel, row.status === "failed" ? row.lastError : null].filter(Boolean).join(" · ")}</span></span><span className="omega-activity-actions"><strong style={{ color: statusColor(row.status) }}>{t(`activity.status.${row.status}` as const)}</strong>{dismissible ? <Tooltip><TooltipTrigger asChild><IconButton size="sm" label={`${t("activity.clearOne")} ${title}`} className="omega-activity-clear" onClick={(event) => { event.stopPropagation(); clearOne(row); }}>×</IconButton></TooltipTrigger><TooltipContent>{t("activity.clearOne")}</TooltipContent></Tooltip> : null}</span></button></div>; })}</div>}</div>
  </div>;
}
