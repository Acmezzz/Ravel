import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";

function labelFor(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || root;
}

export function ProjectSwitcher(): React.ReactElement {
  const agent = useAppStore((state) => state.agent);
  const connection = useAppStore((state) => state.connection);
  const setAgent = useAppStore((state) => state.setAgent);
  const setSessions = useAppStore((state) => state.setSessions);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [workspaces, setWorkspaces] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const result = await ipc.listWorkspaces();
    if (result.ok) setWorkspaces(result.data);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchTo = React.useCallback(async (root: string) => {
    setBusy(true);
    setError(null);
    const result = await ipc.switchWorkspace({ workspace: root });
    if (result.ok) {
      const state = await ipc.getState();
      if (state.ok) setAgent(state.data);
      const sessions = await ipc.listSessions();
      if (sessions.ok) setSessions(sessions.data);
      setAnchor(null);
    } else {
      setError(result.message);
    }
    setBusy(false);
  }, [setAgent, setSessions]);

  const choose = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await ipc.chooseWorkspace();
    if (result.ok) {
      setWorkspaces(result.data.workspaces);
      await switchTo(result.data.root);
    } else if (result.code !== "cancelled") {
      setError(result.message);
    }
    setBusy(false);
  }, [switchTo]);

  const current = agent?.cwd || "未选择项目";
  const disabled = busy || connection === "running";

  return (
    <>
      <Button
        size="small"
        onClick={(event) => {
          setError(null);
          setAnchor(event.currentTarget);
          void refresh();
        }}
        startIcon={<FolderOpenOutlinedIcon sx={{ fontSize: 16 }} />}
        endIcon={<ExpandMoreIcon sx={{ fontSize: 15 }} />}
        disabled={disabled}
        sx={{ maxWidth: 240, minWidth: 0, justifyContent: "flex-start", textTransform: "none", color: "var(--omega-text-muted)", borderRadius: "9px", px: 1, overflow: "hidden" }}
      >
        <Typography component="span" sx={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={current}>
          {labelFor(current)}
        </Typography>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {workspaces.map((root) => (
          <MenuItem key={root} selected={root === current} disabled={busy} onClick={() => void switchTo(root)}>
            <Box sx={{ minWidth: 210 }}>
              <Typography sx={{ fontSize: 13 }}>{labelFor(root)}</Typography>
              <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-muted)" }} noWrap>{root}</Typography>
            </Box>
          </MenuItem>
        ))}
        <MenuItem disabled={busy} onClick={() => void choose()}>
          <AddIcon sx={{ fontSize: 17, mr: 1 }} /> 添加工作区…
        </MenuItem>
        {error ? <Typography sx={{ px: 2, py: 0.75, maxWidth: 260, color: "var(--omega-danger)", fontSize: 11 }}>{error}</Typography> : null}
      </Menu>
    </>
  );
}
