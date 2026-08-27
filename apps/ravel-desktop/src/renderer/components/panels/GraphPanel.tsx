import * as React from "react";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import { projectHistosGraph, type GraphSelection, type GraphTraceTarget } from "../../lib/graph-projection";
import { useAppStore } from "../../store/useAppStore";
import type { HistosGraphDTO } from "../../types/dto";
import { Button, IconButton } from "../../ui/Button";
import { SnippetEditor } from "../common/SnippetEditor";
import { GraphCanvas, type GraphDraftSelection } from "./GraphCanvas";

type ProjectedGraph = ReturnType<typeof projectHistosGraph>;
type SelectedItem = ProjectedGraph["nodes"][number] | ProjectedGraph["edges"][number];

function targetLabel(target: GraphTraceTarget): string {
  if (target.entryId) return `entry ${target.entryId}`;
  if (target.toolCallId) return `tool ${target.toolCallId}`;
  return "session only";
}

function selectedItem(graph: ProjectedGraph, selection: GraphSelection | null): SelectedItem | null {
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
  const [draft, setDraft] = React.useState<GraphDraftSelection>({ nodeRevisionIds: [], edgeRevisionIds: [] });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [converting, setConverting] = React.useState(false);
  const [convertResult, setConvertResult] = React.useState<string | null>(null);
  const [freezing, setFreezing] = React.useState(false);
  const [freezeResult, setFreezeResult] = React.useState<string | null>(null);
  const requestEpoch = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const epoch = ++requestEpoch.current;
    if (!activeSessionId) {
      setGraph(null); setSelection(null); setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] }); setError(null); return;
    }
    const sessionId = activeSessionId;
    setLoading(true); setError(null);
    const result = await ipc.histosGetGraph({ sourceSet: { sessionIds: [sessionId] }, lens: "structural", granularity: "entry" });
    if (epoch !== requestEpoch.current || useAppStore.getState().activeSessionId !== sessionId) return;
    if (result.ok) {
      setGraph(result.data); setSelection(null); setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] });
    } else {
      setGraph(null); setSelection(null); setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] }); setError(result.message);
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
    setConverting(true); setConvertResult(null);
    const result = await ipc.histosConvertToFlow({ sourceSet: { sessionIds: [activeSessionId] }, lens: "structural", granularity: "entry", ...(selection?.type === "node" ? { selectedNodeRevisionIds: [selection.nodeRevisionId] } : {}), ...(selection?.type === "edge" ? { selectedEdgeRevisionIds: [selection.edgeRevisionId] } : {}) });
    setConvertResult(result.ok ? t("graph.convertSha", { sha: result.data.sha256 }) : `${t("graph.convertFailed")}: ${result.message}`);
    setConverting(false);
  }, [activeSessionId, converting, graph, selection, t]);

  const freezeContext = React.useCallback(async () => {
    if (!activeSessionId || freezing || (draft.nodeRevisionIds.length === 0 && draft.edgeRevisionIds.length === 0)) return;
    setFreezing(true); setFreezeResult(null);
    const result = await ipc.histosFreezeContext({ sourceSet: { sessionIds: [activeSessionId] }, lens: "structural", granularity: "entry", selection: [...draft.nodeRevisionIds, ...draft.edgeRevisionIds], targetSessionId: activeSessionId });
    if (!result.ok) setFreezeResult(`${t("graph.freezeFailed")}: ${result.message}`);
    else if (result.data.factAppend?.ok) setFreezeResult(t("graph.freezeSha", { sha: result.data.sha256 }));
    else setFreezeResult(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
    setFreezing(false);
  }, [activeSessionId, draft, freezing, t]);

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
          <GraphCanvas graph={projected} onSelect={setSelection} onDraftChange={setDraft} />
          <div className="omega-graph-detail">
            <div className="omega-graph-toolbar-actions">
              <Button size="sm" variant="quiet" disabled={freezing || draft.nodeRevisionIds.length + draft.edgeRevisionIds.length === 0} onClick={() => void freezeContext()}>{freezing ? t("graph.freezing") : t("graph.freeze")}</Button>
              <Button size="sm" variant="quiet" disabled={converting || projected.nodes.length === 0} onClick={() => void convertToFlow()}>{converting ? t("graph.converting") : t("graph.convert")}</Button>
            </div>
            {freezeResult ? <span className="omega-muted-text" role="status">{freezeResult}</span> : null}
            {convertResult ? <span className="omega-muted-text" role="status">{convertResult}</span> : null}
          </div>
          {selected ? (
            <section className="omega-graph-detail" aria-label={t("graph.detailAria")}>
              <span className="overline-label">{selected.kind}</span>
              <strong>{"title" in selected ? selected.title : selected.edgeId}</strong>
              {"title" in selected ? <SnippetEditor value={selected.title} /> : null}
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
