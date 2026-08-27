import * as React from "react";
import { ipc } from "../../ipc/client";
import { clickableRole } from "../../lib/a11y";

/** Module-level LRU for fetched thinking blocks (port of pi-web, MIT). */
const thinkingCache = new Map<string, string>();
const CACHE_MAX = 100;

function cacheGet(key: string): string | undefined {
  const value = thinkingCache.get(key);
  if (value !== undefined) {
    thinkingCache.delete(key);
    thinkingCache.set(key, value);
  }
  return value;
}

function cacheSet(key: string, value: string): void {
  if (thinkingCache.size >= CACHE_MAX) {
    const oldest = thinkingCache.keys().next().value;
    if (oldest !== undefined) thinkingCache.delete(oldest);
  }
  thinkingCache.set(key, value);
}

function BulbIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="omega-thinking-icon" aria-hidden="true">
      <path d="M8 2.4A3.8 3.8 0 0 0 4.2 6.2c0 1.5.8 2.4 1.5 3.2.4.4.7.9.7 1.4v.2h3.2v-.2c0-.5.3-1 .7-1.4.7-.8 1.5-1.7 1.5-3.2A3.8 3.8 0 0 0 8 2.4Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.4 12.8h3.2M6.8 14h2.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={`omega-thinking-chevron${open ? " is-open" : ""}`} aria-hidden="true">
      <path d="M4.2 6.2 8 10l3.8-3.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
  /** Transcript marks deferred blocks; the content is fetched on first expand. */
  deferred?: boolean;
  entryId?: string;
}

/**
 * Collapsed-by-default reasoning block (design ported from pi-app/pi-web).
 * While streaming, the label shimmers; once done it shows the elapsed time.
 * History blocks are deferred — expanded content is fetched per entry.
 */
export function ThinkingBlock({ text, streaming, deferred, entryId }: ThinkingBlockProps): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [loaded, setLoaded] = React.useState<string | null>(deferred ? null : text);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoaded(deferred ? (entryId ? cacheGet(entryId) ?? null : null) : text);
  }, [deferred, entryId, text]);

  React.useEffect(() => {
    if (!streaming) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [streaming]);

  const fetchDeferred = React.useCallback(async () => {
    if (!entryId || loaded !== null || loading) return;
    setLoading(true);
    const res = await ipc.getThinking({ entryId });
    setLoading(false);
    if (res.ok && res.data.text) {
      cacheSet(entryId, res.data.text);
      setLoaded(res.data.text);
    } else {
      setLoaded("（无法加载思考内容）");
    }
  }, [entryId, loaded, loading]);

  const handleToggle = React.useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && deferred) void fetchDeferred();
  }, [open, deferred, fetchDeferred]);

  if (!text && !streaming && !deferred) return null;

  return (
    <div className="omega-thinking">
      <div
        {...clickableRole}
        onClick={handleToggle}
        className={`omega-thinking-toggle${streaming ? " shimmer-border is-streaming" : ""}`}
      >
        <span className={streaming ? "omega-thinking-mark pulse-dot" : "omega-thinking-mark"}>
          <BulbIcon />
        </span>
        <span className={streaming ? "omega-thinking-label thinking-shimmer" : "omega-thinking-label"}>
          {streaming
            ? ["思考中", "推理中", "整理中", "斟酌中"][Math.floor(Date.now() / 1600) % 4]
            : deferred
              ? "思考（点击加载）"
              : "思考"}
        </span>
        {!streaming && !deferred ? <span className="omega-thinking-elapsed mono-num">{elapsed || 1}s</span> : null}
        {loading ? <span className="omega-spinner omega-thinking-spinner" aria-hidden="true" /> : null}
        <ExpandIcon open={open} />
      </div>
      {open && (loaded ?? "") ? (
        <div className="omega-thinking-body rise-in">
          <pre className="omega-thinking-pre">{loaded ?? (loading ? "加载中…" : "")}</pre>
        </div>
      ) : null}
    </div>
  );
}
