/**
 * 任务七：Histos 工具栏。
 *
 * 顶部工具条：Lens 切换、节点/边统计、Refresh、Rebuild 索引、Freeze 当前选择、
 * 布局切换；其下为导入条 —— 展示 Workspace Artifact Hash / URL，以及 Rebuild
 * “构建进度”状态。全部动作走 useHistosContextActions（既有 IPC）。
 */
import * as React from "react";
import { useT } from "../../lib/i18n";
import type { HistosLens } from "../../types/dto";
import { Button, IconButton } from "../../ui/Button";
import type { HistosContextActions } from "./useHistosContextActions";
import type { HistosLayoutMode } from "./HistosGraphWorkspace";

export interface HistosToolbarProps {
  lens: HistosLens;
  onLensChange: (lens: HistosLens) => void;
  nodeCount: number;
  edgeCount: number;
  loading: boolean;
  layoutMode: HistosLayoutMode;
  onLayoutModeChange: (mode: HistosLayoutMode) => void;
  freezeDisabled: boolean;
  onRefresh: () => void;
  actions: HistosContextActions;
}

export function HistosToolbar(props: HistosToolbarProps): React.ReactElement {
  const { lens, onLensChange, nodeCount, edgeCount, loading, layoutMode, onLayoutModeChange, freezeDisabled, onRefresh, actions } = props;
  const t = useT();

  return (
    <div className="ravel-histos-toolbar">
      <div className="ravel-histos-toolbar-row">
        <div className="ravel-histos-toolbar-title">
          <span className="overline-label">{t("graph.title")}</span>
          <span className="omega-muted-text">{t("graph.query")}</span>
        </div>
        <label className="omega-muted-text">
          Lens{" "}
          <select value={lens} onChange={(event) => onLensChange(event.target.value as HistosLens)}>
            <option value="structural">Structural</option>
            <option value="semantic">Semantic</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <div className="omega-graph-toolbar-actions">
          {nodeCount + edgeCount > 0 ? <span className="mono-num">{nodeCount}N · {edgeCount}E</span> : null}
          <IconButton size="sm" label={t("graph.refresh")} onClick={onRefresh} disabled={loading}>↻</IconButton>
          <Button size="sm" variant="quiet" disabled={loading} onClick={() => onLayoutModeChange(layoutMode === "auto" ? "saved" : "auto")} title={layoutMode === "auto" ? "重新触发 ELK 自动布局" : "切换到自动布局"}>
            {layoutMode === "auto" ? "自动布局" : "保存位置"}
          </Button>
          {actions.confirmRebuild ? (
            <span className="omega-graph-toolbar-actions" role="group" aria-label={t("graph.rebuildConfirmAria")}>
              <span className="omega-muted-text" role="status">{t("graph.rebuildConfirm")}</span>
              <Button size="sm" variant="solid" disabled={actions.rebuilding} onClick={actions.rebuildIndex}>{actions.rebuilding ? t("graph.rebuilding") : t("graph.rebuildYes")}</Button>
              <Button size="sm" variant="quiet" onClick={() => actions.setConfirmRebuild(false)}>{t("graph.rebuildNo")}</Button>
            </span>
          ) : (
            <Button size="sm" variant="quiet" disabled={loading || actions.rebuilding} onClick={() => actions.setConfirmRebuild(true)} title={t("graph.rebuildTitle")}>{t("graph.rebuild")}</Button>
          )}
          <Button size="sm" variant="quiet" disabled={freezeDisabled || actions.freezing} onClick={actions.freezeContext}>{actions.freezing ? t("graph.freezing") : t("graph.freeze")}</Button>
        </div>
      </div>
      {actions.rebuildResult ? <p className="omega-muted-text" role="status">{actions.rebuildResult}</p> : null}
      {actions.freezeResult ? <p className="omega-muted-text" role="status">{actions.freezeResult}</p> : null}

      {/* 导入条：Workspace hash / URL / 构建(rebuild)进度 */}
      <div className="ravel-histos-import-bar" role="group" aria-label="导入与构建">
        <span className="overline-label">{t("graph.importTitle")}</span>
        <div className="omega-graph-toolbar-actions">
          <input
            className="omega-input"
            type="text"
            value={actions.importWorkspaceId}
            placeholder={t("graph.importWorkspace")}
            onChange={(event) => actions.setImportWorkspaceId(event.target.value)}
          />
          <input
            className="omega-input"
            type="text"
            value={actions.importSha}
            placeholder={t("graph.importSha")}
            onChange={(event) => actions.setImportSha(event.target.value)}
          />
          <Button size="sm" variant="quiet" disabled={actions.importing} onClick={actions.runImport}>{actions.importing ? t("graph.importing") : t("graph.importRun")}</Button>
        </div>
        <div className="omega-graph-toolbar-actions">
          <input
            className="omega-input"
            type="url"
            value={actions.webUrl}
            placeholder={t("graph.webPlaceholder")}
            onChange={(event) => actions.setWebUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") actions.importWebResource(); }}
          />
          <Button size="sm" variant="quiet" disabled={actions.importingWeb || actions.webUrl.trim().length === 0} onClick={actions.importWebResource}>{actions.importingWeb ? t("graph.webImporting") : t("graph.webRun")}</Button>
          <span className="rail-spacer" />
          {actions.rebuilding ? <span className="mono-num" role="status">构建中…</span> : null}
        </div>
        {actions.webResult ? <p className="omega-muted-text" role="status">{actions.webResult}</p> : null}
      </div>
    </div>
  );
}