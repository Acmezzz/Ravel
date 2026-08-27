import * as React from "react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT, type MessageKey } from "../../lib/i18n";
import type { TelemetrySnapshot } from "../../types/dto";

function fmtTokens(value: number): string { if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`; if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`; return String(value); }
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string | null }): React.ReactElement { return <div className="omega-telemetry-stat"><span className="overline-label">{label}</span><strong className="mono-num">{value}</strong>{sub ? <span className="mono-num">{sub}</span> : null}</div>; }

/** Right-panel telemetry from the authoritative omega:telemetry IPC. */
export function TelemetryPanel(): React.ReactElement {
  const t = useT();
  const connection = useAppStore((state) => state.connection);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const operations = useAppStore((state) => state.operations);
  const approvals = useAppStore((state) => state.approvals);
  const [snapshot, setSnapshot] = React.useState<TelemetrySnapshot | null>(null);
  const [loading, setLoading] = React.useState(false);
  const refresh = React.useCallback(async () => { setLoading(true); try { const result = await ipc.telemetry(); if (result.ok) setSnapshot(result.data); } finally { setLoading(false); } }, []);
  React.useEffect(() => { void refresh(); }, [refresh, activeSessionId]);
  const settledRef = React.useRef(connection);
  React.useEffect(() => { if (settledRef.current === "running" && connection !== "running") void refresh(); settledRef.current = connection; }, [connection, refresh]);
  const totals = snapshot?.totals;
  return <div className="omega-telemetry-panel">
    <div className="omega-telemetry-heading"><span className="overline-label">{t("telemetry.title")}</span><Tooltip><TooltipTrigger asChild><IconButton size="sm" label={t("telemetry.refresh")} onClick={() => void refresh()} disabled={loading}>↻</IconButton></TooltipTrigger><TooltipContent>{t("telemetry.refresh")}</TooltipContent></Tooltip></div>
    <div className="omega-telemetry-stats"><StatCard label={t("telemetry.tokensOutput")} value={totals ? fmtTokens(totals.output) : "—"} sub={totals ? `↑${fmtTokens(totals.input)} ↓${fmtTokens(totals.output)}` : null} /><StatCard label={t("telemetry.cacheHit")} value={totals?.hitRate != null ? `${Math.round(totals.hitRate * 100)}%` : "—"} sub={totals && totals.wasteTokens > 0 ? t("telemetry.waste", { n: fmtTokens(totals.wasteTokens), m: String(totals.missCount) }) : null} /><StatCard label={t("telemetry.speed")} value={snapshot?.turns.find((turn) => turn.tokensPerSecond != null)?.tokensPerSecond?.toFixed(1) ?? "—"} sub={snapshot?.turns[0]?.model ?? null} /><StatCard label={t("telemetry.cost")} value={totals ? `$${totals.cost.toFixed(4)}` : "—"} sub={totals ? `${snapshot?.turns.length ?? 0} ${t("telemetry.turns")}` : null} /></div>
    {totals && totals.cacheRead + totals.cacheWrite === 0 ? <p className="omega-muted-text">{t("telemetry.noCacheData")}</p> : null}
    <section><h3 className="overline-label">{t("telemetry.turnsTitle")}</h3>{(snapshot?.turns ?? []).slice(0, 30).map((turn) => <div key={turn.id} className="omega-telemetry-turn"><div><span className="mono-num">{turn.ts ? new Date(turn.ts).toLocaleTimeString() : "—"}</span><strong className="mono-num">↓{fmtTokens(turn.output)}{turn.tokensPerSecond != null ? ` · ${turn.tokensPerSecond.toFixed(1)} tok/s` : ""}</strong><span className="mono-num">{turn.cacheHitRate != null ? `${Math.round(turn.cacheHitRate * 100)}%` : "—"}</span></div>{turn.cacheHitRate != null ? <div className={`omega-progress ${turn.missedTokens > 0 ? "is-warning" : ""}`}><span style={{ width: `${Math.round(turn.cacheHitRate * 100)}%` }} /></div> : null}</div>)}{snapshot && snapshot.turns.length === 0 ? <p className="omega-muted-text">{t("telemetry.empty")}</p> : null}</section>
    <section><h3 className="overline-label">{t("telemetry.log")}</h3>{[...operations].sort((a, b) => (b.startedAt ?? b.finishedAt ?? "").localeCompare(a.startedAt ?? a.finishedAt ?? "")).slice(0, 20).map((operation) => <div key={operation.id} className="omega-telemetry-operation"><span>∞</span><span>{operation.kind === "compaction" ? t("telemetry.opCompaction") : t("telemetry.opRun")}</span><span className={operation.status === "failed" ? "is-danger" : operation.status === "open" ? "is-accent" : ""}>{t(`timeline.status.${operation.status}` as MessageKey)}</span></div>)}{approvals.length > 0 ? <span className="mono-num omega-muted-text">{t("telemetry.approvals", { n: String(approvals.length) })}</span> : null}</section>
  </div>;
}
