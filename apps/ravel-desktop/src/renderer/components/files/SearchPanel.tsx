import * as React from "react";
import { TextField } from "../../ui/TextField";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import type { SearchMatch } from "../../types/dto";

/** Workspace-wide text search. Clicking a match opens the file in the viewer. */
export function SearchPanel(): React.ReactElement {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchMatch[] | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const openViewer = useAppStore((state) => state.openViewer);
  const requestEpoch = React.useRef(0);
  const resultScrollRef = React.useRef<HTMLDivElement | null>(null);

  const run = React.useCallback(async (raw: string) => {
    const value = raw.trim();
    const epoch = ++requestEpoch.current;
    if (!value) { setResults(null); setTruncated(false); setError(null); return; }
    setBusy(true); setError(null);
    try {
      const result = await ipc.projectSearch({ query: value });
      if (epoch !== requestEpoch.current) return;
      if (result.ok) { setResults(result.data.results); setTruncated(result.data.truncated); }
      else { setResults([]); setError(result.message ?? "search failed"); }
    } finally { if (epoch === requestEpoch.current) setBusy(false); }
  }, []);
  const matches = results ?? [];
  const virtualizer = useVirtualizer({ count: matches.length, getScrollElement: () => resultScrollRef.current, estimateSize: () => 48, overscan: 8, getItemKey: (index) => matches[index] ? `${matches[index].path}:${matches[index].line}` : index });

  return <div className="omega-search-panel">
    <TextField value={query} onChange={(event) => { setQuery(event.target.value); void run(event.target.value); }} placeholder={t("search.placeholder")} aria-label={t("search.aria")} hint={busy ? "搜索中…" : undefined} />
    {error ? <p className="omega-error-text">{error}</p> : null}
    {truncated && results ? <p className="omega-warning-text omega-search-note">{t("search.truncated")}</p> : null}
    {matches.length > 0 ? <div ref={resultScrollRef} className="omega-search-results"><div className="omega-search-virtual" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualItem) => { const match = matches[virtualItem.index]; if (!match) return null; return <button key={virtualItem.key} ref={virtualizer.measureElement} data-index={virtualItem.index} type="button" className="omega-search-result" style={{ transform: `translateY(${virtualItem.start}px)` }} onClick={() => void openViewer(match.path)}><span className="mono-num omega-search-path">{match.path}:{match.line}</span><span className="mono-num omega-search-text">{match.text.trim()}</span></button>; })}</div></div> : null}
    {results !== null && results.length === 0 && !busy && !error ? <p className="omega-muted-text">{t("search.noResults")}</p> : null}
  </div>;
}
