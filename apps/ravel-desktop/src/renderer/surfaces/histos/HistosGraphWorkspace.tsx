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
import type { HistosFactPanel } from "./useHistosFactPanel";

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
  /** P2: archive/purge context-menu actions on graph nodes. */
  factPanel: HistosFactPanel;
}

interface NodeMenuState {
  x: number;
  y: number;
  nodeRevisionId: string;
  title: string;
}

export function HistosGraphWorkspace(props: HistosGraphWorkspaceProps): React.ReactElement {
  const { requestKey, query, projected, loading, error, onSelect, onDraftChange, layoutMode, factPanel } = props;
  const t = useT();
  const [nodeMenu, setNodeMenu] = React.useState<NodeMenuState | null>(null);
  const [menuBusy, setMenuBusy] = React.useState(false);
  const [menuNotice, setMenuNotice] = React.useState<string | null>(null);

  // 查询身份 + 布局模式共同决定画布重挂时机：
  //  - requestKey 变化（切会话/切 lens）→ 重挂，加载该查询的 viewstate；
  //  - layoutMode 切到 "auto" → 重挂且清空位置，驱动 ELK 重新布局。
  const canvasKey = `${requestKey ?? "no-session"}\u0000${layoutMode}`;

  const canRender = Boolean(projected && query);
  const projectedGraph = canRender ? projected : null;
  const activeQuery = canRender ? query : null;

  // P2 右键入口：React Flow 节点 DOM 自带 data-id（nodeRevisionId）。命中即弹出
  // 归档/抹除菜单 —— P0 两级删除能力首次暴露给用户。
  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    const element = (event.target as HTMLElement).closest?.("[data-id]");
    if (!element) return;
    const nodeId = element.getAttribute("data-id");
    const node = projected?.nodes.find((item) => item.id === nodeId);
    if (!node || !nodeId) return;
    event.preventDefault();
    setMenuNotice(null);
    setNodeMenu({ x: event.clientX, y: event.clientY, nodeRevisionId: nodeId, title: node.title ?? nodeId });
  }, [projected]);

  const runArchiveNode = async () => {
    if (!nodeMenu) return;
    setMenuBusy(true);
    const reason = window.prompt("归档理由（可选，≤512 字符）", "") ?? undefined;
    const error = await factPanel.archive("node", [nodeMenu.nodeRevisionId], reason);
    setMenuBusy(false);
    setMenuNotice(error ?? `已归档 ${nodeMenu.title}`);
    if (!error) setNodeMenu(null);
  };

  const runPurgeNode = async () => {
    if (!nodeMenu) return;
    if (!window.confirm(`抹除节点「${nodeMenu.title}」不可逆，确认继续？`)) return;
    setMenuBusy(true);
    const reason = window.prompt("抹除理由（可选，≤512 字符）", "") ?? undefined;
    const { error, hint } = await factPanel.purge("node", [nodeMenu.nodeRevisionId], reason);
    setMenuBusy(false);
    setMenuNotice(error ?? hint ?? `已抹除 ${nodeMenu.title}`);
    if (!error) setNodeMenu(null);
  };

  return (
    <div className="omega-graph-canvas" style={{ minHeight: 0, height: "auto", flex: "1 1 auto" }} onContextMenu={handleContextMenu}>
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
      {nodeMenu ? (
        <div
          className="ravel-histos-node-menu"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{nodeMenu.title}</strong>
          {menuNotice ? <span className="omega-muted-text" role="status">{menuNotice}</span> : null}
          <button type="button" disabled={menuBusy} onClick={() => void runArchiveNode()}>归档（可复原）</button>
          <button type="button" disabled={menuBusy} onClick={() => void runPurgeNode()}>抹除（不可逆）</button>
          <button type="button" onClick={() => setNodeMenu(null)}>关闭</button>
        </div>
      ) : null}
    </div>
  );
}