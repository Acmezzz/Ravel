/**
 * 任务七：Histos 图谱工作区。
 *
 * 复用 GraphCanvas（React Flow + ELK worker，经 graph-layout.worker 异步布局，
 * viewstate 位置恢复在其内部完成）把投影后的 GraphProjection 呈现为可选择的
 * 图谱画布。本组件只做组合与编排：
 *  - 以 `requestKey` + `layoutMode` 渲染 key 驱动 GraphCanvas 重挂 —— 查询身份
 *    变化或切换“自动布局”时清空画布位置并重新触发 ELK 异步布局。
 *  - 透传 selection / draft（view state）给上层（HistosSurface），供 Freeze /
 *    Inspector 消费。
 *  - loading / error / empty 空态在此层展示。
 */
import * as React from "react";
import { useT } from "../../lib/i18n";
import type { GraphProjection, GraphSelection } from "../../lib/graph-projection";
import { GraphCanvas, type GraphDraftSelection } from "../../components/panels/GraphCanvas";
import type { HistosGraphQuery } from "./useHistosGraphQuery";

export type HistosLayoutMode = "auto" | "saved";

export interface HistosGraphWorkspaceProps {
  requestKey: HistosGraphQuery["requestKey"];
  query: HistosGraphQuery["query"];
  projected: GraphProjection | null;
  loading: boolean;
  error: string | null;
  onSelect: (selection: GraphSelection | null) => void;
  onDraftChange: (draft: GraphDraftSelection) => void;
  layoutMode: HistosLayoutMode;
}

export function HistosGraphWorkspace(props: HistosGraphWorkspaceProps): React.ReactElement {
  const { requestKey, query, projected, loading, error, onSelect, onDraftChange, layoutMode } = props;
  const t = useT();

  // 查询身份 + 布局模式共同决定画布重挂时机：
  //  - requestKey 变化（切会话/切 lens）→ 重挂，加载该查询的 viewstate；
  //  - layoutMode 切到 "auto" → 重挂且清空位置，驱动 ELK 重新布局。
  const canvasKey = `${requestKey ?? "no-session"}\u0000${layoutMode}`;

  const canRender = Boolean(projected && query);
  const projectedGraph = canRender ? projected : null;
  const activeQuery = canRender ? query : null;

  return (
    <div className="omega-graph-canvas" style={{ minHeight: 0, height: "auto", flex: "1 1 auto" }}>
      {loading ? <p className="omega-graph-empty" role="status">{t("graph.loading")}</p> : null}
      {error ? <p className="omega-error-text" role="alert">{error}</p> : null}
      {!loading && !error && !projected ? <p className="omega-graph-empty">{t("graph.noSession")}</p> : null}
      {!loading && !error && projected && projected.nodes.length === 0 ? <p className="omega-graph-empty">{t("graph.empty")}</p> : null}
      {projectedGraph && activeQuery ? (
        <GraphCanvas
          key={canvasKey}
          graph={projectedGraph}
          query={activeQuery}
          onSelect={onSelect}
          onDraftChange={onDraftChange}
        />
      ) : null}
    </div>
  );
}