import * as React from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import { useAppStore } from "../../store/useAppStore";
import { SessionList } from "../sessions/SessionList";
import { NewSessionDialog } from "../sessions/NewSessionDialog";
import { FileTree } from "../files/FileTree";

export function LeftNav(): React.ReactElement {
  const [newOpen, setNewOpen] = React.useState(false);
  const leftTab = useAppStore((s) => s.layout.leftTab);
  const setLayout = useAppStore((s) => s.setLayout);

  return (
    <Box
      component="nav"
      id="omega-left-nav"
      aria-label="会话与文件导航"
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
          sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, minWidth: 48, fontSize: 12, px: 1, py: 0.25 } }}
        >
          <Tab label="会话" value="sessions" />
          <Tab label="文件" value="files" />
        </Tabs>
        {leftTab === "sessions" ? (
          <Button
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 15 }} />}
            onClick={() => setNewOpen(true)}
            sx={{
              textTransform: "none",
              borderRadius: "999px",
              flex: "0 0 auto",
              fontWeight: 600,
              fontSize: 12,
              px: 1.25,
              height: 28,
              color: "var(--omega-accent)",
              background: "var(--omega-accent-soft)",
              boxShadow: "var(--omega-inset-highlight)",
              "&:hover": { background: "var(--omega-accent-soft)", transform: "translateY(-0.5px)", boxShadow: "var(--omega-shadow-sm), var(--omega-inset-highlight)" },
              "&:active": { transform: "translateY(0.5px)", boxShadow: "var(--omega-inset-recessed)" },
            }}
          >
            新建
          </Button>
        ) : null}
      </Box>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 0.75, pb: 1.5, pt: 0.5 }}>
        {leftTab === "sessions" ? <SessionList /> : <FileTree />}
      </Box>
      <NewSessionDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </Box>
  );
}
