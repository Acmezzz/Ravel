import * as React from "react";
import { Copy, Folder } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
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

function normalizePath(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
}

function pathsMatch(leftPath: string, rightPath: string): boolean {
  const left = normalizePath(leftPath);
  const right = normalizePath(rightPath);
  if (!left || !right) return false;
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function CopyIcon(): React.ReactElement {
  return <Copy className="omega-file-viewer-icon" strokeWidth={1.5} aria-hidden="true" />;
}

function FolderIcon(): React.ReactElement {
  return <Folder className="omega-file-viewer-icon" strokeWidth={1.5} aria-hidden="true" />;
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
    const off = ipc.onFileChanged((data) => {
      if (pathsMatch(data.path, requestPath) && useAppStore.getState().viewer.path === requestPath) void useAppStore.getState().openViewer(requestPath);
    });
    return () => { off(); void ipc.unwatchFile({ path: requestPath }); setWatching(false); };
  }, [viewer.path]);

  React.useEffect(() => {
    setMode(isMarkdown(viewer.path) || isMermaid(viewer.path) || isMath(viewer.path) ? "preview" : "source");
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
    <Dialog open={viewer.open} onOpenChange={(open) => { if (!open) closeViewer(); }}>
      <DialogContent className="omega-file-viewer-dialog">
        <DialogTitle className="omega-file-viewer-title">
          <div className="omega-file-viewer-tabs">
            {tabs.map((tab) => <button key={tab} className={`omega-file-viewer-tab${tab === viewer.path ? " is-active" : ""}`} type="button" onClick={() => void useAppStore.getState().openViewer(tab)}>{tab.split(/[\\/]/).pop()}</button>)}
          </div>
          {viewer.file ? <span className="omega-file-viewer-size">{formatSize(viewer.file.size)}{viewer.file.truncated ? "（已截断）" : ""}</span> : null}
          <span className="omega-file-viewer-spacer" />
          {isMarkdown(viewer.path) || isMermaid(viewer.path) || isMath(viewer.path) ? (
            <div className="omega-file-viewer-mode-tabs">
              <button className={mode === "source" ? "is-active" : ""} type="button" onClick={() => setMode("source")}>源码</button>
              <button className={mode === "preview" ? "is-active" : ""} type="button" onClick={() => setMode("preview")}>预览</button>
            </div>
          ) : null}
          <span className={`omega-file-viewer-watch${watching ? " is-watching" : ""}`}>{watching ? "实时" : "静态"}</span>
          <Tooltip><TooltipTrigger asChild><IconButton label="使用系统默认应用打开" size="sm" className="omega-file-viewer-external" onClick={() => { if (viewer.path) void ipc.openFileDefault({ path: viewer.path }); }}>外部</IconButton></TooltipTrigger><TooltipContent>使用系统默认应用打开</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><IconButton label="在资源管理器中显示" size="sm" className="omega-file-viewer-action" onClick={() => void reveal()}><FolderIcon /></IconButton></TooltipTrigger><TooltipContent>在资源管理器中显示</TooltipContent></Tooltip>
        </DialogTitle>
        <div className="omega-file-viewer-content">
          {viewer.loading ? (
            <div className="omega-file-viewer-loading" role="status" aria-live="polite" aria-busy="true"><span className="omega-file-viewer-spinner" aria-hidden="true" /><span>正在加载文件…</span></div>
          ) : viewer.error ? (
            <div className="omega-file-viewer-error" role="alert"><p>{viewer.error}</p><Button size="sm" onClick={() => { if (viewer.path) void useAppStore.getState().openViewer(viewer.path); }}>重试</Button></div>
          ) : isImage(viewer.file) ? (
            <img className="omega-file-viewer-image" src={viewer.file?.dataUrl} alt={viewer.path ?? "image"} />
          ) : isAudio(viewer.file) ? (
            // Workspace media has no caption source to attach.
            // biome-ignore lint/a11y/useMediaCaption: arbitrary local files have no transcript
            <audio className="omega-file-viewer-audio" controls src={viewer.file?.dataUrl} />
          ) : isPdf(viewer.file) ? (
            <iframe className="omega-file-viewer-pdf" title={viewer.path ?? "PDF"} src={viewer.file?.dataUrl} />
          ) : viewer.file?.binary ? (
            <p className="omega-file-viewer-muted">该二进制文件暂不支持内嵌预览，可用资源管理器打开。</p>
          ) : mode === "preview" && isMarkdown(viewer.path) ? (
            <div className="omega-file-viewer-markdown"><Markdown>{viewer.file?.content ?? ""}</Markdown></div>
          ) : isDocx(viewer.file) ? (
            <div className="omega-file-viewer-docx"><pre>{viewer.file?.content ?? ""}</pre></div>
          ) : mode === "preview" && isMermaid(viewer.path) ? (
            <pre className="omega-file-viewer-preview">Mermaid source（安全预览）{"\n\n"}{viewer.file?.content ?? ""}</pre>
          ) : mode === "preview" && isMath(viewer.path) ? (
            <pre className="omega-file-viewer-preview">LaTeX source（安全预览）{"\n\n"}{viewer.file?.content ?? ""}</pre>
          ) : (
            <div className="omega-file-viewer-source">
              {lines.map((line) => {
                const active = selection && line.n >= Math.min(selection.start, selection.end) && line.n <= Math.max(selection.start, selection.end);
                return <div key={line.n} className={`omega-file-viewer-line${active ? " is-active" : ""}`} onClick={(event) => { if (event.shiftKey && selection) setSelection({ start: selection.start, end: line.n }); else setSelection({ start: line.n, end: line.n }); }}><span className="omega-file-viewer-line-number">{line.n}</span><span className="omega-file-viewer-line-text">{line.text || " "}</span></div>;
              })}
              {pageError ? <p className="omega-file-viewer-page-error" role="alert">{pageError}</p> : null}
              {nextOffset !== null ? <Button size="sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多行"}</Button> : null}
            </div>
          )}
          {copyError ? <p className="omega-file-viewer-copy-error" role="alert">{copyError}</p> : null}
          {copied ? <p className="omega-file-viewer-copied" role="status" aria-live="polite">已复制文件内容</p> : null}
          {viewer.file?.content ? (
            <div className="omega-file-viewer-actions">
              {selection ? <Tooltip><TooltipTrigger asChild><IconButton label="引用选中的行" size="sm" className="omega-file-viewer-quote" onClick={quoteSelection}>@</IconButton></TooltipTrigger><TooltipContent>{`引用 @${viewer.path}:${Math.min(selection.start, selection.end)}-${Math.max(selection.start, selection.end)}`}</TooltipContent></Tooltip> : null}
              <Tooltip><TooltipTrigger asChild><IconButton label="复制文件内容" size="sm" className="omega-file-viewer-copy" onClick={() => void copy()}><CopyIcon /></IconButton></TooltipTrigger><TooltipContent>{copied ? "已复制" : "复制内容"}</TooltipContent></Tooltip>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
