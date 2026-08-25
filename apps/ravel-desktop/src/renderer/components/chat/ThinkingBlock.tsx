import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import EmojiObjectsIcon from "@mui/icons-material/EmojiObjectsOutlined";
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
    <Box sx={{ mb: 1.25, maxWidth: "100%" }}>
      <Box
        {...clickableRole}
        onClick={handleToggle}
        className={streaming ? "shimmer-border" : undefined}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          py: 0.4,
          borderRadius: "999px",
          border: `1px solid ${streaming ? "var(--omega-accent-line)" : "var(--omega-border)"}`,
          background: "var(--omega-bg-soft)",
          boxShadow: streaming ? "var(--omega-inset-recessed)" : "var(--omega-inset-highlight)",
          cursor: "pointer",
          userSelect: "none",
          transition: "background-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), border-color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), color 140ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), box-shadow 140ms var(--omega-ease-out)",
          "&:hover": { borderColor: "var(--omega-accent-line)", background: "var(--omega-accent-soft)" },
        }}
      >
        <EmojiObjectsIcon className={streaming ? "pulse-dot" : undefined} sx={{ fontSize: 13, color: "var(--omega-accent)" }} />
        <Typography
          className={streaming ? "thinking-shimmer" : undefined}
          sx={{ fontSize: 11.5, color: "var(--omega-text-muted)", fontWeight: 550, letterSpacing: "0.005em" }}
        >
          {streaming
            ? ["思考中", "推理中", "整理中", "斟酌中"][Math.floor(Date.now() / 1600) % 4]
            : deferred
              ? "思考（点击加载）"
              : "思考"}
        </Typography>
        {!streaming && !deferred ? (
          <Typography className="mono-num" sx={{ fontSize: 10, fontWeight: 650, color: "var(--omega-accent)", borderLeft: "1px solid var(--omega-border-strong)", pl: 0.75 }}>
            {elapsed || 1}s
          </Typography>
        ) : null}
        {loading ? <CircularProgress size={10} sx={{ color: "var(--omega-accent)" }} /> : null}
        <ExpandMoreIcon sx={{ fontSize: 14, color: "var(--omega-text-dim)", transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))" }} />
      </Box>
      {open && (loaded ?? "") ? (
        <Box
          sx={{
            mt: 0.75,
            p: 1.25,
            borderRadius: "10px",
            border: "1px solid var(--omega-border)",
            background: "var(--omega-bg-code)",
            boxShadow: "var(--omega-inset-recessed)",
            maxHeight: 260,
            overflowY: "auto",
            animation: "omega-rise .16s var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)) both",
          }}
        >
          <Typography component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6, color: "var(--omega-text-muted)", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>
            {loaded ?? (loading ? "加载中…" : "")}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}
