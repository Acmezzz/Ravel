import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogContentArea, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { clickableRole } from "../../lib/a11y";
import type { SessionTree, TreeNodeRow } from "../../types/dto";

const ROLE_LABEL: Record<string, string> = {
  user: "用户",
  assistant: "助手",
};

/**
 * Session tree overlay: a compact timeline instead of a deeply indented tree.
 * Depth is shown as a rail tick + a short ancestor chip, not as left padding.
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
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const treeRequestEpoch = React.useRef(0);

  React.useEffect(() => {
    if (!open) {
      setTree(null);
      setError(null);
      setSelected(null);
      setRewindTarget(null);
      return;
    }
    const requestEpoch = ++treeRequestEpoch.current;
    const cached = useAppStore.getState().sessionTree;
    if (cached) setTree(cached);
    void ipc.getSessionTree().then((res) => {
      if (requestEpoch !== treeRequestEpoch.current || !useAppStore.getState().layout.treeOpen) return;
      if (res.ok) {
        setTree(res.data);
        useAppStore.getState().setSessionTree(res.data);
      } else setError(res.message);
    }).catch((reason) => {
      if (requestEpoch === treeRequestEpoch.current) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { treeRequestEpoch.current += 1; };
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
  const requestRewind = React.useCallback(
    (node: TreeNodeRow) => {
      setSelected(node);
      if (connection === "running") {
        setError("生成中无法回退分支");
        return;
      }
      setRewindTarget(node);
    },
    [connection],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) setTreeOpen(false); }}>
        <DialogContent>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingBottom: "0.5rem" }}>
            会话分支
            <span className="omega-chip">{`${tree?.nodes.length ?? 0} 步`}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" disabled={busy} onClick={() => void cloneCurrent()}>
              复制当前分支
            </Button>
          </DialogTitle>
          {error ? (
            <p role="alert" className="omega-tree-error omega-warning-text" style={{ margin: "0 0 0.5rem", padding: "0 1.5rem" }}>
              {error}
            </p>
          ) : null}
          <div className="omega-tree-list" style={{ padding: "0 1.25rem 0.75rem", maxHeight: 380, overflowY: "auto" }}>
            {!tree ? (
              <p role="status" aria-live="polite" style={{ margin: 0, fontSize: "0.75rem", color: "var(--ravel-text-dim)" }}>加载中…</p>
            ) : tree.nodes.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ravel-text-dim)" }}>当前会话还没有消息。</p>
            ) : (
              tree.nodes.map((node, index) => {
                const onPath = activePath.has(node.id);
                const isLeaf = node.id === tree.leafId;
                const isSelected = selected?.id === node.id;
                const branched = node.depth > 0 && tree.nodes[index - 1]?.depth !== undefined && node.depth > (tree.nodes[index - 1]?.depth ?? 0);
                return (
                  <div
                    key={node.id}
                    {...clickableRole}
                    role="treeitem"
                    tabIndex={0}
                    aria-selected={isSelected}
                    aria-level={node.depth + 1}
                    className="omega-tree-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "18px 1fr",
                      columnGap: "0.5rem",
                      paddingTop: "2.8px",
                      paddingBottom: "2.8px",
                      cursor: "pointer",
                    }}
                    onClick={() => setSelected(node)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      requestRewind(node);
                    }}
                    onDoubleClick={() => {
                      if (connection === "running") {
                        setError("生成中无法回退分支");
                        return;
                      }
                      setRewindTarget(node);
                    }}
                  >
                    <div className="omega-tree-rail" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span className="omega-tree-rail-line" style={{ width: "1px", flex: 1, minHeight: 4, background: index === 0 ? "transparent" : "var(--ravel-border-strong)" }} />
                      <span
                        className="omega-tree-dot"
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 999,
                          flex: "0 0 auto",
                          border: isLeaf || isSelected ? "2px solid var(--ravel-accent)" : "2px solid var(--ravel-border-strong)",
                          background: isLeaf ? "var(--ravel-accent)" : onPath ? "var(--ravel-text-muted)" : "var(--ravel-bg-panel)",
                        }}
                      />
                      <span className="omega-tree-rail-line" style={{ width: "1px", flex: 1, minHeight: 4, background: index === tree.nodes.length - 1 ? "transparent" : "var(--ravel-border-strong)" }} />
                    </div>
                    <div
                      className="omega-tree-row-body"
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                      style={{
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "0.55rem",
                        paddingLeft: "0.5rem",
                        paddingRight: "0.5rem",
                        paddingTop: "0.35rem",
                        paddingBottom: "0.35rem",
                        marginTop: "1.2px",
                        marginBottom: "1.2px",
                        borderRadius: "8px",
                        border: isLeaf || isSelected ? "1px solid var(--ravel-accent-line)" : "1px solid transparent",
                        background: isLeaf ? "var(--ravel-accent-soft)" : isSelected || hoveredId === node.id ? "var(--ravel-hover-fill)" : "transparent",
                      }}
                    >
                      <span
                        className="omega-tree-role"
                        style={{
                          fontSize: "0.65625rem",
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          color: node.role === "user" ? "var(--ravel-accent)" : "var(--ravel-text-dim)",
                          flex: "0 0 auto",
                          width: 28,
                        }}
                      >
                        {ROLE_LABEL[node.role] ?? "?"}
                      </span>
                      {branched ? (
                        <span className="omega-chip omega-tree-depth" style={{ height: 16, flex: "0 0 auto" }}>{`L${node.depth}`}</span>
                      ) : null}
                      <span
                        className="omega-tree-label"
                        style={{
                          fontSize: "0.8125rem",
                          color: onPath ? "var(--ravel-text)" : "var(--ravel-text-muted)",
                          minWidth: 0,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {node.label || node.preview || "（无预览）"}
                      </span>
                      {isLeaf ? (
                        <span className="omega-tree-marker-current" style={{ fontSize: "0.65625rem", color: "var(--ravel-accent-strong)", flex: "0 0 auto" }}>当前</span>
                      ) : node.isLeaf ? (
                        <span className="omega-tree-marker-tip" style={{ fontSize: "0.65625rem", color: "var(--ravel-text-dim)", flex: "0 0 auto" }}>支线</span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="omega-tree-preview" style={{ padding: "0.625rem 1.5rem 1rem", borderTop: "1px solid var(--ravel-border)" }}>
            <p style={{ margin: "0 0 0.45rem", fontSize: "0.65625rem", color: "var(--ravel-text-dim)" }}>
              单击预览将继承的上下文；双击或确认后才会破坏性回退。
            </p>
            {selected ? (
              <div className="omega-tree-preview-detail" style={{ display: "flex", flexDirection: "column", gap: "0.3rem", alignItems: "flex-start" }}>
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ravel-text)" }}>
                  将继承 {inherited.length} 条消息到「{selected.label || selected.preview || selected.id}」
                </p>
                <Button size="sm" disabled={busy || selected.id === tree?.leafId} onClick={() => setRewindTarget(selected)}>
                  回退到这里
                </Button>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ravel-text-dim)" }}>选择一个节点查看 fork/rewind 预览。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(rewindTarget)} onOpenChange={(next) => { if (!next) setRewindTarget(null); }}>
        <DialogContent className="omega-dialog-narrow">
          <DialogTitle>回退到此节点？</DialogTitle>
          <DialogContentArea>
            <p className="omega-tree-confirm-text" style={{ margin: 0, fontSize: "0.8125rem", color: "var(--ravel-text)" }}>
              这会把当前会话叶子改到「{rewindTarget?.label || rewindTarget?.preview || rewindTarget?.id}」，当前分支之后的消息将不再是活动叶子。生成中无法执行。
            </p>
          </DialogContentArea>
          <DialogFooter>
            <Button onClick={() => setRewindTarget(null)}>取消</Button>
            <Button variant="solid" disabled={busy} onClick={() => rewindTarget && void rewind(rewindTarget.id)}>
              确认回退
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
