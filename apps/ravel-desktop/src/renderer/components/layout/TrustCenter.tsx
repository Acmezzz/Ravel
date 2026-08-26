import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import type { ProjectTrustChoice, WorkspaceInfo } from "../../types/dto";

const choices: Array<{ value: ProjectTrustChoice; label: string }> = [
  { value: "once", label: "仅本次信任" },
  { value: "always", label: "始终信任" },
  { value: "never", label: "不信任" },
];

export function TrustCenter(): React.ReactElement {
  const open = useAppStore((s) => s.layout.trustCenterOpen);
  const setOpen = useAppStore((s) => s.setTrustCenterOpen);
  const [items, setItems] = React.useState<WorkspaceInfo[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = React.useState<Record<string, ProjectTrustChoice | "">>({});

  const refresh = React.useCallback(async () => {
    const result = await ipc.listWorkspaces();
    if (result.ok) setItems(result.data);
    else setError(result.message);
  }, []);

  React.useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const decide = async (workspace: WorkspaceInfo, decision: ProjectTrustChoice) => {
    setBusy(workspace.realRoot);
    setError(null);
    setPendingChoice((current) => ({ ...current, [workspace.realRoot]: decision }));
    const result = await ipc.decideProjectTrust({ workspace: workspace.realRoot, decision });
    if (result.ok) setItems(result.data.workspaces);
    else setError(result.message);
    setBusy(null);
  };

  return <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
    <DialogTitle>项目 Trust Center</DialogTitle>
    <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>集中管理项目扩展、skills 和 prompt 的执行信任。父目录已有信任时会在项目状态中显示继承提示。</Typography>
      {items.map((workspace) => {
        const inherited = items.some((parent) => parent.realRoot !== workspace.realRoot && workspace.realRoot.startsWith(`${parent.realRoot.replace(/[\\/]$/, "")}${workspace.realRoot.includes("\\") ? "\\" : "/"}`) && parent.trust === "trusted");
        return <Box key={workspace.workspaceId} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75, borderBottom: "1px solid var(--omega-border)" }}>
          <Box sx={{ minWidth: 0, flex: 1 }}><Typography sx={{ fontSize: "0.8125rem", fontWeight: 600 }} noWrap>{workspace.displayPath}</Typography><Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }} noWrap>{workspace.resourcesDormant ? "项目资源休眠" : "项目资源可用"}</Typography></Box>
          {inherited ? <Chip size="small" label="继承父目录信任" sx={{ height: 19, fontSize: "0.65625rem" }} /> : null}
          <Chip size="small" label={workspace.trust === "trusted" ? "trusted" : workspace.trust === "untrusted" ? "untrusted" : "undecided"} color={workspace.trust === "trusted" ? "success" : "default"} sx={{ height: 19, fontSize: "0.65625rem" }} />
          <TextField
            select
            size="small"
            value={pendingChoice[workspace.realRoot] ?? (workspace.trust === "trusted" ? "always" : workspace.trust === "untrusted" ? "never" : "")}
            disabled={busy === workspace.realRoot}
            onChange={(event) => {
              const value = event.target.value as ProjectTrustChoice;
              if (value) void decide(workspace, value);
            }}
            sx={{ minWidth: 150 }}
          >
            {choices.map((choice) => <MenuItem key={choice.value} value={choice.value}>{choice.label}</MenuItem>)}
          </TextField>
        </Box>;
      })}
      {items.length === 0 ? <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>还没有已授权工作区。</Typography> : null}
      {error ? <Typography sx={{ color: "var(--omega-danger)", fontSize: "0.75rem" }}>{error}</Typography> : null}
    </DialogContent>
    <DialogActions><Button onClick={() => setOpen(false)}>完成</Button></DialogActions>
  </Dialog>;
}
