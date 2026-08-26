import * as React from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { attentionCount, readClearedMap } from "../../lib/activity-projection";
import { SessionList } from "../sessions/SessionList";
import { ActivityList } from "../sessions/ActivityList";
import { NewSessionDialog } from "../sessions/NewSessionDialog";
import { FileTree } from "../files/FileTree";
import { SearchPanel } from "../files/SearchPanel";

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
    <Box
      component="nav"
      id="omega-left-nav"
      aria-label={t("nav.sessionsFilesAria")}
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--omega-bg-rail)",
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 1.25, pt: 1, pb: 0.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
        <Tabs
          value={leftTab}
          onChange={(_e, value) => setLayout({ leftTab: value })}
          sx={{ flex: 1, minWidth: 0, minHeight: 32, "& .MuiTabs-flexContainer": { minWidth: 0 }, "& .MuiTab-root": { minHeight: 32, minWidth: 40, fontSize: "0.75rem", px: 0.5, py: 0.25 } }}
        >
          <Tab label={t("nav.tab.sessions")} value="sessions" />
          <Tab
            label={
              <Badge color="error" variant="dot" invisible={attention === 0} sx={{ "& .MuiBadge-badge": { top: 4, right: -4 } }}>
                {t("nav.tab.activity")}
              </Badge>
            }
            value="activity"
          />
          <Tab label={t("nav.tab.files")} value="files" />
          <Tab label={t("nav.tab.search")} value="search" />
        </Tabs>
        {leftTab === "sessions" ? (
          <Button
            size="small"
            startIcon={<AddIcon sx={{ fontSize: "0.9375rem" }} />}
            onClick={() => setNewOpen(true)}
            aria-label={t("nav.newSession")}
            title={t("nav.newSession")}
            sx={{
              textTransform: "none",
              borderRadius: "999px",
              flex: "0 0 auto",
              fontWeight: 600,
              fontSize: "0.75rem",
              px: 0.75,
              minWidth: 0,
              height: 28,
              color: "var(--omega-accent)",
              background: "var(--omega-accent-soft)",
              boxShadow: "var(--omega-inset-highlight)",
              "&:hover": { background: "var(--omega-accent-soft)", transform: "translateY(-0.5px)", boxShadow: "var(--omega-shadow-sm), var(--omega-inset-highlight)" },
              "&:active": { transform: "translateY(0.5px)", boxShadow: "var(--omega-inset-recessed)" },
            }}
          >
            {t("nav.newSession")}
          </Button>
        ) : null}
        <Tooltip title={t("nav.collapseLeft")}>
          <IconButton size="small" aria-label={t("nav.collapseLeft")} onClick={toggleLeftPanel} sx={{ color: "var(--omega-text-muted)", flex: "0 0 auto" }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 0.75, pb: 1.5, pt: 0.5 }}>
        {leftTab === "sessions" ? <SessionList /> : leftTab === "activity" ? <ActivityList /> : leftTab === "search" ? <SearchPanel /> : <FileTree />}
      </Box>
      <NewSessionDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </Box>
  );
}
