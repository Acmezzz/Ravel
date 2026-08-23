import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FolderOpenIcon from "@mui/icons-material/FolderOpenOutlined";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { Markdown } from "../common/Markdown";

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function extOf(path: string | null): string {
  if (!path) return "";
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isMarkdown(path: string | null): boolean {
  return ["md", "markdown", "mdx"].includes(extOf(path));
}

function numbered(content: string): Array<{ n: number; text: string }> {
  const lines = content.split("\n");
  return lines.map((text, index) => ({ n: index + 1, text }));
}

/** Read-only file viewer dialog (text, size-capped; binary guarded). */
export function FileViewer(): React.ReactElement {
  const viewer = useAppStore((s) => s.viewer);
  const closeViewer = useAppStore((s) => s.closeViewer);
  const setComposerPrefill = useAppStore((s) => s.setComposerPrefill);
  const [copied, setCopied] = React.useState(false);
  const [mode, setMode] = React.useState<"source" | "preview">("source");
  const [selection, setSelection] = React.useState<{ start: number; end: number } | null>(null);

  React.useEffect(() => {
    setMode(isMarkdown(viewer.path) ? "preview" : "source");
    setSelection(null);
  }, [viewer.path]);

  const copy = React.useCallback(async () => {
    if (!viewer.file?.content) return;
    try {
      await navigator.clipboard.writeText(viewer.file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sandboxed clipboard may be blocked */
    }
  }, [viewer.file?.content]);

  const quoteSelection = React.useCallback(() => {
    if (!viewer.path || !selection) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    setComposerPrefill(`@${viewer.path}:${start}-${end}`);
  }, [selection, setComposerPrefill, viewer.path]);

  const reveal = React.useCallback(async () => {
    if (!viewer.path) return;
    await ipc.revealInFolder({ path: viewer.path });
  }, [viewer.path]);

  const lines = viewer.file?.content && !viewer.file.binary ? numbered(viewer.file.content) : [];

  return (
    <Dialog open={viewer.open} onClose={closeViewer} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        <Typography component="span" sx={{ fontSize: 15, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {viewer.path ?? ""}
        </Typography>
        {viewer.file ? (
          <Typography component="span" sx={{ fontSize: 11, color: "var(--omega-text-dim)", flex: "0 0 auto" }}>
            {formatSize(viewer.file.size)}
            {viewer.file.truncated ? "（已截断）" : ""}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        {isMarkdown(viewer.path) ? (
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <Typography
              onClick={() => setMode("source")}
              sx={{ fontSize: 11, cursor: "pointer", color: mode === "source" ? "var(--omega-accent)" : "var(--omega-text-dim)" }}
            >
              源码
            </Typography>
            <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }}>/</Typography>
            <Typography
              onClick={() => setMode("preview")}
              sx={{ fontSize: 11, cursor: "pointer", color: mode === "preview" ? "var(--omega-accent)" : "var(--omega-text-dim)" }}
            >
              预览
            </Typography>
          </Box>
        ) : null}
        <Tooltip title="在资源管理器中显示">
          <IconButton size="small" onClick={() => void reveal()} sx={{ color: "var(--omega-text-dim)" }}>
            <FolderOpenIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ position: "relative", minHeight: 200 }}>
        {viewer.loading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
            <CircularProgress size={22} sx={{ color: "var(--omega-accent)" }} />
          </Box>
        ) : viewer.error ? (
          <Typography sx={{ fontSize: 13, color: "var(--omega-danger)" }}>{viewer.error}</Typography>
        ) : viewer.file?.binary ? (
          <Typography sx={{ fontSize: 13, color: "var(--omega-text-muted)" }}>二进制文件，无法预览。可用资源管理器打开。</Typography>
        ) : mode === "preview" && isMarkdown(viewer.path) ? (
          <Box sx={{ maxHeight: "64vh", overflow: "auto" }}>
            <Markdown>{viewer.file?.content ?? ""}</Markdown>
          </Box>
        ) : (
          <Box
            sx={{
              m: 0,
              p: 1,
              borderRadius: "10px",
              border: "1px solid var(--omega-border)",
              background: "var(--omega-bg-code)",
              fontSize: 12,
              lineHeight: 1.6,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              color: "var(--omega-text-soft)",
              overflow: "auto",
              maxHeight: "64vh",
            }}
          >
            {lines.map((line) => {
              const active = selection && line.n >= Math.min(selection.start, selection.end) && line.n <= Math.max(selection.start, selection.end);
              return (
                <Box
                  key={line.n}
                  onClick={(e) => {
                    if (e.shiftKey && selection) setSelection({ start: selection.start, end: line.n });
                    else setSelection({ start: line.n, end: line.n });
                  }}
                  sx={{
                    display: "flex",
                    gap: 1,
                    cursor: "text",
                    background: active ? "var(--omega-accent-soft)" : "transparent",
                    "&:hover": { background: active ? "var(--omega-accent-soft)" : "var(--omega-hover-fill)" },
                  }}
                >
                  <Typography component="span" sx={{ width: 36, flex: "0 0 auto", color: "var(--omega-text-dim)", userSelect: "none", textAlign: "right" }}>
                    {line.n}
                  </Typography>
                  <Typography component="span" sx={{ whiteSpace: "pre", minWidth: 0 }}>
                    {line.text || " "}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
        {viewer.file?.content ? (
          <Box sx={{ position: "absolute", top: 8, right: 12, display: "flex", gap: 0.5 }}>
            {selection ? (
              <Tooltip title={`引用 @${viewer.path}:${Math.min(selection.start, selection.end)}-${Math.max(selection.start, selection.end)}`}>
                <IconButton size="small" onClick={quoteSelection} sx={{ color: "var(--omega-accent)" }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700 }}>@</Typography>
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title={copied ? "已复制" : "复制内容"}>
              <IconButton size="small" onClick={() => void copy()} sx={{ color: "var(--omega-text-dim)", "&:hover": { color: "var(--omega-accent)" } }}>
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
