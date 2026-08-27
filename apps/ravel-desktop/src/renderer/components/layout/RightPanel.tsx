import * as React from "react";
import { IconButton } from "../../ui/Button";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore, type LayoutState } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { DiffViewer } from "../panels/DiffViewer";
import { GraphPanel } from "../panels/GraphPanel";
import { WorktreePanel } from "../panels/WorktreePanel";
import { TelemetryPanel } from "../panels/TelemetryPanel";
import { SnapshotsPanel } from "../panels/SnapshotsPanel";

function CloseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="omega-icon-close" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function isRightTab(value: string): value is LayoutState["rightTab"] {
  return value === "diff" || value === "graph" || value === "worktree" || value === "telemetry" || value === "snapshots";
}

export function RightPanel(): React.ReactElement {
  const t = useT();
  const rightTab = useAppStore((s) => s.layout.rightTab);
  const setRightTab = useAppStore((s) => s.setRightTab);

  return (
    <aside id="omega-right-panel" className="omega-rail omega-right-panel" aria-label={t("nav.asideAria")}>
      <div className="omega-rail-header omega-rail-header-ruled">
        <Tabs
          className="omega-rail-tabs"
          value={rightTab}
          onValueChange={(value) => {
            if (isRightTab(value)) setRightTab(value);
          }}
        >
          <TabsList>
            <TabsTrigger value="diff">{t("nav.tab.diff")}</TabsTrigger>
            <TabsTrigger value="graph">{t("nav.tab.graph")}</TabsTrigger>
            <TabsTrigger value="worktree">{t("nav.tab.worktree")}</TabsTrigger>
            <TabsTrigger value="telemetry">{t("nav.tab.telemetry")}</TabsTrigger>
            <TabsTrigger value="snapshots">{t("nav.tab.snapshots")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton size="sm" label={t("nav.collapseRight")} onClick={() => useAppStore.getState().toggleRightPanel()}>
              <CloseIcon />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>{t("nav.collapseRight")}</TooltipContent>
        </Tooltip>
      </div>
      <div className={rightTab === "diff" ? "omega-rail-body omega-rail-body-clip" : "omega-rail-body"}>
        {rightTab === "diff" ? <DiffViewer /> : null}
        {rightTab === "graph" ? <GraphPanel /> : null}
        {rightTab === "worktree" ? <WorktreePanel /> : null}
        {rightTab === "telemetry" ? <TelemetryPanel /> : null}
        {rightTab === "snapshots" ? <SnapshotsPanel /> : null}
      </div>
    </aside>
  );
}
