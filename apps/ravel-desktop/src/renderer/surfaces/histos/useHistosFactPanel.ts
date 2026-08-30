/**
 * P2 Fact Graph surface: the "facts" panel state shared by HistosInspector
 * and HistosToolbar.
 *
 * Owns the Fact Graph query/stat state, the predicate/source/time filters,
 * the P0 archive/restore/purge actions (wired to omega:histos{Archive,
 * Restore, Purge} through the renderer IPC client) and the event bus
 * consumption that refreshes the panel the moment an entry is archived,
 * restored or purged — so the canvas and list stay in sync without a manual
 * refresh.
 */
import * as React from "react";
import { histosClient } from "../../ipc/histos-client";
import type {
  HistosFactTripleDTO,
  HistosFactStatsDTO,
  HistosTombstoneTargetKind,
} from "../../types/dto";

const TRIPLE_REFRESH_EVENTS = new Set(["on_entries_archived", "on_entries_restored", "on_entries_purged"]);

export interface HistosFactPanel {
  /** Latest triple page (newest first). */
  triples: HistosFactTripleDTO[];
  stats: HistosFactStatsDTO | null;
  loading: boolean;
  error: string | null;
  predicateFilter: string;
  setPredicateFilter: (value: string) => void;
  /** Refresh the list (also re-reads stats). */
  refresh: () => Promise<void>;
  /** Query triples related to a selected node/edge (by owning session id). */
  relatedTo: (sessionId: string) => Promise<HistosFactTripleDTO[]>;
  /** P0 archive: write tombstones over triple/node/edge ids. */
  archive: (kind: HistosTombstoneTargetKind, ids: string[], reason?: string) => Promise<string | null>;
  /** P0 restore: revoke tombstones. */
  restore: (tombstoneIds: string[]) => Promise<string | null>;
  /** P0 purge: physical erase with the owning-session hint surfaced. */
  purge: (kind: HistosTombstoneTargetKind, ids: string[], reason?: string) => Promise<{ error: string | null; hint?: string }>;
}

function messageOf(result: { ok?: boolean; message?: string; code?: string } | null | undefined, fallback: string): string {
  if (!result || result.ok) return fallback;
  return result.message ?? result.code ?? fallback;
}

export function useHistosFactPanel(): HistosFactPanel {
  const [triples, setTriples] = React.useState<HistosFactTripleDTO[]>([]);
  const [stats, setStats] = React.useState<HistosFactStatsDTO | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [predicateFilter, setPredicateFilter] = React.useState("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [queryResult, statsResult] = await Promise.all([
        histosClient.histosQueryFacts(predicateFilter.trim() ? { predicate: predicateFilter.trim() } : {}),
        histosClient.histosFactStats(),
      ]);
      setTriples(queryResult.ok ? queryResult.data.triples : []);
      setStats(statsResult.ok ? statsResult.data : null);
      setError(!queryResult.ok || !statsResult.ok ? messageOf(queryResult.ok ? statsResult : queryResult, "facts unavailable") : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [predicateFilter]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    return histosClient.onHistosEvent(({ eventType }) => {
      if (TRIPLE_REFRESH_EVENTS.has(eventType)) void refresh();
    });
  }, [refresh]);

  const relatedTo = React.useCallback(async (sessionId: string): Promise<HistosFactTripleDTO[]> => {
    const result = await histosClient.histosQueryFacts({ subject: `session:${sessionId}*`, limit: 100 });
    if (result.ok) return result.data.triples;
    return [];
  }, []);

  const archive = React.useCallback(async (kind: HistosTombstoneTargetKind, ids: string[], reason?: string): Promise<string | null> => {
    const result = await histosClient.histosArchive({ kind, ids, ...(reason ? { reason } : {}) });
    if (result.ok) {
      await refresh();
      return null;
    }
    return messageOf(result, "archive failed");
  }, [refresh]);

  const restore = React.useCallback(async (tombstoneIds: string[]): Promise<string | null> => {
    const result = await histosClient.histosRestore({ tombstoneIds });
    if (result.ok) {
      await refresh();
      return null;
    }
    return messageOf(result, "restore failed");
  }, [refresh]);

  const purge = React.useCallback(async (kind: HistosTombstoneTargetKind, ids: string[], reason?: string): Promise<{ error: string | null; hint?: string }> => {
    const result = await histosClient.histosPurge({ kind, ids, ...(reason ? { reason } : {}) });
    if (result.ok) {
      await refresh();
      return { error: null, hint: result.data.hint };
    }
    return { error: messageOf(result, "purge failed") };
  }, [refresh]);

  return {
    triples,
    stats,
    loading,
    error,
    predicateFilter,
    setPredicateFilter,
    refresh,
    relatedTo,
    archive,
    restore,
    purge,
  };
}
