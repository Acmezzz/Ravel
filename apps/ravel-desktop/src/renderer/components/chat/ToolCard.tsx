import * as React from "react";
import type { ToolCardState } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT, type MessageKey } from "../../lib/i18n";
import { lineDiff, parseToolEdits, type ToolDiffBlock } from "../../lib/tool-diff";

const STATUS_COLOR: Record<string, string> = {
  running: "var(--omega-warning)",
  done: "var(--omega-success)",
  error: "var(--omega-danger)",
};

const APPROVAL_COLOR: Record<string, string> = {
  "allowed-once": "var(--omega-success)",
  rejected: "var(--omega-danger)",
  cancelled: "var(--omega-warning)",
  unavailable: "var(--omega-warning)",
};

const KIND_KEY: Record<string, MessageKey> = {
  read: "toolcard.kind.read",
  edit: "toolcard.kind.edit",
  write: "toolcard.kind.write",
  bash: "toolcard.kind.bash",
  search: "toolcard.kind.search",
  other: "toolcard.kind.other",
};

function KindIcon({ kind }: { kind: string }): React.ReactElement {
  if (kind === "search") {
    return (
      <svg viewBox="0 0 16 16" className="omega-toolcard-icon" aria-hidden="true">
        <circle cx="7" cy="7" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9.6 9.6 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "bash") {
    return (
      <svg viewBox="0 0 16 16" className="omega-toolcard-icon" aria-hidden="true">
        <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.6 6.4 6.6 8 4.6 9.6M8.2 9.8h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "edit") {
    return (
      <svg viewBox="0 0 16 16" className="omega-toolcard-icon" aria-hidden="true">
        <path d="M10.4 3.4 12.6 5.6 6.2 12H4v-2.2l6.4-6.4Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M9.3 4.5 11.5 6.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (kind === "write") {
    return (
      <svg viewBox="0 0 16 16" className="omega-toolcard-icon" aria-hidden="true">
        <path d="M5 3.2h4.2L12.8 7v5.8H5A1.2 1.2 0 0 1 3.8 11.6V4.4A1.2 1.2 0 0 1 5 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M9.2 3.2V7h3.6M6.4 9.4h3.2M6.4 11.4h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="omega-toolcard-icon" aria-hidden="true">
      <path d="M5 3.2h4.2L12.8 7v5.8H5A1.2 1.2 0 0 1 3.8 11.6V4.4A1.2 1.2 0 0 1 5 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.2 3.2V7h3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={`omega-toolcard-chevron${open ? " is-open" : ""}`} aria-hidden="true">
      <path d="M4.2 6.2 8 10l3.8-3.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Extract +/- line stats from an edit/write diff-style result (best effort). */
function diffStat(resultText?: string): { added: number; removed: number } | null {
  if (!resultText) return null;
  let added = 0;
  let removed = 0;
  for (const line of resultText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return added + removed > 0 ? { added, removed } : null;
}

/** Precision duration readout: ms under 1s, otherwise one decimal in s. */
function formatDuration(startedAt?: string, endedAt?: string): string | null {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const ms = end - start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function DiffBlockView({ block }: { block: ToolDiffBlock }): React.ReactElement {
  const t = useT();
  return (
    <div className="omega-diff-block">
      <pre className="omega-diff-pre">
        {block.lines.map((line, index) => (
          <span
            key={index}
            className={`omega-diff-line ${line.type === "add" ? "omega-diff-add" : line.type === "del" ? "omega-diff-del" : "omega-diff-ctx"}`}
          >
            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
            {line.content}
          </span>
        ))}
      </pre>
      {block.truncated ? (
        <p className="omega-diff-truncated">{t("toolcard.diffTruncated", { n: block.lines.length })}</p>
      ) : null}
    </div>
  );
}

export interface ToolCardProps {
  card: ToolCardState;
}

/**
 * Full-fidelity tool card (V3): collapsed row shows verb + target + status +
 * +/- diff badge; expanded shows raw args JSON and the paired result text.
 */
function ToolCardInner({ card }: ToolCardProps): React.ReactElement {
  const t = useT();
  const color = STATUS_COLOR[card.status] ?? "var(--omega-text-muted)";
  const [detail, setDetail] = React.useState<{ argsJson?: string; resultText?: string; isError?: boolean } | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  // Structured diff from the tool's own oldText/newText; the +/- text guess is
  // only a fallback when no structured pairs exist.
  const effectiveArgsJson = detail?.argsJson ?? card.argsJson;
  const diffBlocks = React.useMemo<{ path?: string; block: ToolDiffBlock }[]>(() => {
    if (card.kind !== "edit") return [];
    const parsed = parseToolEdits(effectiveArgsJson);
    if (!parsed) return [];
    return parsed.edits.map((edit) => ({ ...(parsed.path ? { path: parsed.path } : {}), block: lineDiff(edit.oldText, edit.newText) }));
  }, [card.kind, effectiveArgsJson]);
  const totalDiff = diffBlocks.reduce(
    (acc, item) => ({ additions: acc.additions + item.block.additions, deletions: acc.deletions + item.block.deletions }),
    { additions: 0, deletions: 0 },
  );
  const rawStat = diffBlocks.length > 0 ? totalDiff : card.kind === "edit" || card.kind === "write" ? diffStat(detail?.resultText ?? card.resultText) : null;
  const stat = rawStat ? { added: "additions" in rawStat ? rawStat.additions : rawStat.added, removed: "deletions" in rawStat ? rawStat.deletions : rawStat.removed } : null;
  const duration = formatDuration(card.startedAt, card.endedAt);
  const approvalColor = card.approval ? APPROVAL_COLOR[card.approval] ?? "var(--omega-text-muted)" : undefined;

  const loadDetail = React.useCallback(async () => {
    if (detail || !card.toolCallId) return;
    const result = await ipc.getToolDetail({ toolCallId: card.toolCallId });
    if (result.ok) setDetail(result.data);
  }, [card.toolCallId, detail]);

  const handleToggle = React.useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadDetail();
  }, [expanded, loadDetail]);

  return (
    <div className={`omega-toolcard${card.isError ? " omega-toolcard-error" : ""}`} data-tool-call-id={card.toolCallId} tabIndex={card.toolCallId ? -1 : undefined}>
      <button type="button" className="omega-toolcard-summary" aria-expanded={expanded} onClick={handleToggle}>
        <span
          className={card.status === "running" ? "omega-toolcard-dot pulse-dot" : "omega-toolcard-dot"}
          style={{ background: color, boxShadow: card.status === "running" ? `0 0 7px ${color}` : "none" }}
        />
        <span className="omega-toolcard-kind">
          <KindIcon kind={card.kind} />
        </span>
        <span className="omega-toolcard-title">
          {t(KIND_KEY[card.kind] ?? "toolcard.kind.other")} · {card.toolName}
        </span>
        {card.target ? (
          <span className="omega-toolcard-target mono-num" title={card.target}>
            {card.target}
          </span>
        ) : null}
        {stat ? (
          <span className="omega-toolcard-stat">
            <span className="omega-toolcard-stat-add">+{stat.added}</span>
            <span className="omega-toolcard-stat-del">−{stat.removed}</span>
          </span>
        ) : null}
        {duration && card.status !== "running" ? <span className="omega-toolcard-duration mono-num">{duration}</span> : null}
        {card.approval ? (
          <span className="omega-toolcard-approval" style={{ borderColor: approvalColor, color: approvalColor }}>
            {t(`toolcard.approval.${card.approval}` as MessageKey)}
          </span>
        ) : null}
        <span className="omega-toolcard-status" style={{ color }}>
          {t(card.status === "running" ? "toolcard.status.running" : card.status === "error" ? "toolcard.status.error" : "toolcard.status.done")}
        </span>
        <ExpandIcon open={expanded} />
      </button>
      {expanded ? (
        <div className="omega-toolcard-body">
          {diffBlocks.length > 0 ? (
            diffBlocks.map((item, index) => (
              <div key={index}>
                {diffBlocks.length > 1 || item.path ? (
                  <p className="overline-label omega-toolcard-section">
                    {item.path ? `${item.path} · ` : ""}
                    +{item.block.additions} −{item.block.deletions}
                  </p>
                ) : null}
                <DiffBlockView block={item.block} />
              </div>
            ))
          ) : null}
          {(detail?.argsJson ?? card.argsJson) ? (
            <div>
              <p className="overline-label omega-toolcard-section">{t("toolcard.args")}</p>
              <pre className="omega-toolcard-pre">{detail?.argsJson ?? card.argsJson}</pre>
            </div>
          ) : null}
          {(detail?.resultText ?? card.resultText) ? (
            <div>
              <p className="overline-label omega-toolcard-section">{t(card.isError ? "toolcard.resultError" : "toolcard.result")}</p>
              <pre className={`omega-toolcard-pre omega-toolcard-pre-result${card.isError ? " omega-toolcard-pre-error" : ""}`}>
                {detail?.resultText ?? card.resultText}
              </pre>
            </div>
          ) : null}
          <div className="omega-toolcard-meta">
            {card.startedAt ? <span>{t("toolcard.startedAt", { time: new Date(card.startedAt).toLocaleTimeString() })}</span> : null}
            {card.endedAt ? <span>{t("toolcard.endedAt", { time: new Date(card.endedAt).toLocaleTimeString() })}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const ToolCard = React.memo(ToolCardInner);
