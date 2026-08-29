/**
 * 任务七：Histos 检查器（选定节点/边详情）。
 *
 * 呈现选定 GraphRevision 的节点摘要、证据、关联边与 transcript 跳转，并提供
 * Convert to Flow / Run Flow / Schedule 动作（与 FlowDrawer 共享同一 flow 状态与
 * Approval 门，避免旁路）以及 Suggest（工作区检索 + 冻结所选）。
 */
import * as React from "react";
import { useT } from "../../lib/i18n";
import { useAppStore } from "../../store/useAppStore";
import type { GraphProjection, GraphSelection, GraphTraceTarget } from "../../lib/graph-projection";
import type { HistosGraphDTO } from "../../types/dto";
import { Button } from "../../ui/Button";
import { SnippetEditor } from "../../components/common/SnippetEditor";
import type { HistosContextActions, SuggestCandidate } from "./useHistosContextActions";

export interface HistosInspectorProps {
  projected: GraphProjection | null;
  graph: HistosGraphDTO | null;
  selection: GraphSelection | null;
  flowApproved: boolean;
  /** 该 Flow 当前是否需要批准；打开 FlowDrawer 入口。 */
  onOpenFlowDrawer: () => void;
  actions: HistosContextActions;
}

function suggestionLabel(candidate: SuggestCandidate): string {
  return `${candidate.kind} · ${candidate.lens ?? "structural"} · ${candidate.evidenceCount} evidence`;
}

function targetLabel(target: GraphTraceTarget): string {
  if (target.entryId) return `entry ${target.entryId}`;
  if (target.toolCallId) return `tool ${target.toolCallId}`;
  return "session only";
}

export function HistosInspector(props: HistosInspectorProps): React.ReactElement {
  const { projected, graph, selection, flowApproved, onOpenFlowDrawer, actions } = props;
  const t = useT();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const requestTranscriptNavigation = useAppStore((state) => state.requestTranscriptNavigation);

  const selected = React.useMemo(() => {
    if (!projected || !selection) return null;
    return selection.type === "node"
      ? projected.nodes.find((node) => node.id === selection.nodeRevisionId) ?? null
      : projected.edges.find((edge) => edge.id === selection.edgeRevisionId) ?? null;
  }, [projected, selection]);

  const isNode = Boolean(selection && selection.type === "node");
  const evidenceCount = selected && graph
    ? graph.evidence.filter((item) => item.revisionId === selected.id).length
    : 0;

  // 关联边：节点选中时是其连边；边选中时展示自身。
  const associatedEdges = React.useMemo(() => {
    if (!projected || !selection) return [];
    if (selection.type === "node") {
      return projected.edges.filter((edge) =>
        edge.sourceNodeRevisionId === selection.nodeRevisionId || edge.targetNodeRevisionId === selection.nodeRevisionId);
    }
    return projected.edges.filter((edge) => edge.id === selection.edgeRevisionId);
  }, [projected, selection]);

  const target: GraphTraceTarget | undefined = selected?.anchor;
  const canNavigate = Boolean(target && (target.entryId || target.toolCallId) && target.sessionId === activeSessionId);

  const openTranscript = React.useCallback(() => {
    if (!target || !canNavigate) return;
    requestTranscriptNavigation({
      sessionId: target.sessionId,
      ...(target.entryId ? { entryId: target.entryId } : {}),
      ...(target.toolCallId ? { toolCallId: target.toolCallId } : {}),
    });
  }, [canNavigate, requestTranscriptNavigation, target]);

  // Approval 门：Run/Schedule 只有「已转换且批准」才允许；否则引导去 FlowDrawer 批准。
  const canRunFlow = Boolean(actions.flow?.validation.ok && flowApproved);

  return (
    <section className="ravel-histos-inspector" aria-label={t("graph.detailAria")}>
      {selected ? (
        <div className="ravel-histos-inspector-detail">
          <span className="overline-label">{selected.kind}</span>
          <strong>{"title" in selected ? selected.title : selected.edgeId}</strong>
          {"title" in selected && typeof selected.title === "string" ? <SnippetEditor value={selected.title} /> : null}
          <span className="mono-num">{selected.id}</span>
          <span className="omega-muted-text">{t("graph.evidence", { n: evidenceCount })}</span>
          {target ? <span className="mono-num">{targetLabel(target)} · {target.sessionId}</span> : <span className="omega-muted-text">{t("graph.noAnchor")}</span>}
          <Button size="sm" variant="quiet" disabled={!canNavigate} onClick={openTranscript} title={!target ? t("graph.noAnchor") : target.sessionId !== activeSessionId ? t("graph.otherSession") : undefined}>{t("graph.openTranscript")}</Button>

          {associatedEdges.length > 0 ? (
            <div className="ravel-histos-edges">
              <span className="overline-label">{isNode ? "关联边" : "边端点"}</span>
              {associatedEdges.map((edge) => (
                <span key={edge.id} className="omega-graph-edge mono-num">
                  {edge.kind} · {edge.sourceNodeRevisionId ?? "∅"} → {edge.targetNodeRevisionId ?? "∅"}
                </span>
              ))}
            </div>
          ) : null}

          <Button size="sm" variant="quiet" disabled={actions.converting || projected?.nodes.length === 0} onClick={() => { actions.convertToFlow(); onOpenFlowDrawer(); }}>
            {actions.converting ? t("graph.converting") : t("graph.convert")}
          </Button>
          {actions.convertResult ? <span className="omega-muted-text" role="status">{actions.convertResult}</span> : null}
          {actions.executeResult ? <span className="omega-muted-text" role="status">{actions.executeResult}</span> : null}
          {actions.scheduleResult ? <span className="omega-muted-text" role="status">{actions.scheduleResult}</span> : null}
          {!canRunFlow && actions.flow ? <span className="omega-muted-text" role="status">请在 Flow 抽屉批准后运行/调度。</span> : null}
        </div>
      ) : (
        <p className="omega-muted-text">选择节点查看其摘要、证据与关联边。</p>
      )}

      {/* Suggest：工作区检索 + 冻结所选 */}
      <div className="ravel-histos-suggest">
        <span className="overline-label">{t("graph.suggestTitle")}</span>
        <div className="omega-graph-toolbar-actions">
          <input
            className="omega-input"
            type="text"
            value={actions.suggestQuery}
            placeholder={t("graph.suggestPlaceholder")}
            onChange={(event) => actions.setSuggestQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") actions.runSuggest(); }}
          />
          <Button size="sm" variant="quiet" disabled={actions.suggesting} onClick={actions.runSuggest}>{actions.suggesting ? t("graph.suggestSearching") : t("graph.suggestRun")}</Button>
          <Button size="sm" variant="solid" disabled={actions.suggesting || actions.suggestSelection.length === 0} onClick={actions.freezeSuggested}>{t("graph.suggestFreeze")}</Button>
        </div>
        {actions.suggestStatus ? <span className="omega-muted-text" role="status">{actions.suggestStatus}</span> : null}
        {actions.suggestCandidates !== null && actions.suggestCandidates.length > 0 ? (
          <ul className="omega-resource-list">
            {actions.suggestCandidates.map((candidate) => (
              <li key={candidate.nodeRevisionId} className="omega-resource-row">
                <label className="omega-resource-row-title">
                  <input
                    type="checkbox"
                    checked={actions.suggestSelection.includes(candidate.nodeRevisionId)}
                    onChange={(event) => {
                      actions.setSuggestSelection(event.target.checked
                        ? [...actions.suggestSelection, candidate.nodeRevisionId]
                        : actions.suggestSelection.filter((id) => id !== candidate.nodeRevisionId));
                    }}
                  />
                  <strong>{candidate.title ?? candidate.nodeId}</strong>
                  <span className="omega-muted-text">{suggestionLabel(candidate)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}