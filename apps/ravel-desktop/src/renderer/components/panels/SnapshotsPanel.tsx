import * as React from "react";
import { Button } from "../../ui/Button";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import type { CheckpointInfo } from "../../types/dto";

/** Shadow-git snapshots: create on demand, restore with a two-step confirm. */
export function SnapshotsPanel(): React.ReactElement {
  const t = useT();
  const connection = useAppStore((state) => state.connection);
  const activeWorkspaceEpoch = useAppStore((state) => state.workspaceEpoch);
  const [items, setItems] = React.useState<CheckpointInfo[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = React.useCallback(async () => { const result = await ipc.checkpointList(); if (result.ok) { setItems(result.data); setError(null); } else { setItems([]); setError(result.message ?? null); } }, []);
  React.useEffect(() => { void refresh(); }, [refresh, activeWorkspaceEpoch]);
  const create = React.useCallback(async () => { setBusy(true); try { await ipc.checkpointCreate({}); await refresh(); } finally { setBusy(false); } }, [refresh]);
  const restore = React.useCallback(async (id: string) => { setBusy(true); setError(null); try { const result = await ipc.checkpointRestore({ id }); if (!result.ok) setError(result.message ?? "restore failed"); setConfirming(null); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }, [refresh]);
  return <div className="omega-snapshots-panel">
    <Button size="sm" variant="outline" leading={busy ? <span className="omega-spinner" /> : <span aria-hidden="true">＋</span>} disabled={busy || connection === "running"} onClick={() => void create()}>{t("snapshots.create")}</Button>
    <p className="omega-muted-text">{t("snapshots.hint")}</p>{error ? <p className="omega-error-text">{error}</p> : null}
    {(items ?? []).map((item) => <article key={item.id} className="omega-snapshot-row"><div className="omega-snapshot-meta"><strong>{item.label}</strong><span className="mono-num">{new Date(item.ts).toLocaleString()} · {item.id.slice(0, 8)}</span></div>{confirming === item.id ? <div className="omega-button-row"><Button size="sm" variant="solid" className="omega-button-danger-solid" disabled={busy} onClick={() => void restore(item.id)}>{t("snapshots.confirmRestore")}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>{t("sessions.cancel")}</Button></div> : <Button size="sm" variant="quiet" disabled={busy || connection === "running"} onClick={() => setConfirming(item.id)} aria-label={`${t("snapshots.restore")}: ${item.label}`}>↶ {t("snapshots.restore")}</Button>}</article>)}
    {items !== null && items.length === 0 ? <p className="omega-muted-text">{t("snapshots.empty")}</p> : null}
  </div>;
}
