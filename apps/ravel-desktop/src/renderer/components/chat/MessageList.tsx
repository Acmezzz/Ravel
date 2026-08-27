import * as React from "react";
import { Button } from "../../ui/Button";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  return <div className="omega-operation-row" data-operation-id={operation.id}><span className="overline-label">{t("timeline.turn", { n: index ?? "-" })}</span><span className="omega-operation-rule" />{operation.status === "open" ? <span className="pulse-dot omega-operation-dot" /> : null}<span className={`overline-label omega-operation-status omega-operation-${operation.status}`}>{t(`timeline.status.${operation.status}` as MessageKey)}</span></div>;
}

function CompactionMarkerRow(): React.ReactElement {
  const t = useT();
  return <div className="omega-compaction-marker"><span className="omega-compaction-mark">∞</span><span className="overline-label">{t("marker.compaction")}</span></div>;
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
  let turnOrdinal = 0;
  const indexedRows = rows.map((row) => {
    if (row.kind !== "operation-start" || row.operation.kind !== "run") return { row, index: null };
    turnOrdinal += 1;
    return { row, index: turnOrdinal };
  });
  const virtualizer = useVirtualizer({
    count: indexedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (indexedRows[index]?.row.kind === "operation-start" ? 42 : 96),
    overscan: 8,
    getItemKey: (index) => {
      const row = indexedRows[index]?.row;
      return row?.kind === "operation-start" ? `op-${row.operation.id}` : row?.message.id ?? index;
    },
  });

  return (
    <div
      ref={scrollRef}
      className="omega-message-list"
      onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
    >
      <div className="message-reading-column">
        {hiddenCount > 0 || canLoadHistorical ? (
          <div className="omega-history-actions">
            {hiddenCount > 0 ? <Button size="sm" variant="outline" onClick={() => setWindowSize((prev) => prev + WINDOW_SIZE)}>加载更早消息（剩余 {hiddenCount} 条）</Button> : null}
            {canLoadHistorical ? <Button size="sm" variant="quiet" onClick={() => void loadHistoricalMessages()} disabled={historyLoading}>{historyLoading ? "读取历史中…" : "从磁盘读取更早消息"}</Button> : null}
          </div>
        ) : null}
        <div className="omega-virtual-list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = indexedRows[virtualItem.index];
            if (!item) return null;
            const row = item.row;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="omega-virtual-item"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {row.kind === "operation-start" ? (
                  <OperationRow operation={row.operation} index={item.index} />
                ) : (() => {
                  const message = row.message;
                  const anchoredMarkers = message.entryId ? markersByAnchor.get(message.entryId) : undefined;
                  return (
                    <>
                      <MessageBubble message={message} streamingRun={thinkingActive && message.id === lastAssistantId} />
                      {row.cards.map((card) => <ToolCard key={card.toolCallId} card={card} />)}
                      {(anchoredMarkers ?? []).map((marker) => <CompactionMarkerRow key={marker.entryId} />)}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
        {looseCards.map((card) => <ToolCard key={card.toolCallId} card={card} />)}
        {runningBash ? <section className="omega-bash-tail"><div className="overline-label omega-bash-title"><span className="pulse-dot omega-operation-dot" />BASH 实时输出</div><pre ref={bashRef}>{bashTail}</pre></section> : null}
        {thinkingActive ? <p className="thinking-shimmer omega-list-status">思考中…</p> : null}
        {compacting ? <p className="omega-list-status omega-list-status-warning">正在压缩上下文…</p> : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
