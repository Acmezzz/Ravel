import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { ipc } from "../../ipc/client";
import type { GitWorktreeInfo, GitWorktreeList } from "../../types/dto";

export function WorktreePanel(): React.ReactElement {
  const [list, setList] = React.useState<GitWorktreeList | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [branch, setBranch] = React.useState("");
  const [removing, setRemoving] = React.useState<GitWorktreeInfo | null>(null);
  const refresh = React.useCallback(async () => { const res = await ipc.listWorktrees(); if (res.ok) { setList(res.data); setError(null); } else setError(res.message); }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const add = React.useCallback(async () => { setBusy(true); try { const res = await ipc.addWorktree({ branch: branch.trim() || undefined, createBranch: true }); if (res.ok) { setList(res.data); setBranch(""); setError(null); } else if (res.code !== "cancelled") setError(res.message); } finally { setBusy(false); } }, [branch]);
  const remove = React.useCallback(async (force: boolean) => { if (!removing) return; setBusy(true); try { const res = await ipc.removeWorktree({ path: removing.path, force }); if (res.ok) { setList(res.data); setRemoving(null); setError(null); } else setError(res.message); } finally { setBusy(false); } }, [removing]);
  return <div className="omega-worktree-panel">
    <p className="omega-muted-text">Worktree 是独立工作副本。创建后请用项目切换器打开该目录，而不是用 slash command。</p>
    <div className="omega-form-stack"><TextField label="新分支名（可选）" value={branch} onChange={(event) => setBranch(event.target.value)} /><Button fullWidth variant="solid" disabled={busy} onClick={() => void add()}>选择目录并创建</Button></div>
    {error ? <p className="omega-error-text">{error}</p> : null}
    {!list ? <p className="omega-muted-text">加载工作树…</p> : !list.isGitRepo ? <p className="omega-muted-text">当前工作区不是 Git 仓库。</p> : list.worktrees.length === 0 ? <p className="omega-muted-text">没有列出工作树。</p> : list.worktrees.map((worktree) => <article key={worktree.path} className="omega-worktree-row"><div className="omega-worktree-title"><strong title={worktree.path}>{worktree.branch || (worktree.detached ? "detached" : "worktree")}</strong>{worktree.current ? <span className="omega-chip">当前</span> : null}{worktree.dirty ? <span className="omega-chip omega-chip-warning">改动 {worktree.staged ?? 0}/{worktree.unstaged ?? 0}/{worktree.untracked ?? 0}</span> : null}{worktree.locked ? <span className="omega-chip">锁定</span> : null}</div><span className="omega-worktree-path" title={worktree.path}>{worktree.path} · {worktree.headShort || "no HEAD"}</span>{worktree.recentCommit?.message ? <span className="omega-worktree-path">{worktree.recentCommit.message}</span> : null}<Button size="sm" variant="quiet" disabled={worktree.current || busy} onClick={() => setRemoving(worktree)}>删除</Button></article>)}
    <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }}><DialogContent><DialogTitle>删除 worktree</DialogTitle><div className="omega-dialog-content-area"><p className="omega-dialog-copy">{removing?.dirty ? `${removing.path} 有未提交更改。强制删除会丢掉这些更改。` : `确定删除 ${removing?.path}？`}</p></div><DialogFooter><Button variant="quiet" onClick={() => setRemoving(null)}>取消</Button>{removing?.dirty ? <Button variant="solid" className="omega-button-danger-solid" disabled={busy} onClick={() => void remove(true)}>强制删除</Button> : <Button variant="solid" className="omega-button-danger-solid" disabled={busy} onClick={() => void remove(false)}>删除</Button>}</DialogFooter></DialogContent></Dialog>
  </div>;
}
