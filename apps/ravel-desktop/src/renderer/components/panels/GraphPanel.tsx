import * as React from "react";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import { projectHistosGraph, type GraphSelection, type GraphTraceTarget } from "../../lib/graph-projection";
import { useAppStore } from "../../store/useAppStore";
import type { HistosConvertToFlowResultDTO, HistosGraphDTO } from "../../types/dto";
import { Button, IconButton } from "../../ui/Button";
import { SnippetEditor } from "../common/SnippetEditor";
import { GraphCanvas, type GraphDraftSelection } from "./GraphCanvas";

type ProjectedGraph = ReturnType<typeof projectHistosGraph>;
type SelectedItem = ProjectedGraph["nodes"][number] | ProjectedGraph["edges"][number];
type SuggestCandidate = {
  nodeRevisionId: string;
  nodeId: string;
  kind: string;
  title: string | null;
  artifactSha: string | null;
  lens: string | null;
  createdAt: number;
  evidenceCount: number;
  matchedTerms: string[];
  score: number;
};

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
  const [lens, setLens] = React.useState<HistosGraphDTO["lens"]>("structural");
  const [selection, setSelection] = React.useState<GraphSelection | null>(null);
  const [draft, setDraft] = React.useState<GraphDraftSelection>({ nodeRevisionIds: [], edgeRevisionIds: [] });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [converting, setConverting] = React.useState(false);
  const [flow, setFlow] = React.useState<HistosConvertToFlowResultDTO | null>(null);
  const [convertResult, setConvertResult] = React.useState<string | null>(null);
  const [executingFlow, setExecutingFlow] = React.useState(false);
  const [executeResult, setExecuteResult] = React.useState<string | null>(null);
  const [freezing, setFreezing] = React.useState(false);
  const [freezeResult, setFreezeResult] = React.useState<string | null>(null);
  const [condensing, setCondensing] = React.useState(false);
  const [condenseResult, setCondenseResult] = React.useState<string | null>(null);
  const [suggestQuery, setSuggestQuery] = React.useState("");
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestCandidates, setSuggestCandidates] = React.useState<SuggestCandidate[] | null>(null);
  const [suggestSelection, setSuggestSelection] = React.useState<string[]>([]);
  const [suggestStatus, setSuggestStatus] = React.useState<string | null>(null);
  const [importWorkspaceId, setImportWorkspaceId] = React.useState("");
  const [importSha, setImportSha] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const requestEpoch = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const epoch = ++requestEpoch.current;
    if (!activeSessionId) {
      setGraph(null); setSelection(null); setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] }); setError(null); return;
    }
    const sessionId = activeSessionId;
    setLoading(true); setError(null);
    const result = await ipc.histosGetGraph({ sourceSet: { sessionIds: [sessionId] }, lens, granularity: "entry" });
    if (epoch !== requestEpoch.current || useAppStore.getState().activeSessionId !== sessionId) return;
    if (result.ok) {
      setGraph(result.data); setSelection(null); setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] });
    } else {
      setGraph(null); setSelection(null); setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] }); setError(result.message);
    }
    setLoading(false);
  }, [activeSessionId, lens]);

  React.useEffect(() => { void refresh(); }, [refresh, workspaceEpoch]);

  const projected = React.useMemo(() => graph ? projectHistosGraph(graph, selection) : null, [graph, selection]);
  const graphQuery = React.useMemo(() => ({ sourceSet: { sessionIds: activeSessionId ? [activeSessionId] : [] }, lens, granularity: "entry" as const }), [activeSessionId, lens]);
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
    if (result.ok) {
      setFlow(result.data);
      setConvertResult(t("graph.convertSha", { sha: result.data.sha256 }));
    } else {
      setFlow(null);
      setConvertResult(`${t("graph.convertFailed")}: ${result.message}`);
    }
    setConverting(false);
  }, [activeSessionId, converting, graph, selection, t]);

  const executeFlow = React.useCallback(async () => {
    if (!flow?.validation.ok || !activeSessionId || executingFlow) return;
    setExecutingFlow(true); setExecuteResult(null);
    const result = await ipc.histosExecuteFlow({ sha256: flow.sha256 });
    setExecuteResult(result.ok
      ? result.data.ok ? `Flow started: ${result.data.operationId}` : `Flow execution failed: ${result.data.code}`
      : `Flow execution failed: ${result.message}`);
    setExecutingFlow(false);
  }, [activeSessionId, executingFlow, flow]);

  const condenseGraph = React.useCallback(async () => {
    if (!activeSessionId || !graph || lens === "structural" || condensing) return;
    setCondensing(true); setCondenseResult(null);
    const result = await ipc.histosCondenseGraph({ sourceSet: { sessionIds: [activeSessionId] }, lens, granularity: "entry", budget: 32000 });
    if (!result.ok) setCondenseResult(result.message);
    else if (result.data.ok && result.data.sha256) setCondenseResult(result.data.sha256);
    else setCondenseResult(result.data.diagnostics[0]?.message ?? "Semantic condensation unavailable");
    setCondensing(false);
  }, [activeSessionId, condensing, graph, lens]);

  const freezeContext = React.useCallback(async () => {
    if (!activeSessionId || freezing || (draft.nodeRevisionIds.length === 0 && draft.edgeRevisionIds.length === 0)) return;
    setFreezing(true); setFreezeResult(null);
    const result = await ipc.histosFreezeContext({ sourceSet: { sessionIds: [activeSessionId] }, lens: "structural", granularity: "entry", selection: [...draft.nodeRevisionIds, ...draft.edgeRevisionIds], targetSessionId: activeSessionId });
    if (!result.ok) {
      const detail = result.message;
      setFreezeResult(`${t("graph.freezeFailed")}: ${detail}`);
    } else if (result.data.ok === false) {
      const detail = result.data.result.message ?? result.data.diagnostics[0]?.message ?? result.data.message;
      setFreezeResult(`${t("graph.freezeFailed")}: ${detail}`);
    } else if (result.data.factAppend?.ok) setFreezeResult(t("graph.freezeSha", { sha: result.data.sha256 }));
    else setFreezeResult(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
    setFreezing(false);
  }, [activeSessionId, draft, freezing, t]);

  const runSuggest = React.useCallback(async () => {
    const query = suggestQuery.trim();
    if (suggesting) return;
    if (!query) { setSuggestCandidates(null); setSuggestStatus(t("graph.suggestEmptyQuery")); return; }
    setSuggesting(true); setSuggestStatus(null);
    const result = await ipc.histosSuggestContext({ query, limit: 8 });
    setSuggesting(false);
    if (!result.ok) { setSuggestCandidates(null); setSuggestStatus(result.message); return; }
    setSuggestSelection([]);
    if (result.data.candidates.length === 0) { setSuggestCandidates([]); setSuggestStatus(t("graph.suggestNoHits")); return; }
    setSuggestCandidates(result.data.candidates);
  }, [suggestQuery, suggesting, t]);

  const freezeSuggested = React.useCallback(async () => {
    if (!activeSessionId || suggestSelection.length === 0) return;
    setSuggesting(true); setSuggestStatus(null);
    const result = await ipc.histosFreezeContext({ sourceSet: {}, lens: "mixed", granularity: "entry", selection: suggestSelection, targetSessionId: activeSessionId });
    if (!result.ok) setSuggestStatus(`${t("graph.freezeFailed")}: ${result.message}`);
    else if (result.data.ok === false) setSuggestStatus(`${t("graph.freezeFailed")}: ${result.data.diagnostics[0]?.message ?? result.data.result.message ?? ""}`);
    else if (result.data.factAppend?.ok) setSuggestStatus(t("graph.freezeSha", { sha: result.data.sha256 }));
    else setSuggestStatus(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
    setSuggesting(false);
  }, [activeSessionId, suggestSelection, t]);

  const runImport = React.useCallback(async () => {
    const workspaceId = importWorkspaceId.trim();
    const sha = importSha.trim().toLowerCase();
    if (importing || !activeSessionId) return;
    if (!/^[0-9a-f]{64}$/.test(sha) || !workspaceId) { setSuggestStatus(t("graph.importInvalid")); return; }
    setImporting(true); setSuggestStatus(null);
    const result = await ipc.histosImportContext({ sourceWorkspaceId: workspaceId, sourceSha256: sha });
    if (!result.ok) setSuggestStatus(result.message);
    else if (result.data.factAppend?.ok) setSuggestStatus(t("graph.importAttached", { sha: result.data.sha256 }));
    else setSuggestStatus(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
    setImporting(false);
  }, [activeSessionId, importSha, importWorkspaceId, importing, t]);

  return (
    <div className="omega-graph-panel">
      <div className="omega-graph-toolbar">
        <div><span className="overline-label">{t("graph.title")}</span><span className="omega-muted-text">{t("graph.query")}</span></div>
        <label className="omega-muted-text">Lens <select value={lens} onChange={(event) => setLens(event.target.value as HistosGraphDTO["lens"])}><option value="structural">Structural</option><option value="semantic">Semantic</option><option value="mixed">Mixed</option></select></label>
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
          <GraphCanvas graph={projected} query={graphQuery} onSelect={setSelection} onDraftChange={setDraft} />
          <div className="omega-graph-detail">
            <div className="omega-graph-toolbar-actions">
              <Button size="sm" variant="quiet" disabled={freezing || draft.nodeRevisionIds.length + draft.edgeRevisionIds.length === 0} onClick={() => void freezeContext()}>{freezing ? t("graph.freezing") : t("graph.freeze")}</Button>
              <Button size="sm" variant="quiet" disabled={converting || projected.nodes.length === 0} onClick={() => void convertToFlow()}>{converting ? t("graph.converting") : t("graph.convert")}</Button>
              <Button size="sm" variant="quiet" disabled={condensing || lens === "structural" || projected.nodes.length === 0} onClick={() => void condenseGraph()}>{condensing ? "Condensing…" : "Condense"}</Button>
              <Button size="sm" variant="solid" disabled={!flow?.validation.ok || executingFlow || !activeSessionId} onClick={() => void executeFlow()}>{executingFlow ? "Executing…" : "Run Flow"}</Button>
            </div>
            {freezeResult ? <span className="omega-muted-text" role="status">{freezeResult}</span> : null}
            {convertResult ? <span className="omega-muted-text" role="status">{convertResult}</span> : null}
            {executeResult ? <span className="omega-muted-text" role="status">{executeResult}</span> : null}
            {condenseResult ? <span className="omega-muted-text" role="status">{condenseResult}</span> : null}
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
      <section className="omega-graph-detail" aria-label={t("graph.suggestAria")}>
        <span className="overline-label">{t("graph.suggestTitle")}</span>
        <div className="omega-graph-toolbar-actions">
          <input
            className="omega-input"
            type="text"
            value={suggestQuery}
            placeholder={t("graph.suggestPlaceholder")}
            onChange={(event) => setSuggestQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void runSuggest(); }}
          />
          <Button size="sm" variant="quiet" disabled={suggesting} onClick={() => void runSuggest()}>{suggesting ? t("graph.suggestSearching") : t("graph.suggestRun")}</Button>
          <Button size="sm" variant="solid" disabled={suggesting || suggestSelection.length === 0 || !activeSessionId} onClick={() => void freezeSuggested()}>{t("graph.suggestFreeze")}</Button>
        </div>
        {suggestStatus ? <span className="omega-muted-text" role="status">{suggestStatus}</span> : null}
        <span className="overline-label">{t("graph.importTitle")}</span>
        <div className="omega-graph-toolbar-actions">
          <input
            className="omega-input"
            type="text"
            value={importWorkspaceId}
            placeholder={t("graph.importWorkspace")}
            onChange={(event) => setImportWorkspaceId(event.target.value)}
          />
          <input
            className="omega-input"
            type="text"
            value={importSha}
            placeholder={t("graph.importSha")}
            onChange={(event) => setImportSha(event.target.value)}
          />
          <Button size="sm" variant="quiet" disabled={importing || !activeSessionId} onClick={() => void runImport()}>{importing ? t("graph.importing") : t("graph.importRun")}</Button>
        </div>
        {suggestCandidates !== null && suggestCandidates.length > 0 ? (
          <ul className="omega-resource-list">
            {suggestCandidates.map((candidate) => (
              <li key={candidate.nodeRevisionId} className="omega-resource-row">
                <label className="omega-resource-row-title">
                  <input
                    type="checkbox"
                    checked={suggestSelection.includes(candidate.nodeRevisionId)}
                    onChange={(event) => setSuggestSelection((current) => event.target.checked ? [...current, candidate.nodeRevisionId] : current.filter((id) => id !== candidate.nodeRevisionId))}
                  />
                  <strong>{candidate.title ?? candidate.nodeId}</strong>
                  <span className="omega-muted-text">{candidate.kind} · {candidate.lens ?? "structural"} · {t("graph.evidence", { n: candidate.evidenceCount })}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
