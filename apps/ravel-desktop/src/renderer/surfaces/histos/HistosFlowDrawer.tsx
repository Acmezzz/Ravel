/**
 * 任务七：Histos Flow 抽屉（Convert to Flow → Validate → Approval 门 → Run/Schedule）。
 *
 * 执行路径唯一：GraphRevision → Convert to Flow → Validate(flow_revision) → 人工批准
 * → Run Flow / Schedule（经 histosExecuteFlow / flowScheduleCreate 既有 IPC）→
 * Pi 执行 → JSONL facts。语义图不能直接运行 —— Run/Schedule 只会对被 Convert 出的
 * 且通过校验、并获批的 flow 开放；未 Convert/未批准时按钮禁用，杜绝旁路。
 *
 * Approval 门状态 `flowApproved` 由上层（HistosSurface）持有，供 Inspector 与抽屉
 * 共享；每次 Convert 出新 flow 时上层会重置批准位。
 */
import * as React from "react";
import { useT } from "../../lib/i18n";
import { Button } from "../../ui/Button";
import type { HistosContextActions } from "./useHistosContextActions";

export interface HistosFlowDrawerProps {
  open: boolean;
  onToggle: () => void;
  flowApproved: boolean;
  onFlowApproved: (approved: boolean) => void;
  actions: HistosContextActions;
  /** 当前图节点数；为 0 时禁用"转换为 Flow"，避免空图转换必然失败。 */
  nodeCount: number;
}

export function HistosFlowDrawer(props: HistosFlowDrawerProps): React.ReactElement {
  const { open, onToggle, flowApproved, onFlowApproved, actions, nodeCount } = props;
  const t = useT();

  const flow = actions.flow;
  const validated = Boolean(flow?.validation.ok);
  const approved = validated && flowApproved;
  const canConvert = !(actions.converting || nodeCount === 0);

  if (!open) {
    return (
      <aside className="ravel-histos-drawer ravel-histos-drawer-closed" aria-label="打开 Flow 抽屉">
        <button type="button" className="ravel-histos-drawer-toggle" onClick={onToggle} aria-pressed={false} title="打开 Flow 抽屉">
          ►
        </button>
      </aside>
    );
  }

  return (
    <aside className="ravel-histos-drawer" aria-label="Flow 抽屉">
      <div className="ravel-histos-drawer-header">
        <span className="overline-label" style={{ margin: 0 }}>Flow 抽屉</span>
        <Button size="sm" variant="quiet" onClick={onToggle} aria-label="收起 Flow 抽屉">◄</Button>
      </div>

      <div className="ravel-histos-drawer-body">
        {/* Step 1: Convert */}
        <div className="ravel-histos-step">
          <span className="overline-label">1 · 转换（Convert to Flow）</span>
          <Button size="sm" variant="quiet" disabled={!canConvert} onClick={actions.convertToFlow} fullWidth>
            {actions.converting ? t("graph.converting") : t("graph.convert")}
          </Button>
          {actions.convertResult ? <span className="omega-muted-text" role="status">{actions.convertResult}</span> : null}
          {nodeCount === 0 ? <span className="omega-muted-text">当前图为空，暂无可转换的节点。</span> : null}
        </div>

        {/* Step 2: Validate */}
        <div className="ravel-histos-step">
          <span className="overline-label">2 · 校验（Validate）</span>
          {flow ? (
            <>
              <p className="mono-num" style={{ wordBreak: "break-all" }}>{flow.sha256}</p>
              <p className="omega-muted-text">
                {flow.artifact.nodes.length}N · {flow.artifact.edges.length}E · {flow.artifact.evidence.length} evidence
              </p>
              {flow.validation.ok ? (
                <span className="omega-muted-text" role="status">校验通过 ✓</span>
              ) : (
                <ul role="alert">
                  {flow.validation.errors.map((error, index) => (
                    <li key={index} className="omega-error-text">{error}</li>
                  ))}
                  {flow.validation.warnings.map((warning, index) => (
                    <li key={index} className="omega-muted-text">{warning}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="omega-muted-text">尚未转换。图结构转换为 flow_revision 后在此校验。</p>
          )}
        </div>

        {/* Step 3: Approval 门 */}
        <div className="ravel-histos-step">
          <span className="overline-label">3 · 批准（Approval 门）</span>
          <label className="ravel-histos-approval">
            <input
              type="checkbox"
              checked={flowApproved}
              disabled={!validated}
              onChange={(event) => onFlowApproved(event.target.checked)}
            />
            <span>批准执行此 Flow</span>
          </label>
          {!validated && flow ? <span className="omega-muted-text">该 Flow 未通过校验，不能批准。</span> : null}
          {!flow ? <span className="omega-muted-text">先转换并校验后再批准。</span> : null}
        </div>

        {/* Step 4: Run / Schedule */}
        <div className="ravel-histos-step">
          <span className="overline-label">4 · 执行 / 调度</span>
          <Button size="sm" variant="solid" disabled={!approved || actions.executingFlow} onClick={actions.executeFlow} fullWidth>
            {actions.executingFlow ? "Executing…" : "Run Flow"}
          </Button>
          <div className="omega-graph-toolbar-actions">
            <label className="omega-muted-text">{t("graph.scheduleEveryMinutes")} <input className="omega-input omega-input-num" type="number" min={1} max={10080} value={actions.scheduleInterval} onChange={(event) => actions.setScheduleInterval(Number(event.target.value))} /></label>
            <label className="omega-muted-text">{t("graph.scheduleMaxRuns")} <input className="omega-input omega-input-num" type="number" min={1} max={1000} value={actions.scheduleMaxRuns} onChange={(event) => actions.setScheduleMaxRuns(Number(event.target.value))} /></label>
          </div>
          <Button size="sm" variant="quiet" disabled={!approved || actions.scheduling} onClick={actions.createSchedule}>
            {actions.scheduling ? t("graph.scheduling") : t("graph.schedule")}
          </Button>
          {actions.executeResult ? <span className="omega-muted-text" role="status">{actions.executeResult}</span> : null}
          {actions.scheduleResult ? <span className="omega-muted-text" role="status">{actions.scheduleResult}</span> : null}
        </div>
      </div>
    </aside>
  );
}