/**
 * 任务七：Histos 表面组合根 —— 落地真正的 HistosSurface。
 *
 * 组合：HistosToolbar（lens/统计/Refresh/Rebuild/Freeze/布局切换 + 导入条）+
 * HistosGraphWorkspace（React Flow + ELK worker，复用 GraphCanvas）+
 * HistosInspector（节点摘要/证据/关联边/transcript/Suggest）+ HistosFlowDrawer
 * （Convert→Validate→Approval 门→Run/Schedule）。
 *
 * 查询（useHistosGraphQuery，带 stale 防护）、上下文/flow 动作（useHistosContextActions，
 * 走既有 IPC）、view state（selection/draft/布局）都在此收敛，子组件间不重复发请求。
 * 作为中央列的独立 region landmark，由 SurfaceRouter 依据 surfaceMode 渲染。
 */
import * as React from "react";
import { useAppStore } from "../../store/useAppStore";
import { projectHistosGraph, type GraphSelection } from "../../lib/graph-projection";
import type { GraphDraftSelection } from "../../components/panels/GraphCanvas";
import { HistosToolbar } from "./HistosToolbar";
import { HistosGraphWorkspace, type HistosLayoutMode } from "./HistosGraphWorkspace";
import { HistosInspector } from "./HistosInspector";
import { HistosFlowDrawer } from "./HistosFlowDrawer";
import { useHistosGraphQuery } from "./useHistosGraphQuery";
import { useHistosContextActions } from "./useHistosContextActions";

export function HistosSurface(): React.ReactElement {
  const activeSessionId = useAppStore((state) => state.activeSessionId);

  const q = useHistosGraphQuery();
  const [selection, setSelection] = React.useState<GraphSelection | null>(null);
  const [draft, setDraft] = React.useState<GraphDraftSelection>({ nodeRevisionIds: [], edgeRevisionIds: [] });
  const [layoutMode, setLayoutMode] = React.useState<HistosLayoutMode>("saved");
  const [flowDrawerOpen, setFlowDrawerOpen] = React.useState(true);
  const [flowApproved, setFlowApproved] = React.useState(false);

  const actions = useHistosContextActions({
    activeSessionId,
    graph: q.graph,
    lens: q.lens,
    selection,
    draft,
    refresh: q.refresh,
  });

  const projected = React.useMemo(() => (q.graph ? projectHistosGraph(q.graph, selection) : null), [q.graph, selection]);

  // 查询身份变化（切会话/切 lens）→ 清空视图选择。
  React.useEffect(() => {
    setSelection(null);
    setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] });
  }, [q.requestKey]);

  // Convert 出新的 flow → 重置批准门（批准是“一次性”授权，新 flow 需重新批准）。
  const flowSha = actions.flow?.sha256 ?? null;
  React.useEffect(() => {
    setFlowApproved(false);
  }, [flowSha]);

  const nodeCount = projected?.nodes.length ?? 0;
  const edgeCount = projected?.edges.length ?? 0;
  const freezeDisabled = !activeSessionId || draft.nodeRevisionIds.length + draft.edgeRevisionIds.length === 0;

  return (
    <section
      className="ravel-histos-surface"
      aria-label="历史数据库图谱表面"
      data-surface="histos"
    >
      <HistosToolbar
        lens={q.lens}
        onLensChange={q.setLens}
        nodeCount={nodeCount}
        edgeCount={edgeCount}
        loading={q.loading}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        freezeDisabled={freezeDisabled}
        onRefresh={q.refresh}
        actions={actions}
      />

      <div className="ravel-histos-body">
        <div className="ravel-histos-main">
          <HistosGraphWorkspace
            requestKey={q.requestKey}
            query={q.query}
            projected={projected}
            loading={q.loading}
            error={q.error}
            onSelect={setSelection}
            onDraftChange={setDraft}
            layoutMode={layoutMode}
          />
          <HistosInspector
            projected={projected}
            graph={q.graph}
            selection={selection}
            flowApproved={flowApproved}
            onOpenFlowDrawer={() => setFlowDrawerOpen(true)}
            actions={actions}
          />
        </div>
        <HistosFlowDrawer
          open={flowDrawerOpen}
          onToggle={() => setFlowDrawerOpen((current) => !current)}
          flowApproved={flowApproved}
          onFlowApproved={setFlowApproved}
          actions={actions}
        />
      </div>
    </section>
  );
}