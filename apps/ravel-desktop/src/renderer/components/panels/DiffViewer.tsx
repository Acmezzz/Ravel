import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import TextField from "@mui/material/TextField";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { DiffFile, GitStageItem } from "../../types/dto";
import { ApprovalBar } from "./ApprovalBar";

const MAX_RENDERED_FILES = 80;
const MAX_RENDERED_HUNKS_PER_FILE = 40;
const MAX_RENDERED_LINES_PER_HUNK = 400;

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
};

const STATUS_TONE: Record<DiffFile["status"], { bg: string; fg: string }> = {
  added: { bg: "var(--omega-success-soft)", fg: "var(--omega-success)" },
  modified: { bg: "var(--omega-warning-soft)", fg: "var(--omega-warning)" },
  deleted: { bg: "var(--omega-danger-soft)", fg: "var(--omega-danger)" },
  renamed: { bg: "var(--omega-accent-soft)", fg: "var(--omega-accent)" },
};

function HunkLine({ line }: { line: DiffFile["hunks"][number]["lines"][number] }) {
  const bg = line.type === "add" ? "var(--omega-success-soft)" : line.type === "del" ? "var(--omega-danger-soft)" : "transparent";
  const color = line.type === "add" ? "var(--omega-success)" : line.type === "del" ? "var(--omega-danger)" : "var(--omega-text-dim)";
  const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return (
    <Box
      component="div"
      sx={{
        display: "flex",
        bgcolor: bg,
        fontFamily: "ui-monospace, monospace",
        fontSize: "0.75rem",
        lineHeight: 1.65,
        whiteSpace: "pre",
        // Precision gutter marker: the sign column reads as a ruled edge.
        boxShadow: line.type === "add" ? "inset 2px 0 0 var(--omega-success)" : line.type === "del" ? "inset 2px 0 0 var(--omega-danger)" : undefined,
      }}
    >
      <Box component="span" sx={{ color, flex: "0 0 auto", userSelect: "none", px: 0.75, fontWeight: 600 }}>
        {prefix}
      </Box>
      <Box component="span" sx={{ color: "var(--omega-text-soft)", flex: 1, overflowX: "auto" }}>
        {line.content}
      </Box>
    </Box>
  );
}

interface Selection {
  /** path -> selected hunk indexes (empty set = whole file) */
  files: Map<string, Set<number>>;
}

/** Collect the picked items (whole-file or hunk-level) for stage/unstage. */
function collectItems(selection: Selection, files: DiffFile[]): GitStageItem[] {
  const out: GitStageItem[] = [];
  for (const [path, hunks] of selection.files) {
    if (hunks.size === 0) {
      out.push({ path });
      continue;
    }
    const file = files.find((f) => f.path === path);
    const raws = [...hunks].map((i) => file?.hunks[i]?.raw ?? "").filter(Boolean);
    out.push({ path, hunks: raws.length > 0 ? raws : undefined });
  }
  return out;
}

function FileCard({
  file,
  selection,
  onToggleFile,
  onToggleHunk,
  onOpenFile,
}: {
  file: DiffFile;
  selection: Selection;
  onToggleFile: (path: string) => void;
  onToggleHunk: (path: string, hunkIndex: number) => void;
  onOpenFile: (path: string) => void;
}) {
  const selectedHunks = selection.files.get(file.path);
  const wholeFile = selectedHunks !== undefined && selectedHunks.size === 0;
  const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        background: "var(--omega-bg-soft)",
        border: "1px solid var(--omega-border)",
        borderRadius: "10px !important",
        mb: 0.75,
        minWidth: 0,
        overflow: "hidden",
        boxShadow: "var(--omega-inset-highlight)",
        transition: "border-color 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), box-shadow 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
        "&:hover": { borderColor: "var(--omega-border-strong)", boxShadow: "var(--omega-shadow-sm), var(--omega-inset-highlight)" },
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ color: "var(--omega-text-muted)", fontSize: "1.125rem" }} />}
        sx={{
          px: 0.75,
          minHeight: 44,
          "& .MuiAccordionSummary-content": {
            my: 0.75,
            mr: 0.5,
            minWidth: 0,
            overflow: "hidden",
            flex: "1 1 auto",
          },
          "& .MuiAccordionSummary-expandIconWrapper": { flex: "0 0 auto", ml: 0 },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, minWidth: 0, width: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            <Checkbox
              size="small"
              checked={wholeFile}
              indeterminate={!wholeFile && (selectedHunks?.size ?? 0) > 0}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleFile(file.path)}
              sx={{ p: 0, ml: "-2px", flex: "0 0 auto" }}
            />
            <Typography
              component="button"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile(file.path);
              }}
              title={file.path}
              sx={{
                fontSize: "0.8125rem",
                color: "var(--omega-text)",
                fontWeight: 600,
                minWidth: 0,
                flex: "1 1 auto",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
                border: "none",
                background: "transparent",
                p: 0,
                textAlign: "left",
                "&:hover": { color: "var(--omega-accent)" },
              }}
            >
              {fileName}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, pl: "26px" }}>
            {fileName !== file.path ? (
              <Typography title={file.path} sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", minWidth: 0, flex: "1 1 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {file.path}
              </Typography>
            ) : (
              <Box sx={{ flex: "1 1 0", minWidth: 0 }} />
            )}
            <Chip size="small" label={STATUS_LABEL[file.status]} sx={{ flex: "0 0 auto", height: 18, fontSize: "0.65625rem", background: STATUS_TONE[file.status].bg, color: STATUS_TONE[file.status].fg }} />
            <Typography className="mono-num" sx={{ fontSize: "0.65625rem", color: "var(--omega-success)", flex: "0 0 auto" }}>+{file.additions}</Typography>
            <Typography className="mono-num" sx={{ fontSize: "0.65625rem", color: "var(--omega-danger)", flex: "0 0 auto" }}>-{file.deletions}</Typography>
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1, pt: 0, minWidth: 0 }}>
        {file.hunks.slice(0, MAX_RENDERED_HUNKS_PER_FILE).map((hunk, i) => (
          <Box key={i} sx={{ mt: 0.75, border: "1px solid var(--omega-border)", borderRadius: "8px", overflow: "hidden", minWidth: 0, background: "var(--omega-bg-code)", boxShadow: "var(--omega-inset-recessed)" }}>
            <Box
              sx={{ display: "flex", alignItems: "center", background: "var(--omega-bg)", cursor: "pointer", minWidth: 0 }}
              onClick={() => onToggleHunk(file.path, i)}
            >
              <Checkbox
                size="small"
                checked={wholeFile || (selectedHunks?.has(i) ?? false)}
                inputProps={{ "aria-label": `选择 ${file.path} 的第 ${i + 1} 个 hunk` }}
                onClick={(event) => event.stopPropagation()}
                onChange={() => onToggleHunk(file.path, i)}
                sx={{ p: 0.25, flex: "0 0 auto" }}
              />
              <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hunk.header}</Typography>
            </Box>
            <Box sx={{ px: 1, py: 0.5, overflowX: "auto" }}>
              {hunk.lines.slice(0, MAX_RENDERED_LINES_PER_HUNK).map((line, j) => (
                <HunkLine key={j} line={line} />
              ))}
              {hunk.lines.length > MAX_RENDERED_LINES_PER_HUNK ? (
                <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-warning)", py: 0.5 }}>
                  已折叠 {hunk.lines.length - MAX_RENDERED_LINES_PER_HUNK} 行，避免大 diff 阻塞界面。
                </Typography>
              ) : null}
            </Box>
          </Box>
        ))}
      </AccordionDetails>
    </Accordion>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }): React.ReactElement {
  return (
    <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--omega-text-muted)", letterSpacing: "0.05em", mt: 0.25, mb: 0.75, "&:not(:first-of-type)": { mt: 1.25 } }}>
      {label}（{count}）
    </Typography>
  );
}

/** Build stage/unstage items from the selection (whole file when no hunks picked). */

export function DiffViewer(): React.ReactElement {
  const snapshot = useAppStore((s) => s.gitSnapshot);
  const setGitSnapshot = useAppStore((s) => s.setGitSnapshot);
  const openViewer = useAppStore((s) => s.openViewer);
  const [unstagedSel, setUnstagedSel] = React.useState<Selection>({ files: new Map() });
  const [stagedSel, setStagedSel] = React.useState<Selection>({ files: new Map() });
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setBusy(true);
    const res = await ipc.gitSnapshot();
    if (res.ok) {
      setGitSnapshot(res.data);
      const valid = new Map(res.data.unstaged.concat(res.data.staged).map((file) => [file.path, file]));
      const prune = (selection: Selection): Selection => {
        const files = new Map<string, Set<number>>();
        for (const [path, hunks] of selection.files) {
          const file = valid.get(path);
          if (!file) continue;
          if (hunks.size === 0) files.set(path, new Set());
          else {
            const kept = new Set([...hunks].filter((index) => index >= 0 && index < file.hunks.length));
            if (kept.size > 0) files.set(path, kept);
          }
        }
        return { files };
      };
      setUnstagedSel(prune);
      setStagedSel(prune);
    } else setError(res.message);
    setBusy(false);
  }, [setGitSnapshot]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const clearSel = () => {
    setUnstagedSel({ files: new Map() });
    setStagedSel({ files: new Map() });
  };

  const toggleFile = (setter: React.Dispatch<React.SetStateAction<Selection>>) => (path: string) => {
    setter((prev) => {
      const files = new Map(prev.files);
      if (files.has(path)) files.delete(path);
      else files.set(path, new Set());
      return { files };
    });
  };

  const toggleHunk = (setter: React.Dispatch<React.SetStateAction<Selection>>) => (path: string, hunkIndex: number) => {
    setter((prev) => {
      const files = new Map(prev.files);
      let hunks = files.get(path);
      if (hunks === undefined) {
        hunks = new Set<number>();
      } else if (hunks.size === 0) {
        return prev; // whole file selected — hunk toggle disabled
      }
      hunks = new Set(hunks);
      if (hunks.has(hunkIndex)) hunks.delete(hunkIndex);
      else hunks.add(hunkIndex);
      files.set(path, hunks);
      return { files };
    });
  };

  const stage = React.useCallback(async () => {
    if (!snapshot) return;
    const withHunks = collectItems(unstagedSel, snapshot.unstaged);
    if (withHunks.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await ipc.gitStage({ snapshotToken: snapshot.snapshotToken, items: withHunks });
    setBusy(false);
    if (res.ok && res.data.applied) {
      clearSel();
      await refresh();
    } else if (res.ok) {
      setError(res.data.errors.join("\n"));
    } else {
      setError(res.code === "stale_diff_snapshot" ? "工作区已变化，已刷新快照；请重新选择要暂存的文件或 hunk。" : res.message);
      if (res.code === "stale_diff_snapshot") await refresh();
    }
  }, [unstagedSel, snapshot, refresh]);

  const unstage = React.useCallback(async () => {
    if (!snapshot) return;
    const withHunks = collectItems(stagedSel, snapshot.staged);
    if (withHunks.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await ipc.gitUnstage({ snapshotToken: snapshot.snapshotToken, items: withHunks });
    setBusy(false);
    if (res.ok && res.data.applied) {
      clearSel();
      await refresh();
    } else if (res.ok) {
      setError(res.data.errors.join("\n"));
    } else {
      setError(res.code === "stale_diff_snapshot" ? "工作区已变化，已刷新快照；请重新选择要取消暂存的文件或 hunk。" : res.message);
      if (res.code === "stale_diff_snapshot") await refresh();
    }
  }, [stagedSel, snapshot, refresh]);

  const commit = React.useCallback(async () => {
    const msg = message.trim();
    if (!msg) return;
    setBusy(true);
    setError(null);
    const res = await ipc.gitCommit({ message: msg });
    setBusy(false);
    if (res.ok) {
      setMessage("");
      await refresh();
    } else {
      setError(res.message);
    }
  }, [message, refresh]);

  if (!snapshot) {
    return (
      <Box sx={{ textAlign: "center", mt: 4 }}>
        <Button variant="outlined" onClick={() => void refresh()} disabled={busy} sx={{ textTransform: "none" }}>
          {busy ? "生成中…" : "生成 Git 快照"}
        </Button>
        {error ? (
          <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-danger)", mt: 1 }}>{error}</Typography>
        ) : null}
      </Box>
    );
  }

  if (!snapshot.isGitRepo) {
    return (
      <Typography sx={{ color: "var(--omega-warning)", fontSize: "0.8125rem", mt: 2 }}>
        当前工作区未纳入 git，无法审查变更。
      </Typography>
    );
  }

  const unstagedCount = snapshot.unstaged.length;
  const stagedCount = snapshot.staged.length;
  const selectedUnstagedHunks = [...unstagedSel.files.values()].reduce((total, hunks) => total + (hunks.size === 0 ? 0 : hunks.size), 0);
  const selectedStagedHunks = [...stagedSel.files.values()].reduce((total, hunks) => total + (hunks.size === 0 ? 0 : hunks.size), 0);
  const selectedUnstagedFiles = unstagedSel.files.size;
  const selectedStagedFiles = stagedSel.files.size;

  return (
    <Box sx={{ minWidth: 0, minHeight: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.35, mb: 0.75, minWidth: 0, flex: "0 0 auto" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
          <Chip
            size="small"
            label={snapshot.branch || "无分支"}
            title={snapshot.branch || undefined}
            sx={{
              flex: "1 1 auto",
              minWidth: 0,
              maxWidth: "100%",
              height: 22,
              background: "var(--omega-accent-soft)",
              color: "var(--omega-accent-strong)",
              "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", display: "block" },
            }}
          />
          <Button size="small" onClick={() => void refresh()} disabled={busy} sx={{ textTransform: "none", flex: "0 0 auto", minWidth: 0, px: 1 }}>
            {busy ? "…" : "刷新"}
          </Button>
        </Box>
        <Typography title={snapshot.repoRoot} sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {snapshot.repoRoot}
        </Typography>
      </Box>

      {snapshot.log.length > 0 ? (
        <Box sx={{ maxHeight: 52, overflowY: "auto", mb: 0.75, minWidth: 0, flex: "0 0 auto" }}>
          {snapshot.log.slice(0, 3).map((entry) => (
            <Typography key={entry.hash} title={`${entry.hash} ${entry.message}`} sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", fontFamily: "ui-monospace, Consolas, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.hash.slice(0, 7)} {entry.message}
            </Typography>
          ))}
        </Box>
      ) : null}

      {error ? (
        <Typography role="alert" sx={{ fontSize: "0.75rem", color: "var(--omega-danger)", whiteSpace: "pre-wrap", mb: 1 }}>{error}</Typography>
      ) : null}
      {selectedUnstagedFiles + selectedStagedFiles > 0 ? (
        <Paper role="status" aria-live="polite" sx={{ p: 1, mb: 1, background: "var(--omega-selected)", border: "1px solid var(--omega-accent-line)", display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--omega-text)" }}>已选择</Typography>
          {selectedUnstagedFiles > 0 ? <Chip size="small" label={`未暂存 ${selectedUnstagedFiles} 文件${selectedUnstagedHunks ? ` · ${selectedUnstagedHunks} hunk` : ""}`} /> : null}
          {selectedStagedFiles > 0 ? <Chip size="small" label={`已暂存 ${selectedStagedFiles} 文件${selectedStagedHunks ? ` · ${selectedStagedHunks} hunk` : ""}`} /> : null}
          <Button size="small" onClick={clearSel} sx={{ textTransform: "none", ml: "auto" }}>清除选择</Button>
        </Paper>
      ) : null}

      {unstagedCount + stagedCount === 0 ? (
        <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.8125rem" }}>工作区干净，没有未提交的改动。</Typography>
      ) : (
        <>
          <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden", pr: 0.25 }}>
            <SectionTitle label="未暂存" count={unstagedCount} />
            {snapshot.unstaged.slice(0, MAX_RENDERED_FILES).map((file) => (
              <FileCard key={file.path} file={file} selection={unstagedSel} onToggleFile={toggleFile(setUnstagedSel)} onToggleHunk={toggleHunk(setUnstagedSel)} onOpenFile={(p) => void openViewer(p)} />
            ))}
            {unstagedCount > MAX_RENDERED_FILES ? <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-warning)", mb: 1 }}>已折叠 {unstagedCount - MAX_RENDERED_FILES} 个未暂存文件。</Typography> : null}
            {unstagedCount > 0 ? (
              <Button size="small" variant="outlined" onClick={() => void stage()} disabled={busy || unstagedSel.files.size === 0} sx={{ textTransform: "none", mb: 1 }}>
                暂存所选（{unstagedSel.files.size}）
              </Button>
            ) : null}

            <SectionTitle label="已暂存" count={stagedCount} />
            {snapshot.staged.slice(0, MAX_RENDERED_FILES).map((file) => (
              <FileCard key={file.path} file={file} selection={stagedSel} onToggleFile={toggleFile(setStagedSel)} onToggleHunk={toggleHunk(setStagedSel)} onOpenFile={(p) => void openViewer(p)} />
            ))}
            {stagedCount > MAX_RENDERED_FILES ? <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-warning)", mb: 1 }}>已折叠 {stagedCount - MAX_RENDERED_FILES} 个已暂存文件。</Typography> : null}
            {stagedCount > 0 ? (
              <Button size="small" variant="outlined" onClick={() => void unstage()} disabled={busy || stagedSel.files.size === 0} sx={{ textTransform: "none", mb: 1 }}>
                取消暂存所选（{stagedSel.files.size}）
              </Button>
            ) : null}

            {stagedCount > 0 ? (
              <Paper sx={{ p: 1.25, mt: 1, mb: 1, background: "var(--omega-bg-elevated)", border: "1px solid var(--omega-border)", minWidth: 0 }}>
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  minRows={2}
                  maxRows={5}
                  placeholder="提交信息…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
                  <Button size="small" variant="contained" onClick={() => void commit()} disabled={busy || !message.trim()} sx={{ textTransform: "none" }}>
                    提交（{stagedCount} 个文件）
                  </Button>
                </Box>
              </Paper>
            ) : null}
          </Box>

          {unstagedCount > 0 ? (
            <ApprovalBar
              snapshotToken={snapshot.snapshotToken}
              selectedItems={collectItems(unstagedSel, snapshot.unstaged)}
              selectedFiles={[...unstagedSel.files.keys()].filter((p) => snapshot.unstaged.some((f) => f.path === p))}
              hasUntrackedSelected={snapshot.unstaged.some((f) => unstagedSel.files.has(f.path) && f.status === "added")}
              onApplied={() => {
                clearSel();
                void refresh();
              }}
            />
          ) : null}
        </>
      )}
    </Box>
  );
}
