import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import AddIcon from "@mui/icons-material/Add";
import UndoOutlinedIcon from "@mui/icons-material/UndoOutlined";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import type { CheckpointInfo } from "../../types/dto";

/**
 * Shadow-git snapshots: create on demand, restore with a two-step confirm.
 * Restores never touch HEAD — the branch history stays untouched and every
 * rewind records its own undo point.
 */
export function SnapshotsPanel(): React.ReactElement {
  const t = useT();
  const connection = useAppStore((s) => s.connection);
  const activeWorkspaceEpoch = useAppStore((s) => s.workspaceEpoch);
  const [items, setItems] = React.useState<CheckpointInfo[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const result = await ipc.checkpointList();
    if (result.ok) {
      setItems(result.data);
      setError(null);
    } else {
      setItems([]);
      setError(result.message ?? null);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh, activeWorkspaceEpoch]);

  const create = React.useCallback(async () => {
    setBusy(true);
    try {
      await ipc.checkpointCreate({});
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const restore = React.useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await ipc.checkpointRestore({ id });
        if (!result.ok) setError(result.message ?? "restore failed");
        setConfirming(null);
        await refresh();
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 0.75 }}>
      <Button
        size="small"
        variant="outlined"
        startIcon={busy ? <CircularProgress size={12} /> : <AddIcon sx={{ fontSize: "0.9375rem" }} />}
        disabled={busy || connection === "running"}
        onClick={() => void create()}
        sx={{ textTransform: "none", borderRadius: "10px", alignSelf: "flex-start" }}
      >
        {t("snapshots.create")}
      </Button>
      <Typography sx={{ fontSize: "0.625rem", color: "var(--omega-text-dim)" }}>{t("snapshots.hint")}</Typography>
      {error ? (
        <Typography sx={{ fontSize: "0.6875rem", color: "var(--omega-danger)" }}>{error}</Typography>
      ) : null}
      {(items ?? []).map((item) => (
        <Box
          key={item.id}
          sx={{
            px: 0.75,
            py: 0.5,
            borderRadius: "9px",
            border: "1px solid var(--omega-border)",
            background: "var(--omega-bg-soft)",
            display: "flex",
            alignItems: "center",
            gap: 0.75,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--omega-text)" }}>
              {item.label}
            </Typography>
            <Typography className="mono-num" sx={{ fontSize: "0.59375rem", color: "var(--omega-text-dim)" }}>
              {new Date(item.ts).toLocaleString()} · {item.id.slice(0, 8)}
            </Typography>
          </Box>
          {confirming === item.id ? (
            <>
              <Button size="small" color="warning" disabled={busy} onClick={() => void restore(item.id)} sx={{ textTransform: "none", minWidth: 0 }}>
                {t("snapshots.confirmRestore")}
              </Button>
              <Button size="small" disabled={busy} onClick={() => setConfirming(null)} sx={{ textTransform: "none", minWidth: 0 }}>
                {t("sessions.cancel")}
              </Button>
            </>
          ) : (
            <Button
              size="small"
              startIcon={<UndoOutlinedIcon sx={{ fontSize: "0.875rem" }} />}
              disabled={busy || connection === "running"}
              onClick={() => setConfirming(item.id)}
              aria-label={`${t("snapshots.restore")}: ${item.label}`}
              sx={{ textTransform: "none", minWidth: 0, flex: "0 0 auto" }}
            >
              {t("snapshots.restore")}
            </Button>
          )}
        </Box>
      ))}
      {items !== null && items.length === 0 ? (
        <Typography sx={{ fontSize: "0.6875rem", color: "var(--omega-text-dim)" }}>{t("snapshots.empty")}</Typography>
      ) : null}
    </Box>
  );
}
