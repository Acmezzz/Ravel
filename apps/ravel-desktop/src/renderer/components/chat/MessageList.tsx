import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { buildTimelineRows } from "../../lib/operation-timeline";
import { useT, type MessageKey } from "../../lib/i18n";
import type { TimelineOperation, TranscriptMarker } from "../../types/dto";

const WINDOW_SIZE = 60;
const SCROLL_MEMORY_CAP = 40;
/** Per-session scroll memory: scrollTop + whether it was at the bottom. */
const scrollMemory = new Map<string, { scrollTop: number; atBottom: boolean }>();

function rememberScroll(sessionId: string, snapshot: { scrollTop: number; atBottom: boolean }): void {
  if (scrollMemory.has(sessionId)) scrollMemory.delete(sessionId);
  scrollMemory.set(sessionId, snapshot);
  while (scrollMemory.size > SCROLL_MEMORY_CAP) {
    const oldest = scrollMemory.keys().next().value;
    if (oldest === undefined) break;
    scrollMemory.delete(oldest);
  }
}

function OperationRow({ operation, index }: { operation: TimelineOperation; index: number | null }): React.ReactElement {
  const t = useT();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 2 }} data-operation-id={operation.id}>
      <Typography className="overline-label" sx={{ color: "var(--omega-text-dim)", flex: "0 0 auto" }}>
        {t("timeline.turn", { n: index ?? "-" })}
      </Typography>
      <Box sx={{ height: 1, flex: 1, background: "var(--omega-border)" }} />
      {operation.status === "open" ? (
        <Box component="span" className="pulse-dot" sx={{ width: 6, height: 6, borderRadius: "50%", background: "var(--omega-accent)" }} />
      ) : null}
      <Typography
        className="overline-label"
        sx={{
          color:
            operation.status === "failed"
              ? "var(--omega-danger)"
              : operation.status === "open"
                ? "var(--omega-accent)"
                : "var(--omega-text-dim)",
          flex: "0 0 auto",
        }}
      >
        {t(`timeline.status.${operation.status}` as MessageKey)}
      </Typography>
    </Box>
  );
}

function CompactionMarkerRow(): React.ReactElement {
  const t = useT();
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        my: 1.5,
        px: 1,
        py: 0.5,
        borderRadius: "9px",
        border: "1px dashed var(--omega-border)",
        color: "var(--omega-text-dim)",
      }}
    >
      <span style={{ fontSize: "0.8125rem", color: "var(--omega-accent)" }}>∞</span>
      <Typography className="overline-label" sx={{ color: "var(--omega-text-dim)" }}>
        {t("marker.compaction")}
      </Typography>
    </Box>
  );
}

export function MessageList(): React.ReactElement {
  const messages = useAppStore((s) => s.messages);
  const toolCards = useAppStore((s) => s.toolCards);
  const markers = useAppStore((s) => s.markers);
  const operations = useAppStore((s) => s.operations);
  const thinkingActive = useAppStore((s) => s.thinkingActive);
  const compacting = useAppStore((s) => s.compacting);
  const bashTail = useAppStore((s) => s.bashTail);
  const connection = useAppStore((s) => s.connection);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const bashRef = React.useRef<HTMLPreElement | null>(null);
  const stickRef = React.useRef(true);
  const [windowSize, setWindowSize] = React.useState(WINDOW_SIZE);
  const [historyOffset, setHistoryOffset] = React.useState(0);
  const [historyNextOffset, setHistoryNextOffset] = React.useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const historyRequestRef = React.useRef<Promise<void> | null>(null);
  const historyEpochRef = React.useRef(0);
  const scrollFrameRef = React.useRef<number | null>(null);

  // Reset the render window when the session changes.
  React.useEffect(() => {
    historyEpochRef.current += 1;
    historyRequestRef.current = null;
    setWindowSize(WINDOW_SIZE);
    setHistoryOffset(0);
    setHistoryNextOffset(null);
  }, [activeSessionId]);

  const loadHistoricalMessages = React.useCallback(async () => {
    if (!activeSessionId || historyLoading) return;
    if (historyRequestRef.current) return historyRequestRef.current;
    const requestEpoch = historyEpochRef.current;
    const requestSessionId = activeSessionId;
    const requestOffset = historyOffset;
    const request = (async () => {
      setHistoryLoading(true);
      try {
        const result = await ipc.readSessionMessages({ sessionId: requestSessionId, offset: requestOffset, limit: WINDOW_SIZE });
        if (requestEpoch !== historyEpochRef.current || requestSessionId !== useAppStore.getState().activeSessionId) return;
        if (result.ok) {
          useAppStore.getState().prependMessages(result.data.items);
          setHistoryNextOffset(result.data.nextOffset);
          setHistoryOffset((current) => current + result.data.items.length);
          setWindowSize((current) => current + result.data.items.length);
        }
      } finally {
        setHistoryLoading(false);
        historyRequestRef.current = null;
      }
    })();
    historyRequestRef.current = request;
    return request;
  }, [activeSessionId, historyLoading, historyOffset]);

  const visibleAll = React.useMemo(() => messages.filter((m) => m.role !== "tool"), [messages]);
  const hiddenCount = Math.max(0, visibleAll.length - windowSize);
  const canLoadHistorical = historyNextOffset !== null || (historyOffset === 0 && visibleAll.length >= WINDOW_SIZE);
  const visible = React.useMemo(
    () => (hiddenCount > 0 ? visibleAll.slice(visibleAll.length - windowSize) : visibleAll),
    [visibleAll, windowSize, hiddenCount],
  );
  const lastAssistantId = React.useMemo(() => {
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      if (visible[i].role === "assistant") return visible[i].id;
    }
    return null;
  }, [visible]);
  const { rows, looseCards } = React.useMemo(
    () => buildTimelineRows(toolCards, operations, visible),
    [toolCards, operations, visible],
  );
  // Compaction boundaries land right after their anchor message.
  const markersByAnchor = React.useMemo(() => {
    const byAnchor = new Map<string, TranscriptMarker[]>();
    for (const marker of markers) {
      if (!marker.afterEntryId) continue;
      const list = byAnchor.get(marker.afterEntryId) ?? [];
      list.push(marker);
      byAnchor.set(marker.afterEntryId, list);
    }
    return byAnchor;
  }, [markers]);

  // Save the outgoing session's scroll position; restore the incoming one.
  const prevSessionRef = React.useRef<string | null>(activeSessionId);
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevSessionRef.current;
    if (prev !== null && prev !== activeSessionId && el) {
      rememberScroll(prev, { scrollTop: el.scrollTop, atBottom: stickRef.current });
    }
    if (prev !== activeSessionId) {
      prevSessionRef.current = activeSessionId;
      const saved = activeSessionId ? scrollMemory.get(activeSessionId) : undefined;
      if (saved && el) {
        stickRef.current = saved.atBottom;
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = saved.scrollTop;
        });
      } else {
        stickRef.current = true;
      }
    }
  }, [activeSessionId]);

  const lastTextLength = visible.length > 0 ? visible[visible.length - 1].text.length : 0;
  React.useEffect(() => {
    if (!stickRef.current) return;
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "auto" });
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [visible.length, lastTextLength, toolCards.length, thinkingActive, compacting, bashTail]);

  React.useEffect(() => {
    if (bashRef.current) bashRef.current.scrollTop = bashRef.current.scrollHeight;
  }, [bashTail]);

  const runningBash = connection === "running" && bashTail.length > 0;

  return (
    <Box
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
      sx={{ height: "100%", overflowY: "auto", px: { xs: 2, sm: 4 }, py: 3 }}
    >
      <Box className="message-reading-column" sx={{ maxWidth: 840, mx: "auto", width: "100%" }}>
        {hiddenCount > 0 || canLoadHistorical ? (
          <Box sx={{ display: "flex", justifyContent: "center", gap: 1, mb: 2 }}>
            {hiddenCount > 0 ? <Button size="small" variant="outlined" onClick={() => setWindowSize((prev) => prev + WINDOW_SIZE)} sx={{ textTransform: "none", borderRadius: "999px" }}>加载更早消息（剩余 {hiddenCount} 条）</Button> : null}
            {canLoadHistorical ? <Button size="small" variant="text" onClick={() => void loadHistoricalMessages()} disabled={historyLoading} sx={{ textTransform: "none" }}>{historyLoading ? "读取历史中…" : "从磁盘读取更早消息"}</Button> : null}
          </Box>
        ) : null}
        {(() => {
          let turnOrdinal = 0;
          return rows.map((row) => {
            if (row.kind === "operation-start") {
              if (row.operation.kind !== "run") {
                return <OperationRow key={`op-${row.operation.id}`} operation={row.operation} index={null} />;
              }
              turnOrdinal += 1;
              return <OperationRow key={`op-${row.operation.id}`} operation={row.operation} index={turnOrdinal} />;
            }
            const message = row.message;
            const anchoredMarkers = message.entryId ? markersByAnchor.get(message.entryId) : undefined;
            return (
              <React.Fragment key={message.id}>
                <MessageBubble message={message} streamingRun={thinkingActive && message.id === lastAssistantId} />
                {row.cards.map((card) => (
                  <ToolCard key={card.toolCallId} card={card} />
                ))}
                {(anchoredMarkers ?? []).map((marker) => (
                  <CompactionMarkerRow key={marker.entryId} />
                ))}
              </React.Fragment>
            );
          });
        })()}
        {looseCards.map((card) => (
          <ToolCard key={card.toolCallId} card={card} />
        ))}
        {runningBash ? (
          <Box
            sx={{
              mb: 2,
              borderRadius: "12px",
              border: "1px solid var(--omega-border)",
              background: "var(--omega-bg-code)",
              boxShadow: "var(--omega-inset-highlight)",
              overflow: "hidden",
            }}
          >
            <Typography className="overline-label" sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.75 }}>
              <Box component="span" className="pulse-dot" sx={{ width: 6, height: 6, borderRadius: "50%", background: "var(--omega-accent)", boxShadow: "0 0 6px var(--omega-accent)" }} />
              BASH 实时输出
            </Typography>
            <Box
              ref={bashRef}
              component="pre"
              sx={{
                m: 0,
                px: 1.5,
                pb: 1,
                maxHeight: 160,
                overflowY: "auto",
                fontSize: "0.75rem",
                lineHeight: 1.55,
                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                color: "var(--omega-text-muted)",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {bashTail}
            </Box>
          </Box>
        ) : null}
        {thinkingActive ? (
          <Typography className="thinking-shimmer" sx={{ fontSize: "0.75rem", mb: 2, fontWeight: 600 }}>
            思考中…
          </Typography>
        ) : null}
        {compacting ? (
          <Typography sx={{ color: "var(--omega-warning)", fontSize: "0.75rem", mb: 2 }}>正在压缩上下文…</Typography>
        ) : null}
        <div ref={bottomRef} />
      </Box>
    </Box>
  );
}
