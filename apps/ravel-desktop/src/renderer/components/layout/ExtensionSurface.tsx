import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { shallow } from "zustand/shallow";
import { useAppStore } from "../../store/useAppStore";

export function ExtensionSurface(): React.ReactElement | null {
  const { sessionId, statuses, widgets } = useAppStore(
    (s) => ({
      sessionId: s.activeSessionId,
      statuses: s.extensionStatuses.filter((item) => item.sessionId === s.activeSessionId),
      widgets: s.extensionWidgets.filter((item) => item.sessionId === s.activeSessionId),
    }),
    shallow,
  );
  if (!sessionId || (statuses.length === 0 && widgets.length === 0)) return null;
  return (
    <Box sx={{ px: 1.5, pt: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
      {statuses.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {statuses.map((status) => <Chip key={status.key} size="small" label={`${status.key}: ${status.text}`} variant="outlined" />)}
        </Box>
      )}
      {widgets.map((widget) => (
        <Paper key={widget.key} variant="outlined" sx={{ px: 1, py: 0.75, background: "var(--omega-bg-rail)" }}>
          <Typography variant="caption" sx={{ color: "var(--omega-text-muted)" }}>{widget.key}</Typography>
          {widget.lines.map((line, index) => <Typography key={`${widget.key}-${index}`} component="div" sx={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{line}</Typography>)}
        </Paper>
      ))}
    </Box>
  );
}
