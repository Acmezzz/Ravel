import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { ipc } from "../../ipc/client";
import type { ChangeApprovalResult } from "../../types/dto";

export interface ApprovalBarProps {
  snapshotToken: string;
  selectedFiles: string[];
  hasUntrackedSelected: boolean;
  onApplied: (result: ChangeApprovalResult) => void;
}

/**
 * Diff approval bar. Accept = no-op (keep changes). Reject = revert the
 * selected files on the MAIN process (git checkout / git clean). Rejecting
 * untracked files is irreversible — we force a second confirmation with a
 * clear risk warning. See system_design.md §3.4 / 决策 #6.
 */
export function ApprovalBar({ snapshotToken, selectedFiles, hasUntrackedSelected, onApplied }: ApprovalBarProps): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const accept = React.useCallback(async () => {
    setBusy(true);
    const res = await ipc.approveChange({ action: "accept" });
    if (res.ok) onApplied(res.data);
    setBusy(false);
  }, [onApplied]);

  const openReject = React.useCallback(() => {
    if (selectedFiles.length === 0) return;
    setConfirmOpen(true);
  }, [selectedFiles.length]);

  const confirmReject = React.useCallback(async () => {
    setBusy(true);
    const res = await ipc.approveChange({ action: "reject", snapshotToken, files: selectedFiles });
    if (res.ok) onApplied(res.data);
    setConfirmOpen(false);
    setBusy(false);
  }, [selectedFiles, snapshotToken, onApplied]);

  return (
    <Box
      sx={{
        flex: "0 0 auto",
        mt: 1,
        p: 1,
        background: "var(--omega-panel-glass)",
        backdropFilter: "blur(16px) saturate(1.3)",
        WebkitBackdropFilter: "blur(16px) saturate(1.3)",
        border: "1px solid var(--omega-border-strong)",
        borderRadius: "12px",
        boxShadow: "var(--omega-shadow-md), var(--omega-inset-highlight)",
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        zIndex: 2,
        minWidth: 0,
      }}
    >
      <Button
        variant="outlined"
        fullWidth
        onClick={() => void accept()}
        disabled={busy}
        sx={{
          textTransform: "none",
          fontWeight: 600,
          color: "var(--omega-success)",
          borderColor: "var(--omega-border-strong)",
          "&:hover": { borderColor: "var(--omega-success)", background: "var(--omega-success-soft)" },
        }}
      >
        保留全部改动
      </Button>
      <Button
        variant="contained"
        color="error"
        fullWidth
        onClick={openReject}
        disabled={busy || selectedFiles.length === 0}
        sx={{ textTransform: "none", fontWeight: 600, background: "var(--omega-danger)", "&:hover": { background: "var(--omega-danger)", filter: "brightness(1.06)" } }}
      >
        还原所选 · {selectedFiles.length}
      </Button>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 1 }}>
          <WarningAmberIcon sx={{ color: "var(--omega-warning)" }} /> 确认还原改动？
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "var(--omega-text-soft)" }}>
            将还原选中的 {selectedFiles.length} 个文件。已纳入 git 的文件会回到上一次提交/暂存状态。
          </Typography>
          {hasUntrackedSelected ? (
            <Typography sx={{ fontSize: 13, color: "var(--omega-danger)", mt: 1, fontWeight: 600 }}>
              ⚠️ 其中包含未跟踪的新文件，还原将通过 git clean 永久删除，此操作不可撤销。
            </Typography>
          ) : null}
          <Box component="ul" sx={{ mt: 1, pl: 2, color: "var(--omega-text-muted)", fontSize: 12, maxHeight: 160, overflowY: "auto" }}>
            {selectedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} sx={{ textTransform: "none" }}>
            取消
          </Button>
          <Button variant="contained" color="error" onClick={() => void confirmReject()} disabled={busy} sx={{ textTransform: "none" }}>
            确认还原
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
