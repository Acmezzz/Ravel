/**
 * 动态视图 projections — pure functions over ActivityRow + per-session UI
 * flags. The "I saw it" cleared-signature table is presentation state (like
 * panel widths), deliberately NOT a fact: it lives in localStorage and never
 * enters the session JSONL.
 */
import type { ActivityRow } from "../types/dto";

export type ActivityFilter = "all" | "attention" | "running";

/** Structural subset of the store's SessionActivity flags. */
export interface SessionActivityFlags {
  unread?: boolean;
  running?: boolean;
}

const CLEARED_KEY = "ravel.activity.cleared";
const MAX_CLEARED_ENTRIES = 500;

export function activitySignature(row: Pick<ActivityRow, "status" | "updatedAt">): string {
  return `${row.status}:${row.updatedAt}`;
}

export function readClearedMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CLEARED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeClearedMap(map: Record<string, string>): void {
  try {
    const entries = Object.entries(map).slice(-MAX_CLEARED_ENTRIES);
    localStorage.setItem(CLEARED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* best effort */
  }
}

/**
 * A row needs attention when it is waiting/failed, still unread, or its
 * completion signature has not been dismissed yet.
 */
export function isAttention(row: ActivityRow, cleared: Record<string, string>, unread: boolean): boolean {
  if (row.status === "waiting" || row.status === "failed") return true;
  if (unread) return true;
  if (row.status === "done") return activitySignature(row) !== (cleared[row.sessionId] ?? "");
  return false;
}

/** Badge count for the nav tab: un-dismissed attention rows. */
export function attentionCount(
  rows: ActivityRow[],
  cleared: Record<string, string>,
  sessionActivity: Record<string, SessionActivityFlags>,
): number {
  let count = 0;
  for (const row of rows) {
    if (isAttention(row, cleared, sessionActivity[row.sessionId]?.unread ?? false)) count += 1;
  }
  return count;
}

export function filterRows(
  rows: ActivityRow[],
  filter: ActivityFilter,
  query: string,
  cleared: Record<string, string>,
  sessionActivity: Record<string, SessionActivityFlags>,
): ActivityRow[] {
  const needle = query.trim().toLowerCase();
  const matchesNeedle = (row: ActivityRow): boolean => {
    if (!needle) return true;
    return `${row.title ?? ""} ${row.workspace ?? ""}`.toLowerCase().includes(needle);
  };
  const matchesFilter = (row: ActivityRow): boolean => {
    if (filter === "running") return row.status === "running";
    if (filter === "attention") return isAttention(row, cleared, sessionActivity[row.sessionId]?.unread ?? false);
    return true;
  };
  return rows.filter((row) => matchesFilter(row) && matchesNeedle(row)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
