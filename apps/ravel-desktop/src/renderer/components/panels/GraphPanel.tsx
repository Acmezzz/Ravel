import * as React from "react";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import { projectHistosGraph, type GraphSelection, type GraphTraceTarget } from "../../lib/graph-projection";
import { useAppStore } from "../../store/useAppStore";
import type { HistosGraphDTO } from "../../types/dto";
import { Button, IconButton } from "../../ui/Button";

type SelectedItem = ReturnType<typeof projectHistosGraph>["nodes"][number] | ReturnType<typeof projectHistosGraph>["edges"][number];

function targetLabel(target: GraphTraceTarget): string {
  if (target.entryId) return `entry ${target.entryId}`;
  if (target.toolCallId) return `tool ${target.toolCallId}`;
  return "session only";
}

function selectedItem(graph: ReturnType<typeof projectHistosGraph>, selection: GraphSelection | null): SelectedItem | null {
  if (!selection) return null;
  return selection.type === "node"
    ? graph.nodes.find((item) => item.id === selection.nodeRevisionId) ?? null
    : graph.edges.find((item) => item.id === selection.edgeRevisionId) ?? null;
}

export function GraphPanel(): React.ReactElement {
  const t = useT();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const workspaceEpoch = useAppStore((state) => state.workspaceEpoch);
  const requestTranscriptNavigation = useAppStore((state) => state.requestTranscriptNavigation);
  const [graph, setGraph] = React.useState<HistosGraphDTO | null>(null);
  const [selection, setSelection] = React.useState<GraphSelection | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [converting, setConverting] = React.useState(false);
  const [convertResult, setConvertResult] = React.useState<string | null>(null);
  const requestEpoch = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const epoch = ++requestEpoch.current;
    if (!activeSessionId) {
      setGraph(null);
      setSelection(null);
      setError(null);
      return;
    }
    const sessionId = activeSessionId;
    setLoading(true);
    setError(null);
    const result = await ipc.histosGetGraph({ sourceSet: { sessionIds: [sessionId] }, lens: "structural", granularity: "entry" });
    if (epoch !== requestEpoch.current || useAppStore.getState().activeSessionId !== sessionId) return;
    if (result.ok) {
      setGraph(result.data);
      setSelection(null);
    } else {
      setGraph(null);
      setSelection(null);
      setError(result.message);
    }
    setLoading(false);
  }, [activeSessionId]);

  React.useEffect(() => { void refresh(); }, [refresh, workspaceEpoch]);

  const projected = React.useMemo(() => graph ? projectHistosGraph(graph, selection) : null, [graph, selection]);
  const selected = projected ? selectedItem(projected, selection) : null;
  const evidenceCount = selected && graph ? graph.evidence.filter((item) => item.revisionId === selected.id).length : 0;
  const target = selected?.anchor;
  const canNavigate = Boolean(target && (target.entryId || target.toolCallId) && target.sessionId === activeSessionId);
  const openTranscript = React.useCallback(() => {
    if (!target || !canNavigate) return;
    requestTranscriptNavigation({ sessionId: target.sessionId, ...(target.entryId ? { entryId: target.entryId } : {}), ...(target.toolCallId ? { toolCallId: target.toolCallId } : {}) });
  }, [canNavigate, requestTranscriptNavigation, target]);
  const convertToFlow = React.useCallback(async () => {
    if (!graph || !activeSessionId || converting) return;
    setConverting(true);
    setConvertResult(null);
    const result = await ipc.histosConvertToFlow({
      sourceSet: { sessionIds: [activeSessionId] },
      lens: "structural",
      granularity: "entry",
      ...(selection?.type === "node" ? { selectedNodeRevisionIds: [selection.nodeRevisionId] } : {}),
      ...(selection?.type === "edge" ? { selectedEdgeRevisionIds: [selection.edgeRevisionId] } : {}),
    });
    if (result.ok) setConvertResult(t("graph.convertSha", { sha: result.data.sha256 }));
    else setConvertResult(`${t("graph.convertFailed")}: ${result.message}`);
    setConverting(false);
  }, [activeSessionId, converting, graph, selection, t]);

  return (
    <div className="omega-graph-panel">
      <div className="omega-graph-toolbar">
        <div><span className="overline-label">{t("graph.title")}</span><span className="omega-muted-text">{t("graph.query")}</span></div>
        <div className="omega-graph-toolbar-actions">
          {projected ? <span className="mono-num">{projected.nodes.length}N · {projected.edges.length}E</span> : null}
          <IconButton size="sm" label={t("graph.refresh")} onClick={() => void refresh()} disabled={loading}>↻</IconButton>
        </div>
      </div>
      {loading ? <p className="omega-graph-empty" role="status">{t("graph.loading")}</p> : null}
      {error ? <p className="omega-error-text" role="alert">{error}</p> : null}
      {!loading && !error && !projected ? <p className="omega-graph-empty">{t("graph.noSession")}</p> : null}
      {!loading && !error && projected && projected.nodes.length === 0 ? <p className="omega-graph-empty">{t("graph.empty")}</p> : null}
      {projected ? (
        <>
          <div className="omega-graph-surface" role="region" aria-label={t("graph.nodesAria")}>
            {projected.nodes.map((node) => (
              <button key={node.id} type="button" className={`omega-graph-node${node.selected ? " is-selected" : ""}`} onClick={() => setSelection({ type: "node", nodeRevisionId: node.id })}>
                <span className="omega-graph-node-kind">{node.knownKind ? node.kind : `? ${node.kind}`}</span>
                <strong>{node.title}</strong>
                {node.isolated ? <span className="omega-muted-text">{t("graph.isolated")}</span> : null}
              </button>
            ))}
            {projected.edges.map((edge) => (
              <button key={edge.id} type="button" className={`omega-graph-edge${edge.selected ? " is-selected" : ""}`} onClick={() => setSelection({ type: "edge", edgeRevisionId: edge.id })}>
                <span className="omega-graph-node-kind">{edge.kind}</span>
                <span>{edge.edgeId}</span>
                <span className="omega-muted-text">{edge.missingSource || edge.missingTarget ? t("graph.missingEndpoint") : `${edge.sourceNodeRevisionId} → ${edge.targetNodeRevisionId}`}</span>
              </button>
            ))}
          </div>
          <div className="omega-graph-detail">
            <Button size="sm" variant="quiet" disabled={converting || projected.nodes.length === 0} onClick={() => void convertToFlow()}>{converting ? t("graph.converting") : t("graph.convert")}</Button>
            {convertResult ? <span className="omega-muted-text" role="status">{convertResult}</span> : null}
          </div>
          {selected ? (
            <section className="omega-graph-detail" aria-label={t("graph.detailAria")}>
              <span className="overline-label">{selected.kind}</span>
              <strong>{"title" in selected ? selected.title : selected.edgeId}</strong>
              <span className="mono-num">{selected.id}</span>
              <span className="omega-muted-text">{t("graph.evidence", { n: evidenceCount })}</span>
              {target ? <span className="mono-num">{targetLabel(target)} · {target.sessionId}</span> : <span className="omega-muted-text">{t("graph.noAnchor")}</span>}
              <Button size="sm" variant="quiet" disabled={!canNavigate} onClick={openTranscript} title={!target ? t("graph.noAnchor") : target.sessionId !== activeSessionId ? t("graph.otherSession") : undefined}>{t("graph.openTranscript")}</Button>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
