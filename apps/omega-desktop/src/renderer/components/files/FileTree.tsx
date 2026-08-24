import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import FolderIcon from "@mui/icons-material/FolderOutlined";
import FolderOpenIcon from "@mui/icons-material/FolderOpenOutlined";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { clickableRole } from "../../lib/a11y";
import type { DirListing } from "../../types/dto";

interface DirState {
  loading: boolean;
  error: string | null;
  listing: DirListing | null;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function TreeRow({
  name,
  rel,
  isDir,
  size,
  depth,
  expanded,
  onToggleDir,
  onOpenFile,
  onReveal,
}: {
  name: string;
  rel: string;
  isDir: boolean;
  size: number;
  depth: number;
  expanded: boolean;
  onToggleDir: (rel: string) => void;
  onOpenFile: (rel: string) => void;
  onReveal: (rel: string) => void;
}): React.ReactElement {
  return (
    <Box
      {...clickableRole}
      onClick={() => (isDir ? onToggleDir(rel) : onOpenFile(rel))}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        pl: 0.5 + depth * 1.25,
        pr: 0.75,
        py: 0.3,
        minWidth: 0,
        borderRadius: "7px",
        cursor: "pointer",
        "&:hover": { background: "var(--omega-hover-fill)" },
      }}
    >
      {isDir ? (
        <>
          <IconButton size="small" aria-label={expanded ? `折叠 ${name}` : `展开 ${name}`} sx={{ p: 0, color: "var(--omega-text-dim)" }} onClick={(e) => { e.stopPropagation(); onToggleDir(rel); }}>
            {expanded ? <ExpandMoreIcon sx={{ fontSize: 14 }} /> : <ChevronRightIcon sx={{ fontSize: 14 }} />}
          </IconButton>
          {expanded ? (
            <FolderOpenIcon sx={{ fontSize: 15, color: "var(--omega-accent)" }} />
          ) : (
            <FolderIcon sx={{ fontSize: 15, color: "var(--omega-accent)" }} />
          )}
        </>
      ) : (
        <>
          <Box sx={{ width: 22 }} />
          <InsertDriveFileIcon sx={{ fontSize: 15, color: "var(--omega-text-dim)" }} />
        </>
      )}
      <Typography sx={{ fontSize: 12.5, color: "var(--omega-text)", minWidth: 0, flex: 1 }} noWrap title={rel}>
        {name}
      </Typography>
      {!isDir && size > 0 ? (
        <Typography sx={{ fontSize: 10, color: "var(--omega-text-dim)", flex: "0 0 auto" }}>{formatSize(size)}</Typography>
      ) : null}
      <Tooltip title="在资源管理器中显示">
        <IconButton
          size="small"
          aria-label={`在资源管理器中显示 ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onReveal(rel);
          }}
          sx={{ flex: "0 0 auto", p: 0.25, color: "var(--omega-text-dim)", opacity: 0, ".MuiBox-root:hover &": { opacity: 1 } }}
        >
          <FolderOpenIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** Lazy-expanding workspace file tree (loads one directory per IPC call). */
export function FileTree(): React.ReactElement {
  const openViewer = useAppStore((s) => s.openViewer);
  const workspaceEpoch = useAppStore((s) => s.workspaceEpoch);
  const reveal = React.useCallback((rel: string) => {
    void ipc.revealInFolder({ path: rel });
  }, []);
  const [dirs, setDirs] = React.useState<Map<string, DirState>>(() => new Map([["", { loading: true, error: null, listing: null }]]));
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set([""]));
  const [upload, setUpload] = React.useState<{ selectionId: string; name: string } | null>(null);
  const [target, setTarget] = React.useState("");
  const [conflictTarget, setConflictTarget] = React.useState<{ path: string; token: string | null } | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const requestEpochRef = React.useRef(0);

  const loadDir = React.useCallback(async (rel: string) => {
    const requestEpoch = requestEpochRef.current;
    setDirs((prev) => new Map(prev).set(rel, { loading: true, error: null, listing: prev.get(rel)?.listing ?? null }));
    const res = await ipc.listDir({ path: rel });
    if (requestEpoch !== requestEpochRef.current) return;
    setDirs((prev) => {
      const next = new Map(prev);
      next.set(rel, res.ok ? { loading: false, error: null, listing: res.data } : { loading: false, error: res.message, listing: null });
      return next;
    });
  }, []);

  React.useEffect(() => {
    requestEpochRef.current += 1;
    setDirs(new Map([["", { loading: true, error: null, listing: null }]]));
    setExpanded(new Set([""]));
    void loadDir("");
  }, [loadDir, workspaceEpoch]);

  const toggleDir = React.useCallback(
    (rel: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(rel)) next.delete(rel);
        else {
          next.add(rel);
          if (!dirs.get(rel)?.listing) void loadDir(rel);
        }
        return next;
      });
    },
    [dirs, loadDir],
  );

  const refreshAll = React.useCallback(() => {
    requestEpochRef.current += 1;
    setDirs(new Map([["", { loading: true, error: null, listing: null }]]));
    setExpanded(new Set([""]));
    void loadDir("");
  }, [loadDir]);

  const rows: React.ReactNode[] = [];
  const renderDir = (rel: string, depth: number) => {
    const state = dirs.get(rel);
    const listing = state?.listing;
    rows.push(
      rel === "" ? null : (
        <TreeRow
          key={`d:${rel}`}
          name={rel.split("/").pop() ?? rel}
          rel={rel}
          isDir
          size={0}
          depth={depth - 1}
          expanded={expanded.has(rel)}
          onToggleDir={toggleDir}
          onOpenFile={() => undefined}
          onReveal={reveal}
        />
      ),
    );
    if (state?.loading && !listing) {
      rows.push(
        <Typography key={`l:${rel}`} sx={{ fontSize: 11.5, color: "var(--omega-text-dim)", pl: 1 + depth * 1.25, py: 0.25 }}>
          加载中…
        </Typography>,
      );
      return;
    }
    if (state?.error) {
      rows.push(
        <Typography key={`e:${rel}`} sx={{ fontSize: 11.5, color: "var(--omega-danger)", pl: 1 + depth * 1.25, py: 0.25 }}>
          {state.error}
        </Typography>,
      );
      return;
    }
    for (const entry of listing?.entries ?? []) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDir) {
        if (expanded.has(childRel)) renderDir(childRel, depth + 1);
        else
          rows.push(
            <TreeRow
              key={`d:${childRel}`}
              name={entry.name}
              rel={childRel}
              isDir
              size={0}
              depth={depth}
              expanded={false}
              onToggleDir={toggleDir}
              onOpenFile={() => undefined}
              onReveal={reveal}
            />,
          );
      } else {
        rows.push(
          <TreeRow
            key={`f:${childRel}`}
            name={entry.name}
            rel={childRel}
            isDir={false}
            size={entry.size}
            depth={depth}
            expanded={false}
            onToggleDir={() => undefined}
            onOpenFile={(path) => void openViewer(path)}
            onReveal={reveal}
          />,
        );
      }
    }
  };
  renderDir("", 0);

  const chooseUpload = async () => {
    setUploadError(null);
    const result = await ipc.chooseFileForWorkspace();
    if (result.ok) { setUpload(result.data); setTarget(result.data.name); }
    else if (result.code !== "cancelled") setUploadError(result.message);
  };
  const uploadSelected = async (conflict: "cancel" | "overwrite" | "keep-both" = "cancel", expectedToken?: string) => {
    if (!upload || !target.trim()) return;
    setUploadError(null);
    const result = await ipc.uploadFile({ selectionId: upload.selectionId, path: target.trim(), conflict, expectedToken });
    if (result.ok && !result.data.conflict) { setUpload(null); setTarget(""); setConflictTarget(null); refreshAll(); }
    else if (result.ok && result.data.target) setConflictTarget({ path: result.data.target.path, token: result.data.target.token });
    else if (!result.ok) setUploadError(result.message);
    else setUploadError("上传未完成，请重试");
  };

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, px: 1, py: 0.5, minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)", minWidth: 0, flex: 1 }} noWrap>工作区文件</Typography>
        <Tooltip title="导入文件到工作区"><IconButton size="small" onClick={() => void chooseUpload()} sx={{ color: "var(--omega-text-dim)" }}><UploadFileIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
        <Tooltip title="刷新">
          <IconButton size="small" onClick={refreshAll} sx={{ color: "var(--omega-text-dim)" }}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ maxHeight: "100%", overflowY: "auto", pb: 1 }}>{rows}</Box>
      <Dialog open={Boolean(upload)} onClose={() => setUpload(null)} fullWidth maxWidth="xs">
        <DialogTitle>导入文件到工作区</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Typography sx={{ fontSize: 12 }}>源文件：{upload?.name}</Typography>
          <TextField autoFocus size="small" label="目标相对路径" value={target} onChange={(event) => setTarget(event.target.value)} helperText="只能写入当前授权 workspace 内的相对路径。" />
          {uploadError ? <Typography sx={{ color: "var(--omega-danger)", fontSize: 12 }}>{uploadError}</Typography> : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setUpload(null)}>取消</Button><Button variant="contained" onClick={() => void uploadSelected()}>导入</Button></DialogActions>
      </Dialog>
      <Dialog open={Boolean(conflictTarget)} onClose={() => setConflictTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>目标文件已存在</DialogTitle>
        <DialogContent><Typography sx={{ fontSize: 12 }}>「{conflictTarget?.path}」已存在。选择覆盖，或保留为新文件。</Typography></DialogContent>
        <DialogActions><Button onClick={() => setConflictTarget(null)}>取消</Button><Button onClick={() => void uploadSelected("keep-both", conflictTarget?.token ?? undefined)}>保留两份</Button><Button color="error" variant="contained" onClick={() => void uploadSelected("overwrite", conflictTarget?.token ?? undefined)}>覆盖</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
