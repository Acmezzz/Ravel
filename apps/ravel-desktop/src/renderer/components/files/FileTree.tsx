import * as React from "react";
import { ChevronDown, File, Folder, FolderOpen, RefreshCw, Upload } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { clickableRole } from "../../lib/a11y";
import type { DirListing } from "../../types/dto";

interface DirState { loading: boolean; error: string | null; listing: DirListing | null; }
function formatSize(size: number): string { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1024 / 1024).toFixed(1)} MB`; }
function FolderIcon({ open = false }: { open?: boolean }): React.ReactElement { return open ? <FolderOpen className="omega-file-icon" strokeWidth={1.5} aria-hidden="true" /> : <Folder className="omega-file-icon" strokeWidth={1.5} aria-hidden="true" />; }
function FileIcon(): React.ReactElement { return <File className="omega-file-icon" strokeWidth={1.5} aria-hidden="true" />; }
function Chevron({ open }: { open: boolean }): React.ReactElement { return <ChevronDown className={`omega-file-chevron${open ? " is-open" : ""}`} strokeWidth={1.7} aria-hidden="true" />; }
function RefreshIcon(): React.ReactElement { return <RefreshCw className="omega-file-action-icon" strokeWidth={1.5} aria-hidden="true" />; }
function UploadIcon(): React.ReactElement { return <Upload className="omega-file-action-icon" strokeWidth={1.5} aria-hidden="true" />; }

function TreeRow({ name, rel, isDir, size, depth, expanded, onToggleDir, onOpenFile, onReveal }: { name: string; rel: string; isDir: boolean; size: number; depth: number; expanded: boolean; onToggleDir: (rel: string) => void; onOpenFile: (rel: string) => void; onReveal: (rel: string) => void }): React.ReactElement {
  return <div {...clickableRole} className="omega-file-row" style={{ paddingLeft: `calc(0.5rem + ${depth * 1.25}rem)` }} onClick={() => (isDir ? onToggleDir(rel) : onOpenFile(rel))}>
    {isDir ? <><IconButton size="sm" label={expanded ? `折叠 ${name}` : `展开 ${name}`} className="omega-file-chevron-button" onClick={(event) => { event.stopPropagation(); onToggleDir(rel); }}><Chevron open={expanded} /></IconButton><span className="omega-file-folder"><FolderIcon open={expanded} /></span></> : <><span className="omega-file-indent" /><span className="omega-file-document"><FileIcon /></span></>}
    <span className="omega-file-name" title={rel}>{name}</span>{!isDir && size > 0 ? <span className="omega-file-size">{formatSize(size)}</span> : null}
    <Tooltip><TooltipTrigger asChild><IconButton size="sm" label={`在资源管理器中显示 ${name}`} className="omega-file-reveal" onClick={(event) => { event.stopPropagation(); onReveal(rel); }}><FolderIcon /></IconButton></TooltipTrigger><TooltipContent>在资源管理器中显示</TooltipContent></Tooltip>
  </div>;
}

/** Lazy-expanding workspace file tree (loads one directory per IPC call). */
export function FileTree(): React.ReactElement {
  const openViewer = useAppStore((state) => state.openViewer);
  const workspaceEpoch = useAppStore((state) => state.workspaceEpoch);
  const reveal = React.useCallback((rel: string) => { void ipc.revealInFolder({ path: rel }); }, []);
  const [dirs, setDirs] = React.useState<Map<string, DirState>>(() => new Map([["", { loading: true, error: null, listing: null }]]));
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set([""]));
  const [upload, setUpload] = React.useState<{ selectionId: string; name: string } | null>(null);
  const [target, setTarget] = React.useState("");
  const [conflictTarget, setConflictTarget] = React.useState<{ path: string; token: string | null } | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const requestEpochRef = React.useRef(0);

  const loadDir = React.useCallback(async (rel: string) => {
    const requestEpoch = requestEpochRef.current;
    setDirs((previous) => new Map(previous).set(rel, { loading: true, error: null, listing: previous.get(rel)?.listing ?? null }));
    try {
      const res = await ipc.listDir({ path: rel });
      if (requestEpoch !== requestEpochRef.current) return;
      setDirs((previous) => { const next = new Map(previous); next.set(rel, res.ok ? { loading: false, error: null, listing: res.data } : { loading: false, error: res.message, listing: null }); return next; });
    } catch (reason) {
      if (requestEpoch !== requestEpochRef.current) return;
      setDirs((previous) => new Map(previous).set(rel, { loading: false, error: reason instanceof Error ? reason.message : String(reason), listing: null }));
    }
  }, []);
  React.useEffect(() => { requestEpochRef.current += 1; setDirs(new Map([["", { loading: true, error: null, listing: null }]])); setExpanded(new Set([""])); void loadDir(""); }, [loadDir, workspaceEpoch]);
  const toggleDir = React.useCallback((rel: string) => setExpanded((previous) => { const next = new Set(previous); if (next.has(rel)) next.delete(rel); else { next.add(rel); if (!dirs.get(rel)?.listing) void loadDir(rel); } return next; }), [dirs, loadDir]);
  const refreshAll = React.useCallback(() => { requestEpochRef.current += 1; setDirs(new Map([["", { loading: true, error: null, listing: null }]])); setExpanded(new Set([""])); void loadDir(""); }, [loadDir]);
  const rows: React.ReactNode[] = [];
  const renderDir = (rel: string, depth: number) => {
    const state = dirs.get(rel); const listing = state?.listing;
    if (rel !== "") rows.push(<TreeRow key={`d:${rel}`} name={rel.split("/").pop() ?? rel} rel={rel} isDir size={0} depth={depth - 1} expanded={expanded.has(rel)} onToggleDir={toggleDir} onOpenFile={() => undefined} onReveal={reveal} />);
    if (state?.loading && !listing) { rows.push(<p key={`l:${rel}`} className="omega-file-loading" style={{ paddingLeft: `calc(1rem + ${depth * 1.25}rem)` }}>加载中…</p>); return; }
    if (state?.error) { rows.push(<div key={`e:${rel}`} role="alert" className="omega-file-error" style={{ paddingLeft: `calc(1rem + ${depth * 1.25}rem)` }}><span>{state.error}</span><Button size="sm" variant="quiet" onClick={() => void loadDir(rel)}>重试</Button></div>); return; }
    for (const entry of listing?.entries ?? []) { const childRel = rel ? `${rel}/${entry.name}` : entry.name; if (entry.isDir) { if (expanded.has(childRel)) renderDir(childRel, depth + 1); else rows.push(<TreeRow key={`d:${childRel}`} name={entry.name} rel={childRel} isDir size={0} depth={depth} expanded={false} onToggleDir={toggleDir} onOpenFile={() => undefined} onReveal={reveal} />); } else rows.push(<TreeRow key={`f:${childRel}`} name={entry.name} rel={childRel} isDir={false} size={entry.size} depth={depth} expanded={false} onToggleDir={() => undefined} onOpenFile={(path) => void openViewer(path)} onReveal={reveal} />); }
  };
  renderDir("", 0);
  const chooseUpload = async () => { setUploadError(null); const result = await ipc.chooseFileForWorkspace(); if (result.ok) { setUpload(result.data); setTarget(result.data.name); } else if (result.code !== "cancelled") setUploadError(result.message); };
  const uploadSelected = async (conflict: "cancel" | "overwrite" | "keep-both" = "cancel", expectedToken?: string) => { if (!upload || !target.trim()) return; setUploadError(null); const result = await ipc.uploadFile({ selectionId: upload.selectionId, path: target.trim(), conflict, expectedToken }); if (result.ok && !result.data.conflict) { setUpload(null); setTarget(""); setConflictTarget(null); refreshAll(); } else if (result.ok && result.data.target) setConflictTarget({ path: result.data.target.path, token: result.data.target.token }); else if (!result.ok) setUploadError(result.message); else setUploadError("上传未完成，请重试"); };
  return <div className="omega-file-tree">
    <div className="omega-file-toolbar"><span className="overline-label">工作区文件</span><Tooltip><TooltipTrigger asChild><IconButton size="sm" label="导入文件到工作区" onClick={() => void chooseUpload()}><UploadIcon /></IconButton></TooltipTrigger><TooltipContent>导入文件到工作区</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><IconButton size="sm" label="刷新文件树" onClick={refreshAll}><RefreshIcon /></IconButton></TooltipTrigger><TooltipContent>刷新</TooltipContent></Tooltip></div>
    <div className="omega-file-list">{rows}</div>
    <Dialog open={Boolean(upload)} onOpenChange={(open) => { if (!open) setUpload(null); }}><DialogContent><DialogTitle>导入文件到工作区</DialogTitle><div className="omega-dialog-content-area"><p className="omega-dialog-copy">源文件：{upload?.name}</p><TextField autoFocus label="目标相对路径" value={target} onChange={(event) => setTarget(event.target.value)} hint="只能写入当前授权 workspace 内的相对路径。" error={uploadError ?? undefined} /></div><DialogFooter><Button variant="quiet" onClick={() => setUpload(null)}>取消</Button><Button variant="solid" onClick={() => void uploadSelected()}>导入</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(conflictTarget)} onOpenChange={(open) => { if (!open) setConflictTarget(null); }}><DialogContent><DialogTitle>目标文件已存在</DialogTitle><div className="omega-dialog-content-area"><p className="omega-dialog-copy">「{conflictTarget?.path}」已存在。选择覆盖，或保留为新文件。</p></div><DialogFooter><Button variant="quiet" onClick={() => setConflictTarget(null)}>取消</Button><Button variant="outline" onClick={() => void uploadSelected("keep-both", conflictTarget?.token ?? undefined)}>保留两份</Button><Button variant="solid" className="omega-button-danger-solid" onClick={() => void uploadSelected("overwrite", conflictTarget?.token ?? undefined)}>覆盖</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
