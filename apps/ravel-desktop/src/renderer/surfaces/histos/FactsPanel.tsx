/**
 * P2 "facts" tab: the Fact Graph triple list with predicate/source filters,
 * related-triple view for the selected graph node, and the P0 archive /
 * restore / purge actions exposed to the user for the first time.
 */
import * as React from "react";
import type { HistosFactTripleDTO } from "../../types/dto";
import { Button } from "../../ui/Button";
import type { HistosFactPanel } from "./useHistosFactPanel";

interface FactsPanelProps {
  panel: HistosFactPanel;
  /** Owning session of the currently selected node (drives related triples). */
  selectedSessionId?: string | null;
}

// Must stay in sync with histos-fact-derivation.js predicate families:
// core FACT_PREDICATES + the custom_config_<domain> (7), custom_diagnostic_
// observed, custom_usage_observed, custom_goal_state predicates.
const PREDICATE_OPTIONS = [
  "",
  "produces", "approves", "denies", "references", "attaches", "annotates", "schedules", "spawns",
  "custom_config_resource", "custom_config_permission", "custom_config_trust", "custom_config_mcp",
  "custom_config_mode", "custom_config_provider", "custom_config_profile",
  "custom_diagnostic_observed", "custom_usage_observed", "custom_goal_state",
];

function compactObject(object: string, max = 120): string {
  return object.length > max ? `${object.slice(0, max)}…` : object;
}

export function FactsPanel(props: FactsPanelProps): React.ReactElement {
  const { panel, selectedSessionId } = props;
  const [related, setRelated] = React.useState<HistosFactTripleDTO[] | null>(null);
  const [confirmTriple, setConfirmTriple] = React.useState<{ id: string; object: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedSessionId) {
      setRelated(null);
      return;
    }
    let cancelled = false;
    void panel.relatedTo(selectedSessionId).then((triples) => {
      if (!cancelled) setRelated(triples);
    });
    return () => { cancelled = true; };
  }, [panel, selectedSessionId]);

  const runArchive = async (triple: HistosFactTripleDTO) => {
    setBusy(true);
    const reason = window.prompt("归档理由（可选，≤512 字符）", "") ?? undefined;
    const error = await panel.archive("triple", [triple.id ?? ""], reason);
    setBusy(false);
    setNotice(error ?? `已归档 ${triple.id}`);
    if (!error) setConfirmTriple(null);
  };

  const runPurge = async (triple: HistosFactTripleDTO) => {
    setBusy(true);
    const reason = window.prompt("抹除理由（可选，≤512 字符；抹除不可逆）", "") ?? undefined;
    const { error, hint } = await panel.purge("triple", [triple.id ?? ""], reason);
    setBusy(false);
    setNotice(error ?? hint ?? `已抹除 ${triple.id}`);
    if (!error) setConfirmTriple(null);
  };

  const runRestore = async (tombstoneId: string) => {
    setBusy(true);
    const error = await panel.restore([tombstoneId]);
    setBusy(false);
    setNotice(error ?? `已复原 ${tombstoneId}`);
  };

  const tripleKey = (triple: HistosFactTripleDTO): string => triple.id ?? `${triple.subject}:${triple.predicate}:${triple.object}`;

  const rows = (triples: HistosFactTripleDTO[]): React.ReactElement[] =>
    triples.map((triple) => (
      <li key={tripleKey(triple)} className="omega-resource-row ravel-histos-fact-row">
        <span className="mono-num">{triple.predicate}</span>
        <span className="omega-resource-row-title">
          <strong>{triple.subject}</strong>
          <span className="omega-muted-text">{compactObject(triple.object)}</span>
          <span className="omega-muted-text">{triple.source}{triple.tag ? ` · ${triple.tag}` : ""}</span>
        </span>
        <span className="omega-graph-toolbar-actions">
          <Button size="sm" variant="quiet" disabled={busy} onClick={() => runArchive(triple)} title="归档（可撤销）">归档</Button>
          {confirmTriple?.id === triple.id ? (
            <>
              <span className="omega-muted-text" role="status">抹除不可逆，确认？</span>
              <Button size="sm" variant="solid" disabled={busy} onClick={() => runPurge(triple)}>确认抹除</Button>
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirmTriple(null)}>取消</Button>
            </>
          ) : (
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirmTriple({ id: triple.id ?? "", object: triple.object })}>抹除</Button>
          )}
        </span>
      </li>
    ));

  return (
    <div className="ravel-histos-facts-panel">
      <div className="omega-graph-toolbar-actions">
        <label className="omega-muted-text">
          Predicate{" "}
          <select value={panel.predicateFilter} onChange={(event) => panel.setPredicateFilter(event.target.value)}>
            {PREDICATE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option || "all"}</option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="quiet" disabled={panel.loading} onClick={() => void panel.refresh()}>刷新</Button>
        {panel.stats ? <span className="mono-num">{panel.stats.tripleCount} triples · {panel.stats.distinctPredicates} predicates</span> : null}
      </div>
      {panel.error ? <p className="omega-muted-text" role="status">{panel.error}</p> : null}
      {notice ? <p className="omega-muted-text" role="status">{notice}</p> : null}

      {related !== null && selectedSessionId ? (
        <>
          <span className="overline-label">选中节点的关联 triples（{related.length}）</span>
          {related.length > 0 ? <ul className="omega-resource-list">{rows(related)}</ul> : <p className="omega-muted-text">该节点暂无关联 triples。</p>}
        </>
      ) : null}

      <span className="overline-label">事实流（{panel.triples.length}）</span>
      {panel.triples.length > 0 ? (
        <ul className="omega-resource-list">{rows(panel.triples)}</ul>
      ) : (
        <p className="omega-muted-text">暂无事实。</p>
      )}

      {panel.tombstones.length > 0 ? (
        <>
          <span className="overline-label">已归档（{panel.tombstones.length}，可复原）</span>
          <ul className="omega-resource-list">
            {panel.tombstones.map((tombstone) => (
              <li key={tombstone.id} className="omega-resource-row ravel-histos-fact-row">
                <span className="mono-num">{tombstone.targetKind}</span>
                <span className="omega-resource-row-title">
                  <strong>{tombstone.targetId}</strong>
                  <span className="omega-muted-text">{tombstone.reason ?? "无理由"}</span>
                </span>
                <span className="omega-graph-toolbar-actions">
                  <Button size="sm" variant="quiet" disabled={busy} onClick={() => runRestore(tombstone.id)} title="撤销墓碑，恢复可见">复原</Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="omega-muted-text">归档 = 墓碑（可复原，见上方已归档列表）；抹除 = 物理删除（不可逆，含二次确认）。审批账目事实不可归档或单独抹除。</p>
    </div>
  );
}
