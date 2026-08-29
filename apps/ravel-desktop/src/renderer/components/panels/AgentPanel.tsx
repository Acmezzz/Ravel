import * as React from "react";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import { keyboardClick } from "../../lib/a11y";
import type { HistosCapabilityDTO, HistosInvocationPlanDTO } from "../../types/dto";
import type { FlowScheduleRow } from "../../types/dto";
import { Button, IconButton } from "../../ui/Button";

type InvokeOutcome = {
  ok: boolean;
  lines: string[];
};

function planSummaryLines(plan: HistosInvocationPlanDTO, t: ReturnType<typeof useT>): string[] {
  const lines: string[] = [];
  lines.push(`${plan.executor} · ${plan.surface} · ${plan.trust}${plan.wired ? "" : ` · ${t("agent.notWired")}`}`);
  if (plan.dryRun) lines.push(t("agent.dryRunPlan"));
  lines.push(`${t("agent.tools")}: ${plan.tools.length > 0 ? plan.tools.join(", ") : "—"}`);
  if (plan.droppedTools.length > 0) lines.push(`${t("agent.droppedTools")}: ${plan.droppedTools.join(", ")}`);
  const budget = plan.budget;
  const budgetParts: string[] = [];
  if (typeof budget.maxSteps === "number") budgetParts.push(`steps ${budget.maxSteps}`);
  if (typeof budget.maxRuntimeMs === "number") budgetParts.push(`${Math.round(budget.maxRuntimeMs / 1000)}s`);
  if (typeof budget.maxTokens === "number") budgetParts.push(`tokens ${budget.maxTokens}`);
  if (budgetParts.length > 0) lines.push(`${t("agent.budget")}: ${budgetParts.join(" · ")}`);
  if (plan.units) lines.push(t("agent.units", { n: plan.units.length }));
  if (plan.waves) lines.push(t("agent.waves", { n: plan.waves.length }));
  return lines;
}

/**
 * Agent capability panel: browses Histos agent-spec capabilities, runs them
 * through the safe invoke pipeline (dry-run by default), and manages the
 * scheduled Flows created from the Graph panel.
 */
export function AgentPanel(): React.ReactElement {
  const t = useT();
  const [capabilities, setCapabilities] = React.useState<HistosCapabilityDTO[] | null>(null);
  const [capError, setCapError] = React.useState<string | null>(null);
  const [capLoading, setCapLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [dryRun, setDryRun] = React.useState(true);
  const [invoking, setInvoking] = React.useState(false);
  const [invokeOutcome, setInvokeOutcome] = React.useState<InvokeOutcome | null>(null);
  const [schedules, setSchedules] = React.useState<FlowScheduleRow[] | null>(null);
  const [scheduleError, setScheduleError] = React.useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setCapLoading(true); setCapError(null);
    const [capRes, scheduleRes] = await Promise.all([ipc.histosListCapabilities(), ipc.flowScheduleList()]);
    if (capRes.ok) { setCapabilities(capRes.data); setInvokeOutcome(null); }
    else setCapError(capRes.message);
    if (scheduleRes.ok) setSchedules(scheduleRes.data.items);
    else setScheduleError(scheduleRes.message);
    setCapLoading(false);
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const invoke = React.useCallback(async (capability: HistosCapabilityDTO) => {
    if (invoking) return;
    setInvoking(true); setInvokeOutcome(null);
    const trimmed = prompt.trim();
    const result = await ipc.histosInvokeNode({
      nodeId: capability.nodeId,
      revisionId: capability.revisionId,
      ...(trimmed ? { prompt: trimmed } : {}),
      dryRun,
    });
    if (!result.ok) {
      setInvokeOutcome({ ok: false, lines: [`${result.code}: ${result.message}`] });
    } else if (result.data.ok === false) {
      setInvokeOutcome({ ok: false, lines: result.data.diagnostics.length > 0
        ? result.data.diagnostics.map((item) => `${item.code}: ${item.message}`)
        : [`${result.data.code}: ${result.data.message}`] });
    } else {
      const lines = planSummaryLines(result.data.plan, t);
      const execution = result.data.execution;
      if (execution) {
        lines.push(`${t("agent.execution")}: ${execution.status ?? "unknown"}${execution.ok === true ? "" : execution.ok === false ? ` · ${t("agent.executionFailed")}` : ""}${execution.sessionId ? ` · ${execution.sessionId}` : ""}`);
        if (execution.uncertain === true) lines.push(t("agent.uncertain"));
        if (execution.error) lines.push(`${t("agent.executionFailed")}: ${execution.error}`);
      }
      setInvokeOutcome({ ok: true, lines });
    }
    setInvoking(false);
  }, [dryRun, invoking, prompt, t]);

  const removeSchedule = React.useCallback(async (id: string) => {
    setRemovingId(id);
    const result = await ipc.flowScheduleRemove({ id });
    if (result.ok) setSchedules(result.data.items);
    else setScheduleError(result.message);
    setRemovingId(null); setConfirmRemoveId(null);
  }, []);

  return (
    <section className="omega-graph-panel" aria-label={t("agent.panelAria")}>
      <div className="omega-graph-toolbar">
        <div><span className="overline-label">{t("agent.capabilitiesTitle")}</span><span className="omega-muted-text">{t("agent.capabilitiesHint")}</span></div>
        <div className="omega-graph-toolbar-actions">
          {capabilities ? <span className="mono-num">{capabilities.length}</span> : null}
          <IconButton size="sm" label={t("agent.refresh")} onClick={() => void refresh()} disabled={capLoading}>↻</IconButton>
        </div>
      </div>
      {capLoading ? <p className="omega-graph-empty" role="status">{t("agent.loading")}</p> : null}
      {capError ? <p className="omega-error-text" role="alert">{capError}</p> : null}
      {!capLoading && !capError && capabilities !== null && capabilities.length === 0 ? <p className="omega-graph-empty">{t("agent.empty")}</p> : null}
      {capabilities !== null && capabilities.length > 0 ? (
        <ul className="omega-resource-list">
          {capabilities.map((capability) => {
            const isExpanded = expanded === capability.nodeId;
            return (
              <li key={capability.nodeId} className="omega-resource-row omega-agent-cap-row">
                <div
                  className="omega-resource-row-title"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => { setExpanded(isExpanded ? null : capability.nodeId); setInvokeOutcome(null); }}
                  onKeyDown={keyboardClick}
                >
                  <strong>{capability.name}</strong>
                  <span className="omega-muted-text">
                    {capability.surface} · {capability.executor} · <span className={capability.trust === "approved" ? "omega-trust-approved" : capability.trust === "reviewed" ? "omega-trust-reviewed" : "omega-trust-draft"}>{capability.trust}</span>
                    {capability.wired ? "" : ` · ${t("agent.notWired")}`}
                  </span>
                </div>
                {isExpanded ? (
                  <div className="omega-agent-invoke">
                    <input
                      className="omega-input"
                      type="text"
                      value={prompt}
                      placeholder={t("agent.promptPlaceholder")}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                    <div className="omega-graph-toolbar-actions">
                      <label className="omega-muted-text">
                        <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                        {t("agent.dryRun")}
                      </label>
                      <Button
                        size="sm"
                        variant={dryRun ? "quiet" : "solid"}
                        disabled={invoking}
                        onClick={() => void invoke(capability)}
                      >
                        {invoking ? t("agent.invoking") : dryRun ? t("agent.planOnly") : t("agent.invoke")}
                      </Button>
                    </div>
                    {!capability.wired && !dryRun ? <p className="omega-error-text" role="alert">{t("agent.unwiredWarning")}</p> : null}
                    {capability.trust !== "approved" && !dryRun ? <p className="omega-muted-text" role="status">{t("agent.trustWarning")}</p> : null}
                    {invokeOutcome ? (
                      <div className={invokeOutcome.ok ? "omega-muted-text" : "omega-error-text"} role={invokeOutcome.ok ? "status" : "alert"}>
                        {invokeOutcome.lines.map((line, index) => <span key={index} className="omega-agent-line">{line}</span>)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <section className="omega-graph-detail" aria-label={t("agent.schedulesAria")}>
        <span className="overline-label">{t("agent.schedulesTitle")}</span>
        {scheduleError ? <p className="omega-error-text" role="alert">{scheduleError}</p> : null}
        {schedules !== null && schedules.length === 0 ? <p className="omega-graph-empty">{t("agent.noSchedules")}</p> : null}
        {schedules !== null && schedules.length > 0 ? (
          <ul className="omega-resource-list">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="omega-resource-row">
                <span className="omega-resource-row-title">
                  <strong>{schedule.kind === "interval" ? t("agent.scheduleEvery", { n: schedule.intervalMinutes ?? 60 }) : t("agent.scheduleDaily", { time: schedule.timeOfDay ?? "00:00" })}</strong>
                  <span className="mono-num">{schedule.flowSha.slice(0, 12)}…</span>
                  <span className="omega-muted-text">{t("agent.scheduleRuns", { done: schedule.runCount, max: schedule.maxRuns })}{schedule.enabled ? "" : ` · ${t("agent.scheduleDisabled")}`}{schedule.lastFiredAt ? ` · ${new Date(schedule.lastFiredAt).toLocaleString()}` : ""}</span>
                </span>
                {confirmRemoveId === schedule.id ? (
                  <span className="omega-graph-toolbar-actions">
                    <span className="omega-muted-text" role="status">{t("agent.confirmRemove")}</span>
                    <Button size="sm" variant="solid" disabled={removingId !== null} onClick={() => void removeSchedule(schedule.id)}>{t("agent.removeYes")}</Button>
                    <Button size="sm" variant="quiet" onClick={() => setConfirmRemoveId(null)}>{t("agent.removeNo")}</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="quiet" onClick={() => setConfirmRemoveId(schedule.id)}>{t("agent.removeSchedule")}</Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
