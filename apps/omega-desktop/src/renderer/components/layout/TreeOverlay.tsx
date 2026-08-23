import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { SessionTree, TreeNodeRow } from "../../types/dto";

/**
 * Session tree overlay: flattened branch tree from `sessionManager.getTree()`.
 * Click a node for a non-destructive preview. Rewind and clone are explicit
 * desktop actions, not slash commands.
 */
export function TreeOverlay(): React.ReactElement {
  const open = useAppStore((s) => s.layout.treeOpen);
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const loadTranscript = useAppStore((s) => s.loadTranscript);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setAgent = useAppStore((s) => s.setAgent);
  const connection = useAppStore((s) => s.connection);
  const [tree, setTree] = React.useState<SessionTree | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<TreeNodeRow | null>(null);
  const [rewindTarget, setRewindTarget] = React.useState<TreeNodeRow | null>(null);

  React.useEffect(() => {
    if (!open) {
      setTree(null);
      setError(null);
      setSelected(null);
      setRewindTarget(null);
      return;
    }
    const cached = useAppStore.getState().sessionTree;
    if (cached) setTree(cached);
    void ipc.getSessionTree().then((res) => {
      if (res.ok) {
        setTree(res.data);
        useAppStore.getState().setSessionTree(res.data);
      } else setError(res.message);
    });
  }, [open]);

  const applyRecord = React.useCallback(
    async (recordId: string, record: Parameters<typeof loadTranscript>[0]) => {
      setActiveSession(recordId);
      loadTranscript(record);
      const state = await ipc.getState();
      if (state.ok) setAgent(state.data);
      const list = await ipc.listSessions();
      if (list.ok) useAppStore.getState().applySessionPage(list.data);
    },
    [loadTranscript, setActiveSession, setAgent],
  );

  const rewind = React.useCallback(
    async (targetId: string) => {
      setBusyId(targetId);
      setError(null);
      try {
        const res = await ipc.navigateTree({ targetId });
        if (res.ok) {
          await applyRecord(res.data.id, res.data);
          setRewindTarget(null);
          setTreeOpen(false);
        } else {
          setError(res.message);
        }
      } finally {
        setBusyId(null);
      }
    },
    [applyRecord, setTreeOpen],
  );

  const cloneCurrent = React.useCallback(async () => {
    setBusyId("clone");
    setError(null);
    try {
      const res = await ipc.clone();
      if (res.ok) {
        await applyRecord(res.data.record.id, res.data.record);
        setTreeOpen(false);
      } else {
        setError(res.message);
      }
    } finally {
      setBusyId(null);
    }
  }, [applyRecord, setTreeOpen]);

  const activePath = React.useMemo(() => new Set(tree?.activePath ?? []), [tree]);
  const maxDepth = React.useMemo(
    () => Math.max(0, ...(tree?.nodes ?? []).map((node) => node.depth)),
    [tree],
  );
  const inherited = React.useMemo(() => {
    if (!selected || !tree) return [];
    const byId = new Map(tree.nodes.map((node) => [node.id, node]));
    const chain: TreeNodeRow[] = [];
    let cursor: TreeNodeRow | undefined = selected;
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return chain;
  }, [selected, tree]);
  const busy = Boolean(busyId) || connection === "running";

  return (
    <>
      <Dialog open={open} onClose={() => setTreeOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700, pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
          会话分支树
          <Chip size="small" label={`${tree?.nodes.length ?? 0} 节点`} sx={{ fontSize: 11 }} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" disabled={busy} onClick={() => void cloneCurrent()} sx={{ textTransform: "none" }}>
            复制当前分支
          </Button>
        </DialogTitle>
        {error ? (
          <Box sx={{ px: 3, pb: 1 }}>
            <Typography sx={{ fontSize: 12.5, color: "var(--omega-warning)" }}>{error}</Typography>
          </Box>
        ) : null}
        <Box sx={{ px: 3, pb: 1.5, maxHeight: 360, overflowY: "auto" }}>
          {!tree ? (
            <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>加载中…</Typography>
          ) : tree.nodes.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>当前会话还没有消息。</Typography>
          ) : (
            tree.nodes.map((node) => {
              const onPath = activePath.has(node.id);
              const isLeaf = node.id === tree.leafId;
              const isSelected = selected?.id === node.id;
              return (
                <Box
                  key={node.id}
                  onClick={() => setSelected(node)}
                  onDoubleClick={() => {
                    if (connection === "running") {
                      setError("生成中无法回退分支");
                      return;
                    }
                    setRewindTarget(node);
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    ml: node.depth * Math.min(22, Math.max(12, 160 / (maxDepth || 1))),
                    pl: 1,
                    py: 0.6,
                    px: 1.25,
                    mb: 0.25,
                    borderRadius: "9px",
                    cursor: "pointer",
                    border: isLeaf || isSelected ? "1px solid var(--omega-accent)" : "1px solid transparent",
                    background: isLeaf ? "var(--omega-accent-soft)" : isSelected ? "var(--omega-hover-fill)" : "transparent",
                    "&:hover": { background: isLeaf ? "var(--omega-accent-soft)" : "var(--omega-hover-fill)" },
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      flex: "0 0 auto",
                      background: isLeaf ? "var(--omega-accent)" : onPath ? "var(--omega-text-muted)" : "var(--omega-border-strong)",
                    }}
                  />
                  <Chip
                    size="small"
                    label={node.role === "user" ? "U" : node.role === "assistant" ? "A" : "?"}
                    sx={{
                      flex: "0 0 auto",
                      height: 18,
                      fontSize: 10,
                      fontWeight: 700,
                      background: node.role === "user" ? "var(--omega-accent-soft)" : "var(--omega-hover-fill)",
                      color: node.role === "user" ? "var(--omega-accent)" : "var(--omega-text-muted)",
                    }}
                  />
                  <Typography sx={{ fontSize: 12.5, color: onPath ? "var(--omega-text)" : "var(--omega-text-muted)", minWidth: 0 }} noWrap>
                    {node.label || node.preview || "（无预览）"}
                  </Typography>
                  {node.isLeaf && !isLeaf ? (
                    <Typography sx={{ fontSize: 10.5, color: "var(--omega-text-dim)", ml: "auto" }} noWrap>
                      其他分支末梢
                    </Typography>
                  ) : null}
                </Box>
              );
            })
          )}
        </Box>
        <Box sx={{ px: 3, pb: 2, borderTop: "1px solid var(--omega-border)", pt: 1.25 }}>
          <Typography sx={{ fontSize: 11, color: "var(--omega-text-dim)", mb: 0.75 }}>
            单击预览将继承的上下文；双击或确认后才会破坏性回退。
          </Typography>
          {selected ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
              <Typography sx={{ fontSize: 12, color: "var(--omega-text)" }}>
                将继承 {inherited.length} 条消息到「{selected.label || selected.preview || selected.id}」
              </Typography>
              <Button
                size="small"
                disabled={busy || selected.id === tree?.leafId}
                onClick={() => setRewindTarget(selected)}
                sx={{ textTransform: "none", alignSelf: "flex-start" }}
              >
                回退到这里
              </Button>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12, color: "var(--omega-text-dim)" }}>选择一个节点查看 fork/rewind 预览。</Typography>
          )}
        </Box>
      </Dialog>
      <Dialog open={Boolean(rewindTarget)} onClose={() => setRewindTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>回退到此节点？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "var(--omega-text)" }}>
            这会把当前会话叶子改到「{rewindTarget?.label || rewindTarget?.preview || rewindTarget?.id}」，当前分支之后的消息将不再是活动叶子。生成中无法执行。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRewindTarget(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => rewindTarget && void rewind(rewindTarget.id)}
            sx={{ textTransform: "none" }}
          >
            确认回退
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
