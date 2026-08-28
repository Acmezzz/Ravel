import * as React from "react";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT, type MessageKey } from "../../lib/i18n";
import type { DiffFile, GitStageItem } from "../../types/dto";
import { ApprovalBar } from "./ApprovalBar";

const MAX_RENDERED_FILES = 80;
const MAX_RENDERED_HUNKS_PER_FILE = 40;
const MAX_RENDERED_LINES_PER_HUNK = 400;

const STATUS_KEY: Record<DiffFile["status"], MessageKey> = {
  added: "diff.status.added",
  modified: "diff.status.modified",
  deleted: "diff.status.deleted",
  renamed: "diff.status.renamed",
};

const STATUS_TONE: Record<DiffFile["status"], { bg: string; fg: string }> = {
  added: { bg: "var(--omega-success-soft)", fg: "var(--omega-success)" },
  modified: { bg: "var(--omega-warning-soft)", fg: "var(--omega-warning)" },
  deleted: { bg: "var(--omega-danger-soft)", fg: "var(--omega-danger)" },
  renamed: { bg: "var(--omega-accent-soft)", fg: "var(--omega-accent)" },
};

function HunkLine({ line }: { line: DiffFile["hunks"][number]["lines"][number] }): React.ReactElement {
  const typeClass = line.type === "add" ? "omega-diff-add" : line.type === "del" ? "omega-diff-del" : "omega-diff-context";
  const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return <div className={`omega-diff-hunk-line ${typeClass}`}><span className="omega-diff-prefix" aria-hidden="true">{prefix}</span><span className="omega-diff-content">{line.content}</span></div>;
}

interface Selection { /** path -> selected hunk indexes (empty set = whole file) */ files: Map<string, Set<number>>; }

/** Collect the picked items (whole-file or hunk-level) for stage/unstage. */
function collectItems(selection: Selection, files: DiffFile[]): GitStageItem[] {
  const out: GitStageItem[] = [];
  for (const [path, hunks] of selection.files) {
    if (hunks.size === 0) { out.push({ path }); continue; }
    const file = files.find((candidate) => candidate.path === path);
    const raws = [...hunks].map((index) => file?.hunks[index]?.raw ?? "").filter(Boolean);
    out.push({ path, hunks: raws.length > 0 ? raws : undefined });
  }
  return out;
}

function FileCard({ file, selection, onToggleFile, onToggleHunk, onOpenFile }: { file: DiffFile; selection: Selection; onToggleFile: (path: string) => void; onToggleHunk: (path: string, hunkIndex: number) => void; onOpenFile: (path: string) => void }): React.ReactElement {
  const t = useT();
  const [expanded, setExpanded] = React.useState(false);
  const selectedHunks = selection.files.get(file.path);
  const wholeFile = selectedHunks !== undefined && selectedHunks.size === 0;
  const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
  return (
    <article className={`omega-diff-file${expanded ? " is-expanded" : ""}`}>
      <div className="omega-diff-file-summary">
        <input className="omega-checkbox" type="checkbox" checked={wholeFile} ref={(element) => { if (element) element.indeterminate = !wholeFile && (selectedHunks?.size ?? 0) > 0; }} aria-label={`选择文件 ${file.path}`} onClick={(event) => event.stopPropagation()} onChange={() => onToggleFile(file.path)} />
        <button type="button" className="omega-diff-file-name" onClick={(event) => { event.stopPropagation(); onOpenFile(file.path); }} title={file.path}>{fileName}</button>
        <span className="omega-diff-file-path" title={file.path}>{fileName !== file.path ? file.path : ""}</span>
        <span className="omega-chip omega-diff-status" style={{ background: STATUS_TONE[file.status].bg, color: STATUS_TONE[file.status].fg }}>{t(STATUS_KEY[file.status])}</span>
        <span className="mono-num omega-diff-additions">+{file.additions}</span><span className="mono-num omega-diff-deletions">-{file.deletions}</span>
        <button type="button" className="omega-diff-expand" aria-expanded={expanded} aria-label={expanded ? `折叠 ${fileName}` : `展开 ${fileName}`} onClick={() => setExpanded((value) => !value)}>{expanded ? "⌃" : "⌄"}</button>
      </div>
      {expanded ? <div className="omega-diff-file-body">{file.hunks.slice(0, MAX_RENDERED_HUNKS_PER_FILE).map((hunk, index) => <section key={index} className="omega-diff-hunk"><div className="omega-diff-hunk-header"><input className="omega-checkbox" type="checkbox" checked={wholeFile || (selectedHunks?.has(index) ?? false)} aria-label={t("diff.hunkAria", { path: file.path, index: index + 1 })} onChange={() => onToggleHunk(file.path, index)} /><button type="button" className="omega-diff-hunk-title" onClick={() => onToggleHunk(file.path, index)}>{hunk.header}</button></div><div className="omega-diff-lines">{hunk.lines.slice(0, MAX_RENDERED_LINES_PER_HUNK).map((line, lineIndex) => <HunkLine key={lineIndex} line={line} />)}{hunk.lines.length > MAX_RENDERED_LINES_PER_HUNK ? <p className="omega-diff-truncated">{t("diff.foldedLines", { n: hunk.lines.length - MAX_RENDERED_LINES_PER_HUNK })}</p> : null}</div></section>)}</div> : null}
    </article>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }): React.ReactElement { return <h3 className="omega-diff-section-title">{label}（{count}）</h3>; }

export function DiffViewer(): React.ReactElement {
  const t = useT();
  const snapshot = useAppStore((state) => state.gitSnapshot);
  const setGitSnapshot = useAppStore((state) => state.setGitSnapshot);
  const openViewer = useAppStore((state) => state.openViewer);
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
          else { const kept = new Set([...hunks].filter((index) => index >= 0 && index < file.hunks.length)); if (kept.size > 0) files.set(path, kept); }
        }
        return { files };
      };
      setUnstagedSel(prune); setStagedSel(prune);
    } else setError(res.message);
    setBusy(false);
  }, [setGitSnapshot]);

  React.useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30_000); const onFocus = () => void refresh(); window.addEventListener("focus", onFocus); return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); }; }, [refresh]);
  const clearSel = () => { setUnstagedSel({ files: new Map() }); setStagedSel({ files: new Map() }); };
  const toggleFile = (setter: React.Dispatch<React.SetStateAction<Selection>>) => (path: string) => setter((previous) => { const files = new Map(previous.files); if (files.has(path)) files.delete(path); else files.set(path, new Set()); return { files }; });
  const toggleHunk = (setter: React.Dispatch<React.SetStateAction<Selection>>) => (path: string, hunkIndex: number) => setter((previous) => { const files = new Map(previous.files); let hunks = files.get(path); if (hunks === undefined) hunks = new Set<number>(); else if (hunks.size === 0) return previous; hunks = new Set(hunks); if (hunks.has(hunkIndex)) hunks.delete(hunkIndex); else hunks.add(hunkIndex); files.set(path, hunks); return { files }; });

  const stage = React.useCallback(async () => {
    if (!snapshot) return; const items = collectItems(unstagedSel, snapshot.unstaged); if (items.length === 0) return;
    setBusy(true); setError(null); const res = await ipc.gitStage({ snapshotToken: snapshot.snapshotToken, items }); setBusy(false);
    if (res.ok && res.data.applied) { clearSel(); await refresh(); } else if (res.ok) setError(res.data.errors.join("\n")); else { setError(res.code === "stale_diff_snapshot" ? t("diff.error.staleStage") : res.message); if (res.code === "stale_diff_snapshot") await refresh(); }
  }, [unstagedSel, snapshot, refresh, t]);
  const unstage = React.useCallback(async () => {
    if (!snapshot) return; const items = collectItems(stagedSel, snapshot.staged); if (items.length === 0) return;
    setBusy(true); setError(null); const res = await ipc.gitUnstage({ snapshotToken: snapshot.snapshotToken, items }); setBusy(false);
    if (res.ok && res.data.applied) { clearSel(); await refresh(); } else if (res.ok) setError(res.data.errors.join("\n")); else { setError(res.code === "stale_diff_snapshot" ? t("diff.error.staleUnstage") : res.message); if (res.code === "stale_diff_snapshot") await refresh(); }
  }, [stagedSel, snapshot, refresh, t]);
  const commit = React.useCallback(async () => { const msg = message.trim(); if (!msg) return; setBusy(true); setError(null); const res = await ipc.gitCommit({ message: msg }); setBusy(false); if (res.ok) { setMessage(""); await refresh(); } else setError(res.message); }, [message, refresh]);

  if (!snapshot) return <div className="omega-diff-empty"><Button onClick={() => void refresh()} disabled={busy}>{busy ? t("diff.generating") : t("diff.generateSnapshot")}</Button>{error ? <p role="alert" className="omega-error-text">{error}</p> : null}</div>;
  if (!snapshot.isGitRepo) return <p className="omega-diff-not-git">{t("diff.notGitRepo")}</p>;
  const unstagedCount = snapshot.unstaged.length; const stagedCount = snapshot.staged.length;
  const selectedUnstagedHunks = [...unstagedSel.files.values()].reduce((total, hunks) => total + (hunks.size === 0 ? 0 : hunks.size), 0);
  const selectedStagedHunks = [...stagedSel.files.values()].reduce((total, hunks) => total + (hunks.size === 0 ? 0 : hunks.size), 0);
  const selectedUnstagedFiles = unstagedSel.files.size; const selectedStagedFiles = stagedSel.files.size;

  return <div className="omega-diff-viewer">
    <header className="omega-diff-header"><span className="omega-chip omega-diff-branch" title={snapshot.branch || undefined}>{snapshot.branch || t("diff.noBranch")}</span><Button size="sm" onClick={() => void refresh()} disabled={busy}>{busy ? "…" : t("diff.refresh")}</Button><span className="omega-diff-root" title={snapshot.repoRoot}>{snapshot.repoRoot}</span></header>
    {snapshot.log.length > 0 ? <div className="omega-diff-log">{snapshot.log.slice(0, 3).map((entry) => <p key={entry.hash} title={`${entry.hash} ${entry.message}`}><span className="mono-num">{entry.hash.slice(0, 7)}</span> {entry.message}</p>)}</div> : null}
    {error ? <p role="alert" className="omega-error-text omega-diff-error">{error}</p> : null}
    {selectedUnstagedFiles + selectedStagedFiles > 0 ? <div role="status" aria-live="polite" className="omega-diff-selection"><strong>{t("diff.selected")}</strong>{selectedUnstagedFiles > 0 ? <span className="omega-chip">{t("diff.chip.unstagedFiles", { n: selectedUnstagedFiles })}{selectedUnstagedHunks ? t("diff.chip.hunks", { n: selectedUnstagedHunks }) : ""}</span> : null}{selectedStagedFiles > 0 ? <span className="omega-chip">{t("diff.chip.stagedFiles", { n: selectedStagedFiles })}{selectedStagedHunks ? t("diff.chip.hunks", { n: selectedStagedHunks }) : ""}</span> : null}<Button size="sm" onClick={clearSel}>{t("diff.clearSelection")}</Button></div> : null}
    {unstagedCount + stagedCount === 0 ? <p className="omega-diff-clean">{t("diff.clean")}</p> : <div className="omega-diff-scroll"><SectionTitle label={t("diff.section.unstaged")} count={unstagedCount} />{snapshot.unstaged.slice(0, MAX_RENDERED_FILES).map((file) => <FileCard key={file.path} file={file} selection={unstagedSel} onToggleFile={toggleFile(setUnstagedSel)} onToggleHunk={toggleHunk(setUnstagedSel)} onOpenFile={(path) => void openViewer(path)} />)}{unstagedCount > MAX_RENDERED_FILES ? <p className="omega-diff-truncated">{t("diff.folded.unstaged", { n: unstagedCount - MAX_RENDERED_FILES })}</p> : null}{unstagedCount > 0 ? <Button size="sm" variant="outline" onClick={() => void stage()} disabled={busy || unstagedSel.files.size === 0}>{t("diff.stageSelected", { n: unstagedSel.files.size })}</Button> : null}<SectionTitle label={t("diff.section.staged")} count={stagedCount} />{snapshot.staged.slice(0, MAX_RENDERED_FILES).map((file) => <FileCard key={file.path} file={file} selection={stagedSel} onToggleFile={toggleFile(setStagedSel)} onToggleHunk={toggleHunk(setStagedSel)} onOpenFile={(path) => void openViewer(path)} />)}{stagedCount > MAX_RENDERED_FILES ? <p className="omega-diff-truncated">{t("diff.folded.staged", { n: stagedCount - MAX_RENDERED_FILES })}</p> : null}{stagedCount > 0 ? <Button size="sm" variant="outline" onClick={() => void unstage()} disabled={busy || stagedSel.files.size === 0}>{t("diff.unstageSelected", { n: stagedSel.files.size })}</Button> : null}{stagedCount > 0 ? <div className="omega-diff-commit"><TextField multiline minRows={2} placeholder={t("diff.commitPlaceholder")} value={message} onChange={(event) => setMessage(event.target.value)} /><Button size="sm" variant="solid" onClick={() => void commit()} disabled={busy || !message.trim()}>{t("diff.commit", { n: stagedCount })}</Button></div> : null}</div>}
    {unstagedCount > 0 ? <ApprovalBar snapshotToken={snapshot.snapshotToken} selectedItems={collectItems(unstagedSel, snapshot.unstaged)} selectedFiles={[...unstagedSel.files.keys()].filter((path) => snapshot.unstaged.some((file) => file.path === path))} hasUntrackedSelected={snapshot.unstaged.some((file) => unstagedSel.files.has(file.path) && file.status === "added")} onApplied={() => { clearSel(); void refresh(); }} /> : null}
  </div>;
}
