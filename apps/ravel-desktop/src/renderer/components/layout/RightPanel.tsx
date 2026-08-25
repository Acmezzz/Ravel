import * as React from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { WorkflowPanel } from "../panels/WorkflowPanel";
import { ScoutPanel } from "../panels/ScoutPanel";
import { DiffViewer } from "../panels/DiffViewer";
import { WorktreePanel } from "../panels/WorktreePanel";

export function RightPanel(): React.ReactElement {
  const rightTab = useAppStore((s) => s.layout.rightTab);
  const setRightTab = useAppStore((s) => s.setRightTab);
  const setExtensionState = useAppStore((s) => s.setExtensionState);
  const setExtensionLoading = useAppStore((s) => s.setExtensionLoading);
  const extensionLoading = useAppStore((s) => s.extensionLoading);
  const [extensionError, setExtensionError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setExtensionLoading(true);
    setExtensionError(null);
    try {
      const res = await ipc.queryExtensionState({ scope: "all" });
      if (res.ok) setExtensionState(res.data);
      else setExtensionError(res.message);
    } catch (reason) {
      setExtensionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExtensionLoading(false);
    }
  }, [setExtensionState, setExtensionLoading]);

  return (
    <Box
      component="aside"
      id="omega-right-panel"
      aria-label="工作台辅助面板"
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--omega-bg-rail)",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--omega-border)" }}>
        <Tabs
          value={rightTab}
          onChange={(_e, v) => setRightTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ flexGrow: 1, minWidth: 0, minHeight: 44, "& .MuiTab-root": { minHeight: 44, minWidth: 0, px: 1.25, fontSize: 13 } }}
        >
          <Tab label="Workflow" value="workflow" />
          <Tab label="Scout" value="scout" />
          <Tab label="Diff" value="diff" />
          <Tab label="Worktree" value="worktree" />
        </Tabs>
        <Tooltip title="刷新扩展状态">
          <IconButton size="small" aria-label="刷新扩展状态" onClick={() => void refresh()} sx={{ color: "var(--omega-text-muted)", mr: 1, minWidth: 40, minHeight: 40 }} disabled={extensionLoading}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {extensionLoading ? <Box role="status" aria-live="polite" sx={{ px: 1.25, py: 0.5, fontSize: 10.5, color: "var(--omega-text-muted)" }}>正在刷新扩展状态…</Box> : null}
      {extensionError ? <Box role="alert" sx={{ px: 1.25, py: 0.5, display: "flex", alignItems: "center", gap: 1, fontSize: 10.5, color: "var(--omega-danger)" }}>{extensionError}<Button size="small" onClick={() => void refresh()} sx={{ textTransform: "none" }}>重试</Button></Box> : null}
      <Box
        sx={{
          flexGrow: 1,
          minHeight: 0,
          minWidth: 0,
          overflowX: "hidden",
          overflowY: rightTab === "diff" ? "hidden" : "auto",
          p: 1.25,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {rightTab === "workflow" ? <WorkflowPanel /> : null}
        {rightTab === "scout" ? <ScoutPanel /> : null}
        {rightTab === "diff" ? <DiffViewer /> : null}
        {rightTab === "worktree" ? <WorktreePanel /> : null}
      </Box>
    </Box>
  );
}
