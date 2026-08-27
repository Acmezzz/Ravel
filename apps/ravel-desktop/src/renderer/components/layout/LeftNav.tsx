import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore, type LayoutState } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { attentionCount, readClearedMap } from "../../lib/activity-projection";
import { SessionList } from "../sessions/SessionList";
import { ActivityList } from "../sessions/ActivityList";
import { NewSessionDialog } from "../sessions/NewSessionDialog";
import { FileTree } from "../files/FileTree";
import { SearchPanel } from "../files/SearchPanel";

function PlusIcon(): React.ReactElement {
  return <Plus className="omega-icon-plus" strokeWidth={1.6} aria-hidden="true" />;
}

function CloseIcon(): React.ReactElement {
  return <X className="omega-icon-close" strokeWidth={1.6} aria-hidden="true" />;
}

function isLeftTab(value: string): value is LayoutState["leftTab"] {
  return value === "sessions" || value === "files" || value === "search" || value === "activity";
}

export function LeftNav(): React.ReactElement {
  const t = useT();
  const [newOpen, setNewOpen] = React.useState(false);
  const leftTab = useAppStore((s) => s.layout.leftTab);
  const setLayout = useAppStore((s) => s.setLayout);
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel);

  // 动态 tab badge: live rows joined with per-session unread flags.
  const activityRows = useAppStore((s) => s.activityRows);
  const sessionActivity = useAppStore((s) => s.sessionActivity);
  const attention = React.useMemo(
    () => attentionCount(Object.values(activityRows), readClearedMap(), sessionActivity),
    [activityRows, sessionActivity],
  );

  return (
    <nav id="omega-left-nav" className="omega-rail" aria-label={t("nav.sessionsFilesAria")}>
      <div className="omega-rail-header">
        <Tabs
          className="omega-rail-tabs"
          value={leftTab}
          onValueChange={(value) => {
            if (isLeftTab(value)) setLayout({ leftTab: value });
          }}
        >
          <TabsList>
            <TabsTrigger value="sessions">{t("nav.tab.sessions")}</TabsTrigger>
            <TabsTrigger value="activity" className={attention > 0 ? "omega-attention-dot" : undefined}>
              {t("nav.tab.activity")}
            </TabsTrigger>
            <TabsTrigger value="files">{t("nav.tab.files")}</TabsTrigger>
            <TabsTrigger value="search">{t("nav.tab.search")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {leftTab === "sessions" ? (
          <Button
            size="sm"
            className="omega-rail-new"
            leading={<PlusIcon />}
            onClick={() => setNewOpen(true)}
            aria-label={t("nav.newSession")}
            title={t("nav.newSession")}
          >
            {t("nav.newSession")}
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton size="sm" label={t("nav.collapseLeft")} onClick={toggleLeftPanel}>
              <CloseIcon />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>{t("nav.collapseLeft")}</TooltipContent>
        </Tooltip>
      </div>
      <div className={leftTab === "activity" || leftTab === "search" ? "omega-rail-body omega-rail-body-clip" : "omega-rail-body"}>
        {leftTab === "sessions" ? <SessionList /> : leftTab === "activity" ? <ActivityList /> : leftTab === "search" ? <SearchPanel /> : <FileTree />}
      </div>
      <NewSessionDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </nav>
  );
}
