import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import { ipc } from "../../ipc/client";
import type { GitWorktreeInfo, GitWorktreeList } from "../../types/dto";

export function WorktreePanel(): React.ReactElement {
  const [list, setList] = React.useState<GitWorktreeList | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [branch, setBranch] = React.useState("");
  const [removing, setRemoving] = React.useState<GitWorktreeInfo | null>(null);

  const refresh = React.useCallback(async () => {
    const res = await ipc.listWorktrees();
    if (res.ok) {
      setList(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = React.useCallback(async () => {
    setBusy(true);
    try {
      const res = await ipc.addWorktree({ branch: branch.trim() || undefined, createBranch: true });
      if (res.ok) {
        setList(res.data);
        setBranch("");
        setError(null);
      } else if (res.code !== "cancelled") {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }, [branch]);

  const remove = React.useCallback(async (force: boolean) => {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await ipc.removeWorktree({ path: removing.path, force });
      if (res.ok) {
        setList(res.data);
        setRemoving(null);
        setError(null);
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }, [removing]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>
        Worktree 是独立工作副本。创建后请用项目切换器打开该目录，而不是用 slash command。
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        <TextField
          size="small"
          fullWidth
          label="新分支名（可选）"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
        <Button fullWidth variant="contained" disabled={busy} onClick={() => void add()} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>
          选择目录并创建
        </Button>
      </Box>
      {error ? <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-danger)" }}>{error}</Typography> : null}
      {!list ? (
        <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>加载工作树…</Typography>
      ) : !list.isGitRepo ? (
        <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>当前工作区不是 Git 仓库。</Typography>
      ) : list.worktrees.length === 0 ? (
        <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-dim)" }}>没有列出工作树。</Typography>
      ) : (
        list.worktrees.map((worktree) => (
          <Box
            key={worktree.path}
            sx={{
              border: "1px solid var(--omega-border)",
              borderRadius: "10px",
              p: 1,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, flexWrap: "wrap" }}>
              <Typography sx={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--omega-text)", minWidth: 0, flex: "1 1 auto" }} noWrap title={worktree.path}>
                {worktree.branch || (worktree.detached ? "detached" : "worktree")}
              </Typography>
              {worktree.current ? <Chip size="small" label="当前" sx={{ height: 18, fontSize: "0.65625rem" }} /> : null}
              {worktree.dirty ? <Chip size="small" label={`改动 ${worktree.staged ?? 0}/${worktree.unstaged ?? 0}/${worktree.untracked ?? 0}`} sx={{ height: 18, fontSize: "0.65625rem" }} /> : null}
              {worktree.locked ? <Chip size="small" label="锁定" sx={{ height: 18, fontSize: "0.65625rem" }} /> : null}
            </Box>
            <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }} noWrap title={worktree.path}>
              {worktree.path} · {worktree.headShort || "no HEAD"}
            </Typography>
            {worktree.recentCommit?.message ? <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }} noWrap>{worktree.recentCommit.message}</Typography> : null}
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="small" disabled={worktree.current || busy} onClick={() => setRemoving(worktree)} sx={{ textTransform: "none" }}>
                删除
              </Button>
            </Box>
          </Box>
        ))
      )}
      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>删除 worktree</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)" }}>
            {removing?.dirty
              ? `${removing.path} 有未提交更改。强制删除会丢掉这些更改。`
              : `确定删除 ${removing?.path}？`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoving(null)} sx={{ textTransform: "none" }}>取消</Button>
          {removing?.dirty ? (
            <Button color="error" variant="contained" disabled={busy} onClick={() => void remove(true)} sx={{ textTransform: "none" }}>
              强制删除
            </Button>
          ) : (
            <Button color="error" variant="contained" disabled={busy} onClick={() => void remove(false)} sx={{ textTransform: "none" }}>
              删除
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
