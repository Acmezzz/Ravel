/**
 * Operation timeline projection: groups messages and tool cards into durable
 * run operations (turns). Pure rebuildable view state — never a second
 * authority over the transcript.
 */
import type { TimelineOperation } from "../types/dto";
import type { SessionMessage } from "../types/dto";
import type { ToolCardState } from "../store/useAppStore";

export type TimelineRow =
  | { kind: "message"; message: SessionMessage; cards: ToolCardState[] }
  | { kind: "operation-start"; operation: TimelineOperation };

export interface OperationSummary {
  index: number;
  status: "open" | "completed" | "aborted" | "failed" | "declined";
}

/**
 * Attach tool cards to their owning message by id (never by "nearest
 * assistant" guessing) and interleave operation boundaries so each turn is
 * addressable. Cards whose anchor message fell outside the visible window are
 * appended after the last message to stay reachable.
 */
export function buildTimelineRows(
  toolCards: ToolCardState[],
  operations: TimelineOperation[],
  visibleMessages: SessionMessage[],
): { rows: TimelineRow[]; looseCards: ToolCardState[] } {
  const byMessage = new Map<string, ToolCardState[]>();
  const loose: ToolCardState[] = [];
  const visibleIds = new Set(visibleMessages.map((message) => message.id));
  for (const card of toolCards) {
    if (card.afterMessageId && visibleIds.has(card.afterMessageId)) {
      const list = byMessage.get(card.afterMessageId) ?? [];
      list.push(card);
      byMessage.set(card.afterMessageId, list);
    } else {
      loose.push(card);
    }
  }

  const operationsByStartTs = [...operations]
    .filter((operation) => Boolean(operation.startedAt))
    .sort((left, right) => Date.parse(left.startedAt!) - Date.parse(right.startedAt!));

  let operationCursor = 0;
  const rows: TimelineRow[] = [];
  for (const message of visibleMessages) {
    while (
      operationCursor < operationsByStartTs.length &&
      Date.parse(operationsByStartTs[operationCursor]!.startedAt!) <= Date.parse(message.ts)
    ) {
      rows.push({ kind: "operation-start", operation: operationsByStartTs[operationCursor]! });
      operationCursor += 1;
    }
    rows.push({ kind: "message", message, cards: byMessage.get(message.id) ?? [] });
    byMessage.delete(message.id);
  }
  // Operations that started after the newest visible message (e.g. a run in flight).
  while (operationCursor < operationsByStartTs.length) {
    rows.push({ kind: "operation-start", operation: operationsByStartTs[operationCursor]! });
    operationCursor += 1;
  }

  return {
    rows,
    looseCards: [...loose, ...[...byMessage.values()].flat()],
  };
}
