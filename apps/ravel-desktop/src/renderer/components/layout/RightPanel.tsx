import * as React from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { DiffViewer } from "../panels/DiffViewer";
import { WorktreePanel } from "../panels/WorktreePanel";
import { TelemetryPanel } from "../panels/TelemetryPanel";
import { SnapshotsPanel } from "../panels/SnapshotsPanel";

export function RightPanel(): React.ReactElement {
  const t = useT();
  const rightTab = useAppStore((s) => s.layout.rightTab);
  const setRightTab = useAppStore((s) => s.setRightTab);

  return (
    <Box
      component="aside"
      id="omega-right-panel"
      aria-label={t("nav.asideAria")}
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
          scrollButtons={false}
          sx={{ flexGrow: 1, minWidth: 0, minHeight: 40, "& .MuiTab-root": { minHeight: 40, minWidth: 0, px: 0.75, fontSize: "0.75rem" } }}
        >
          <Tab label={t("nav.tab.diff")} value="diff" />
          <Tab label={t("nav.tab.worktree")} value="worktree" />
          <Tab label={t("nav.tab.telemetry")} value="telemetry" />
          <Tab label={t("nav.tab.snapshots")} value="snapshots" />
        </Tabs>
        <Tooltip title={t("nav.collapseRight")}>
          <IconButton size="small" aria-label={t("nav.collapseRight")} onClick={() => useAppStore.getState().toggleRightPanel()} sx={{ color: "var(--omega-text-muted)", mr: 0.25, minWidth: 32, minHeight: 32, p: 0.5 }}>
            <CloseIcon sx={{ fontSize: "0.9375rem" }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        sx={{
          flexGrow: 1,
          minHeight: 0,
          minWidth: 0,
          overflowX: "hidden",
          overflowY: rightTab === "diff" ? "hidden" : "auto",
          p: 0.5,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {rightTab === "diff" ? <DiffViewer /> : null}
        {rightTab === "worktree" ? <WorktreePanel /> : null}
        {rightTab === "telemetry" ? <TelemetryPanel /> : null}
        {rightTab === "snapshots" ? <SnapshotsPanel /> : null}
      </Box>
    </Box>
  );
}
