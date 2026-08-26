import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import RefreshIcon from "@mui/icons-material/Refresh";
import LinearProgress from "@mui/material/LinearProgress";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT, type MessageKey } from "../../lib/i18n";
import type { TelemetrySnapshot } from "../../types/dto";

function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string | null }): React.ReactElement {
  return (
    <Box
      sx={{
        flex: "1 1 0",
        minWidth: 0,
        px: 1,
        py: 0.75,
        borderRadius: "10px",
        border: "1px solid var(--omega-border)",
        background: "var(--omega-bg-soft)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <Typography className="overline-label" sx={{ color: "var(--omega-text-dim)", fontSize: "0.59375rem" }}>
        {label}
      </Typography>
      <Typography className="mono-num" sx={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--omega-text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      {sub ? (
        <Typography className="mono-num" sx={{ fontSize: "0.59375rem", color: "var(--omega-text-dim)" }}>
          {sub}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * Right-panel telemetry: token volume, prompt-cache hit rate, generation speed
 * and the durable operation log. Data comes from the authoritative session
 * branch via omega:telemetry; the log section reads projected facts.
 */
export function TelemetryPanel(): React.ReactElement {
  const t = useT();
  const connection = useAppStore((s) => s.connection);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const operations = useAppStore((s) => s.operations);
  const approvals = useAppStore((s) => s.approvals);
  const [snapshot, setSnapshot] = React.useState<TelemetrySnapshot | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipc.telemetry();
      if (result.ok) setSnapshot(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh, activeSessionId]);

  // Refresh shortly after a run settles so the numbers stay fresh without polling.
  const settledRef = React.useRef(connection);
  React.useEffect(() => {
    if (settledRef.current === "running" && connection !== "running") void refresh();
    settledRef.current = connection;
  }, [connection, refresh]);

  const totals = snapshot?.totals;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, p: 0.75, overflowY: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography className="overline-label" sx={{ color: "var(--omega-text-dim)", flex: 1 }}>
          {t("telemetry.title")}
        </Typography>
        <Tooltip title={t("telemetry.refresh")}>
          <IconButton size="small" aria-label={t("telemetry.refresh")} onClick={() => void refresh()} disabled={loading} sx={{ color: "var(--omega-text-muted)" }}>
            <RefreshIcon sx={{ fontSize: "0.9375rem" }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: "flex", gap: 0.75 }}>
        <StatCard label={t("telemetry.tokensOutput")} value={totals ? fmtTokens(totals.output) : "—"} sub={totals ? `↑${fmtTokens(totals.input)} ↓${fmtTokens(totals.output)}` : null} />
        <StatCard
          label={t("telemetry.cacheHit")}
          value={totals?.hitRate != null ? `${Math.round(totals.hitRate * 100)}%` : "—"}
          sub={totals && totals.wasteTokens > 0 ? t("telemetry.waste", { n: fmtTokens(totals.wasteTokens), m: String(totals.missCount) }) : null}
        />
        <StatCard label={t("telemetry.speed")} value={snapshot?.turns.find((turn) => turn.tokensPerSecond != null)?.tokensPerSecond?.toFixed(1) ?? "—"} sub={snapshot?.turns[0]?.model ?? null} />
        <StatCard label={t("telemetry.cost")} value={totals ? `$${totals.cost.toFixed(4)}` : "—"} sub={totals ? `${snapshot?.turns.length ?? 0} ${t("telemetry.turns")}` : null} />
      </Box>

      {totals && totals.cacheRead + totals.cacheWrite === 0 ? (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>{t("telemetry.noCacheData")}</Typography>
      ) : null}

      <Box>
        <Typography className="overline-label" sx={{ color: "var(--omega-text-dim)", mb: 0.5 }}>
          {t("telemetry.turnsTitle")}
        </Typography>
        {(snapshot?.turns ?? []).slice(0, 30).map((turn) => (
          <Box key={turn.id} sx={{ py: 0.4, borderBottom: "1px solid var(--omega-border)" }}>
            <Box sx={{ display: "flex", gap: 0.75, alignItems: "baseline" }}>
              <Typography className="mono-num" sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)", minWidth: 86 }}>
                {turn.ts ? new Date(turn.ts).toLocaleTimeString() : "—"}
              </Typography>
              <Typography className="mono-num" sx={{ fontSize: "0.6875rem", fontWeight: 650, color: "var(--omega-text)", flex: 1, fontVariantNumeric: "tabular-nums" }}>
                ↓{fmtTokens(turn.output)}
                {turn.tokensPerSecond != null ? ` · ${turn.tokensPerSecond.toFixed(1)} tok/s` : ""}
              </Typography>
              <Typography className="mono-num" sx={{ fontSize: "0.59375rem", color: "var(--omega-text-dim)" }}>
                {turn.cacheHitRate != null ? `${Math.round(turn.cacheHitRate * 100)}%` : "—"}
              </Typography>
            </Box>
            {turn.cacheHitRate != null ? (
              <LinearProgress
                variant="determinate"
                value={Math.round(turn.cacheHitRate * 100)}
                sx={{
                  height: 3,
                  mt: 0.4,
                  borderRadius: "999px",
                  backgroundColor: "var(--omega-bg-code)",
                  "& .MuiLinearProgress-bar": { borderRadius: "999px", backgroundColor: turn.missedTokens > 0 ? "var(--omega-warning)" : "var(--omega-accent)" },
                }}
              />
            ) : null}
          </Box>
        ))}
        {snapshot && snapshot.turns.length === 0 ? <Typography sx={{ fontSize: "0.6875rem", color: "var(--omega-text-dim)" }}>{t("telemetry.empty")}</Typography> : null}
      </Box>

      <Box>
        <Typography className="overline-label" sx={{ color: "var(--omega-text-dim)", mb: 0.5 }}>
          {t("telemetry.log")}
        </Typography>
        {[...operations]
          .sort((a, b) => (b.startedAt ?? b.finishedAt ?? "").localeCompare(a.startedAt ?? a.finishedAt ?? ""))
          .slice(0, 20)
          .map((operation) => (
            <Box key={operation.id} sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.25 }}>
              <span style={{ fontSize: "0.75rem", color: "var(--omega-accent)", lineHeight: 1 }}>∞</span>
              <Typography className="overline-label" sx={{ flex: 1, color: "var(--omega-text-muted)" }}>
                {operation.kind === "compaction" ? t("telemetry.opCompaction") : t("telemetry.opRun")}
              </Typography>
              <Typography
                className="overline-label"
                sx={{ color: operation.status === "failed" ? "var(--omega-danger)" : operation.status === "open" ? "var(--omega-accent)" : "var(--omega-text-dim)" }}
              >
                {t(`timeline.status.${operation.status}` as MessageKey)}
              </Typography>
            </Box>
          ))}
        {approvals.length > 0 ? (
          <Typography className="mono-num" sx={{ mt: 0.5, fontSize: "0.59375rem", color: "var(--omega-text-dim)" }}>
            {t("telemetry.approvals", { n: String(approvals.length) })}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
