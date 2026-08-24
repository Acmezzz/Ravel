import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
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

function isImage(file: { mimeType?: string; dataUrl?: string } | null): boolean { return Boolean(file?.mimeType?.startsWith("image/") && file.dataUrl); }
function isAudio(file: { mimeType?: string; dataUrl?: string } | null): boolean { return Boolean(file?.mimeType?.startsWith("audio/") && file.dataUrl); }
function isPdf(file: { mimeType?: string; dataUrl?: string } | null): boolean { return Boolean(file?.mimeType === "application/pdf" && file.dataUrl); }
function isMermaid(path: string | null): boolean { return extOf(path) === "mmd" || extOf(path) === "mermaid"; }
function isMath(path: string | null): boolean { return extOf(path) === "tex" || extOf(path) === "latex"; }
function isDocx(file: { docx?: boolean } | null): boolean { return Boolean(file?.docx); }

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
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"source" | "preview">("source");
  const [selection, setSelection] = React.useState<{ start: number; end: number } | null>(null);
  const [tabs, setTabs] = React.useState<string[]>([]);
  const [displayedContent, setDisplayedContent] = React.useState("");
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [watching, setWatching] = React.useState(false);
  const [diffMode, setDiffMode] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const pageRequestEpochRef = React.useRef(0);

  React.useEffect(() => {
    const watchEpoch = ++pageRequestEpochRef.current;
    const requestPath = viewer.path;
    if (!requestPath) return;
    void ipc.watchFile({ path: requestPath }).then((result) => {
      if (watchEpoch !== pageRequestEpochRef.current || useAppStore.getState().viewer.path !== requestPath) return;
      if (result.ok) setWatching(result.data.watching);
    });
    const off = ipc.onFileChanged((data) => { if (data.path === requestPath) void useAppStore.getState().openViewer(requestPath); });
    return () => { off(); void ipc.unwatchFile({ path: requestPath }); setWatching(false); };
  }, [viewer.path]);

  React.useEffect(() => {
    setMode(isMarkdown(viewer.path) || isMermaid(viewer.path) || isMath(viewer.path) ? "preview" : "source");
    setDiffMode(false);
    setSelection(null);
    setDisplayedContent(viewer.file?.content ?? "");
    setNextOffset(viewer.file?.nextOffset ?? null);
    setPageError(null);
    if (viewer.path && !tabs.includes(viewer.path)) setTabs((current) => [...current, viewer.path!].slice(-8));
  }, [viewer.file?.content, viewer.file?.nextOffset, viewer.path]);

  const copy = React.useCallback(async () => {
    if (!viewer.file?.content) return;
    try {
      await navigator.clipboard.writeText(viewer.file.content);
      setCopyError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError("复制失败，请检查剪贴板权限");
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

  const lines = displayedContent && !viewer.file?.binary ? numbered(displayedContent) : [];
  const loadMore = React.useCallback(async () => {
    if (!viewer.path || nextOffset === null || loadingMore) return;
    const requestEpoch = pageRequestEpochRef.current;
    const requestPath = viewer.path;
    const requestOffset = nextOffset;
    setLoadingMore(true);
    try {
      const res = await ipc.readFilePage({ path: requestPath, offset: requestOffset, limit: 400 });
      if (requestEpoch !== pageRequestEpochRef.current || useAppStore.getState().viewer.path !== requestPath) return;
      if (res.ok) {
        setPageError(null);
        setDisplayedContent((current) => `${current}${current ? "\n" : ""}${res.data.content ?? ""}`);
        setNextOffset(res.data.nextOffset);
      } else setPageError(res.message);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestEpoch === pageRequestEpochRef.current) setLoadingMore(false);
    }
  }, [loadingMore, nextOffset, viewer.path]);

  return (
    <Dialog open={viewer.open} onClose={closeViewer} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        <Box sx={{ display: "flex", gap: 0.5, minWidth: 0, overflow: "auto" }}>
          {tabs.map((tab) => <Typography key={tab} component="button" type="button" onClick={() => void useAppStore.getState().openViewer(tab)} sx={{ fontSize: 12, px: 0.75, py: 0.25, cursor: "pointer", whiteSpace: "nowrap", color: tab === viewer.path ? "var(--omega-accent)" : "var(--omega-text-muted)", border: "none", borderBottom: tab === viewer.path ? "2px solid var(--omega-accent)" : "2px solid transparent", background: "transparent" }}>{tab.split(/[\\/]/).pop()}</Typography>)}
        </Box>
        {viewer.file ? (
          <Typography component="span" sx={{ fontSize: 11, color: "var(--omega-text-dim)", flex: "0 0 auto" }}>
            {formatSize(viewer.file.size)}
            {viewer.file.truncated ? "（已截断）" : ""}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        {isMarkdown(viewer.path) || isMermaid(viewer.path) || isMath(viewer.path) ? (
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <Typography
              component="button"
              type="button"
              onClick={() => setMode("source")}
              sx={{ fontSize: 11, cursor: "pointer", color: mode === "source" ? "var(--omega-accent)" : "var(--omega-text-dim)", border: "none", background: "transparent", p: 0 }}
            >
              源码
            </Typography>
            <Typography component="button" type="button" onClick={() => setDiffMode((current) => !current)} sx={{ fontSize: 11, cursor: "pointer", color: diffMode ? "var(--omega-accent)" : "var(--omega-text-dim)", border: "none", background: "transparent", p: 0 }}>diff</Typography>
            <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)" }}>/</Typography>
            <Typography
              component="button"
              type="button"
              onClick={() => setMode("preview")}
              sx={{ fontSize: 11, cursor: "pointer", color: mode === "preview" ? "var(--omega-accent)" : "var(--omega-text-dim)", border: "none", background: "transparent", p: 0 }}
            >
              预览
            </Typography>
          </Box>
        ) : null}
        <Typography sx={{ fontSize: 10, color: watching ? "var(--omega-accent)" : "var(--omega-text-dim)" }}>{watching ? "实时" : "静态"}</Typography>
        <Tooltip title="使用系统默认应用打开">
          <IconButton aria-label="使用系统默认应用打开" size="small" onClick={() => { if (viewer.path) void ipc.openFileDefault({ path: viewer.path }); }} sx={{ color: "var(--omega-text-dim)" }}><Typography sx={{ fontSize: 10 }}>外部</Typography></IconButton>
        </Tooltip>
        <Tooltip title="在资源管理器中显示">
          <IconButton aria-label="在资源管理器中显示" size="small" onClick={() => void reveal()} sx={{ color: "var(--omega-text-dim)" }}>
            <FolderOpenIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ position: "relative", minHeight: 200 }}>
        {viewer.loading ? (
          <Box role="status" aria-live="polite" aria-busy="true" sx={{ display: "grid", placeItems: "center", py: 6 }}>
            <CircularProgress size={22} sx={{ color: "var(--omega-accent)" }} />
            <Typography sx={{ fontSize: 12, color: "var(--omega-text-muted)" }}>正在加载文件…</Typography>
          </Box>
        ) : viewer.error ? (
          <Box role="alert" sx={{ display: "grid", gap: 1 }}><Typography sx={{ fontSize: 13, color: "var(--omega-danger)" }}>{viewer.error}</Typography><Button size="small" onClick={() => { if (viewer.path) void useAppStore.getState().openViewer(viewer.path); }} sx={{ justifySelf: "start", textTransform: "none" }}>重试</Button></Box>
        ) : isImage(viewer.file) ? (
          <Box component="img" src={viewer.file?.dataUrl} alt={viewer.path ?? "image"} sx={{ display: "block", maxWidth: "100%", maxHeight: "64vh", mx: "auto", objectFit: "contain" }} />
        ) : isAudio(viewer.file) ? (
          <Box component="audio" controls src={viewer.file?.dataUrl} sx={{ width: "100%" }} />
        ) : isPdf(viewer.file) ? (
          <Box component="iframe" title={viewer.path ?? "PDF"} src={viewer.file?.dataUrl} sx={{ width: "100%", height: "64vh", border: 0 }} />
        ) : viewer.file?.binary ? (
          <Typography sx={{ fontSize: 13, color: "var(--omega-text-muted)" }}>该二进制文件暂不支持内嵌预览，可用资源管理器打开。</Typography>
        ) : mode === "preview" && isMarkdown(viewer.path) ? (
          <Box sx={{ maxHeight: "64vh", overflow: "auto" }}><Markdown>{viewer.file?.content ?? ""}</Markdown></Box>
        ) : isDocx(viewer.file) ? (
          <Box sx={{ maxHeight: "64vh", overflow: "auto", p: 1.5, border: "1px solid var(--omega-border)", background: "var(--omega-bg-code)" }}><Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.7, m: 0 }}>{viewer.file?.content ?? ""}</Typography></Box>
        ) : mode === "preview" && isMermaid(viewer.path) ? (
          <Box component="pre" sx={{ p: 2, whiteSpace: "pre-wrap", border: "1px solid var(--omega-border)", background: "var(--omega-bg-code)" }}>Mermaid source（安全预览）{"\n\n"}{viewer.file?.content ?? ""}</Box>
        ) : mode === "preview" && isMath(viewer.path) ? (
          <Box component="pre" sx={{ p: 2, whiteSpace: "pre-wrap", border: "1px solid var(--omega-border)", background: "var(--omega-bg-code)" }}>LaTeX source（安全预览）{"\n\n"}{viewer.file?.content ?? ""}</Box>
        ) : diffMode ? (
          <Box component="pre" sx={{ p: 1, whiteSpace: "pre-wrap", color: "var(--omega-text-soft)", background: "var(--omega-bg-code)" }}>{(displayedContent || "").split("\n").map((line) => `${line.startsWith("+") ? "+ " : line.startsWith("-") ? "- " : "  "}${line}`).join("\n")}</Box>
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
                  role="button"
                  tabIndex={0}
                  aria-selected={Boolean(active)}
                  aria-label={`选择第 ${line.n} 行`}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelection({ start: line.n, end: line.n }); } }}
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
            {pageError ? <Typography role="alert" sx={{ fontSize: 12, color: "var(--omega-danger)", mt: 1 }}>{pageError}</Typography> : null}
            {nextOffset !== null ? <Button size="small" onClick={() => void loadMore()} disabled={loadingMore} sx={{ mt: 1, textTransform: "none" }}>{loadingMore ? "加载中…" : "加载更多行"}</Button> : null}
          </Box>
        )}
        {copyError ? <Typography role="alert" sx={{ position: "absolute", bottom: 12, left: 16, fontSize: 12, color: "var(--omega-danger)" }}>{copyError}</Typography> : null}
        {copied ? <Typography role="status" aria-live="polite" sx={{ position: "absolute", bottom: 12, left: 16, fontSize: 12, color: "var(--omega-accent)" }}>已复制文件内容</Typography> : null}
        {viewer.file?.content ? (
          <Box sx={{ position: "absolute", top: 8, right: 12, display: "flex", gap: 0.5 }}>
            {selection ? (
              <Tooltip title={`引用 @${viewer.path}:${Math.min(selection.start, selection.end)}-${Math.max(selection.start, selection.end)}`}>
                <IconButton aria-label="引用选中的行" size="small" onClick={quoteSelection} sx={{ color: "var(--omega-accent)" }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700 }}>@</Typography>
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title={copied ? "已复制" : "复制内容"}>
              <IconButton aria-label="复制文件内容" size="small" onClick={() => void copy()} sx={{ color: "var(--omega-text-dim)", "&:hover": { color: "var(--omega-accent)" } }}>
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
