import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DescriptionIcon from "@mui/icons-material/Description";
import SearchIcon from "@mui/icons-material/Search";
import TerminalIcon from "@mui/icons-material/Terminal";
import EditIcon from "@mui/icons-material/EditOutlined";
import NoteAddIcon from "@mui/icons-material/NoteAddOutlined";
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

const KIND_ICON: Record<string, React.ReactElement> = {
  read: <DescriptionIcon sx={{ fontSize: "0.9375rem" }} />,
  search: <SearchIcon sx={{ fontSize: "0.9375rem" }} />,
  bash: <TerminalIcon sx={{ fontSize: "0.9375rem" }} />,
  edit: <EditIcon sx={{ fontSize: "0.9375rem" }} />,
  write: <NoteAddIcon sx={{ fontSize: "0.9375rem" }} />,
};

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
    <Box
      sx={{
        borderRadius: "8px",
        border: "1px solid var(--omega-border)",
        background: "var(--omega-bg-code)",
        overflow: "hidden",
        maxHeight: 300,
        overflowY: "auto",
      }}
    >
      <Box component="pre" sx={{ m: 0, p: 1, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "0.71875rem", lineHeight: 1.5 }}>
        {block.lines.map((line, index) => (
          <Box
            key={index}
            sx={{
              display: "block",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: line.type === "add" ? "var(--omega-success)" : line.type === "del" ? "var(--omega-danger)" : "var(--omega-text-soft)",
              background:
                line.type === "add" ? "rgba(46, 160, 67, 0.12)" : line.type === "del" ? "rgba(248, 81, 73, 0.10)" : "transparent",
              px: 0.5,
            }}
          >
            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
            {line.content}
          </Box>
        ))}
      </Box>
      {block.truncated ? (
        <Typography sx={{ px: 1, py: 0.5, fontSize: "0.65625rem", color: "var(--omega-warning)", borderTop: "1px solid var(--omega-border)" }}>
          {t("toolcard.diffTruncated", { n: block.lines.length })}
        </Typography>
      ) : null}
    </Box>
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

  const loadDetail = React.useCallback(async () => {
    if (detail || !card.toolCallId) return;
    const result = await ipc.getToolDetail({ toolCallId: card.toolCallId });
    if (result.ok) setDetail(result.data);
  }, [card.toolCallId, detail]);

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_event, next) => { setExpanded(next); if (next) void loadDetail(); }}
      sx={{
        background: "var(--omega-bg-soft)",
        border: `1px solid ${card.isError ? "var(--omega-danger)" : "var(--omega-border)"}`,
        borderRadius: "12px !important",
        mb: 1,
        width: "100%",
        overflow: "hidden",
        boxShadow: "var(--omega-inset-highlight)",
        transition: "border-color 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), box-shadow 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
        "&:hover": {
          borderColor: card.isError ? "var(--omega-danger)" : "var(--omega-border-strong)",
          boxShadow: "var(--omega-shadow-sm), var(--omega-inset-highlight)",
        },
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "var(--omega-text-dim)", fontSize: "1.125rem", transition: "transform 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))" }} />} sx={{ px: 1.5, py: 0.25, "& .MuiAccordionSummary-content": { minWidth: 0 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, width: "100%" }}>
          <Box
            className={card.status === "running" ? "pulse-dot" : undefined}
            sx={{
              position: "relative",
              width: 6,
              height: 6,
              borderRadius: 999,
              background: color,
              flex: "0 0 auto",
              boxShadow: card.status === "running" ? `0 0 7px ${color}` : "none",
            }}
          />
          <Box sx={{ color: "var(--omega-text-muted)", flex: "0 0 auto", display: "grid", placeItems: "center" }}>
            {KIND_ICON[card.kind] ?? <DescriptionIcon sx={{ fontSize: "0.9375rem" }} />}
          </Box>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)", fontWeight: 600, letterSpacing: "0.005em", flex: "0 0 auto" }} noWrap>
            {t(KIND_KEY[card.kind] ?? "toolcard.kind.other")} · {card.toolName}
          </Typography>
          {card.target ? (
            <Typography className="mono-num" sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)", minWidth: 0, flex: 1 }} noWrap title={card.target}>
              {card.target}
            </Typography>
          ) : null}
          {stat ? (
            <Box
              sx={{
                display: "flex",
                gap: 0.75,
                flex: "0 0 auto",
                px: 0.75,
                py: 0.1,
                borderRadius: "6px",
                border: "1px solid var(--omega-border)",
                background: "var(--omega-bg-code)",
                fontFamily: "ui-monospace, Consolas, monospace",
                fontSize: "0.65625rem",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: "var(--omega-success)" }}>+{stat.added}</span>
              <span style={{ color: "var(--omega-danger)" }}>−{stat.removed}</span>
            </Box>
          ) : null}
          {duration && card.status !== "running" ? (
            <Typography className="mono-num" sx={{ fontSize: "0.65625rem", fontWeight: 650, color: "var(--omega-accent-strong)", flex: "0 0 auto" }}>
              {duration}
            </Typography>
          ) : null}
          {card.approval ? (
            <Typography
              sx={{
                fontSize: "0.65625rem",
                fontWeight: 600,
                flex: "0 0 auto",
                px: 0.75,
                py: 0.1,
                borderRadius: "6px",
                border: `1px solid ${APPROVAL_COLOR[card.approval] ?? "var(--omega-border)"}`,
                color: APPROVAL_COLOR[card.approval] ?? "var(--omega-text-muted)",
              }}
            >
              {t(`toolcard.approval.${card.approval}` as MessageKey)}
            </Typography>
          ) : null}
          <Typography sx={{ fontSize: "0.65625rem", fontWeight: 550, color, flex: "0 0 auto" }}>
            {t(card.status === "running" ? "toolcard.status.running" : card.status === "error" ? "toolcard.status.error" : "toolcard.status.done")}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1.25 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {diffBlocks.length > 0 ? (
            diffBlocks.map((item, index) => (
              <Box key={index}>
                {diffBlocks.length > 1 || item.path ? (
                  <Typography className="overline-label" sx={{ mb: 0.5 }}>
                    {item.path ? `${item.path} · ` : ""}
                    +{item.block.additions} −{item.block.deletions}
                  </Typography>
                ) : null}
                <DiffBlockView block={item.block} />
              </Box>
            ))
          ) : null}
          {card.argsJson ? (
            <Box>
              <Typography className="overline-label" sx={{ mb: 0.5 }}>
                {t("toolcard.args")}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1,
                  borderRadius: "8px",
                  border: "1px solid var(--omega-border)",
                  background: "var(--omega-bg-code)",
                  maxHeight: 220,
                  overflow: "auto",
                  fontSize: "0.75rem",
                  lineHeight: 1.55,
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  color: "var(--omega-text-soft)",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {detail?.argsJson ?? card.argsJson}
              </Box>
            </Box>
          ) : null}
          {card.resultText ? (
            <Box>
              <Typography className="overline-label" sx={{ mb: 0.5 }}>
                {t(card.isError ? "toolcard.resultError" : "toolcard.result")}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1,
                  borderRadius: "8px",
                  border: `1px solid ${card.isError ? "var(--omega-danger)" : "var(--omega-border)"}`,
                  background: "var(--omega-bg-code)",
                  maxHeight: 300,
                  overflow: "auto",
                  fontSize: "0.75rem",
                  lineHeight: 1.55,
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  color: card.isError ? "var(--omega-error-text)" : "var(--omega-text-soft)",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {detail?.resultText ?? card.resultText}
              </Box>
            </Box>
          ) : null}
          <Box sx={{ display: "flex", gap: 2, color: "var(--omega-text-dim)", fontSize: "0.65625rem" }}>
            {card.startedAt ? <span>{t("toolcard.startedAt", { time: new Date(card.startedAt).toLocaleTimeString() })}</span> : null}
            {card.endedAt ? <span>{t("toolcard.endedAt", { time: new Date(card.endedAt).toLocaleTimeString() })}</span> : null}
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export const ToolCard = React.memo(ToolCardInner);
