import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { ProjectTrustChoice, ProjectTrustInfo } from "../../types/dto";

export interface ProjectTrustDialogProps {
  open: boolean;
  workspace: string;
  trust?: ProjectTrustInfo | null;
  busy?: boolean;
  onDecide: (decision: ProjectTrustChoice) => void;
  onCancel: () => void;
}

function labelFor(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || root;
}

/**
 * Desktop replacement for CLI `/trust`. Trust once keeps project resources for
 * this session; always/never persist through Pi's trust.json. Never still opens
 * the workspace, but project-local extensions and skills stay dormant.
 */
export function ProjectTrustDialog({
  open,
  workspace,
  trust,
  busy,
  onDecide,
  onCancel,
}: ProjectTrustDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="sm" aria-busy={busy}>
      <DialogTitle sx={{ fontWeight: 700 }}>信任此项目？</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}>
        {busy ? <Typography role="status" aria-live="polite" sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>正在保存信任设置…</Typography> : null}
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)" }}>
          「{labelFor(workspace)}」包含可执行的项目扩展、技能或 prompt。
        </Typography>
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text-muted)", fontFamily: "ui-monospace, Consolas, monospace" }}>
          {workspace}
        </Typography>
        <Box sx={{ background: "var(--omega-bg-soft)", borderRadius: "10px", px: 1.5, py: 1.25 }}>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text-muted)", lineHeight: 1.6 }}>
            信任后才会加载该项目自己的 `.pi` 资源和技能。选择「永不信任」仍可打开工作区，但这些资源会保持休眠。
          </Typography>
        </Box>
        {trust?.saved === "trusted" ? (
          <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>已保存过信任决策，可在此重新确认。</Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 0.5, flexWrap: "wrap" }}>
        <Button onClick={onCancel} disabled={busy} sx={{ textTransform: "none" }}>
          取消
        </Button>
        <Button onClick={() => onDecide("never")} disabled={busy} color="error" sx={{ textTransform: "none" }}>
          永不信任
        </Button>
        <Button onClick={() => onDecide("once")} disabled={busy} sx={{ textTransform: "none" }}>
          仅本次
        </Button>
        <Button variant="contained" onClick={() => onDecide("always")} disabled={busy} sx={{ textTransform: "none" }}>
          始终信任
        </Button>
      </DialogActions>
    </Dialog>
  );
}
