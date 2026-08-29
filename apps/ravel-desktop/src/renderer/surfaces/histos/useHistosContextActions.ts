/**
 * 任务七：Histos context/flow actions hook。
 *
 * 收敛 GraphPanel 的上下文动作：Convert to Flow / Run Flow / Schedule /
 * Suggest(+freeze suggested) / Freeze 当前选择 / Import ContextSet / Web 导入 /
 * Rebuild 索引 —— 全部走既有 IPC（ipc/client.ts，不改主进程/IPC 协议）。
 *
 * 在本 hook 内维护 flow / 调度 / 建议 / 导入 / 重建等全部动作状态，供
 * HistosToolbar / HistosInspector / HistosFlowDrawer 共享，避免组件各自散拉全局
 * store 或重复发请求。
 */
import * as React from "react";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import type { GraphSelection } from "../../lib/graph-projection";
import type {
  HistosConvertToFlowResultDTO,
  HistosGraphDTO,
  HistosLens,
} from "../../types/dto";
import type { GraphDraftSelection } from "../../components/panels/GraphCanvas";

export interface SuggestCandidate {
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
}

export interface HistosContextActionInput {
  activeSessionId: string | null;
  graph: HistosGraphDTO | null;
  lens: HistosLens;
  selection: GraphSelection | null;
  draft: GraphDraftSelection;
  /** Rebuild 完成后需要回到最新图谱。 */
  refresh: () => void;
}

export interface HistosContextActions {
  // Convert to Flow
  flow: HistosConvertToFlowResultDTO | null;
  converting: boolean;
  convertResult: string | null;
  convertToFlow: () => void;
  // Run Flow（Approval 门在 FlowDrawer 内先批准）
  executingFlow: boolean;
  executeResult: string | null;
  executeFlow: () => void;
  // Schedule
  scheduling: boolean;
  scheduleResult: string | null;
  scheduleInterval: number;
  scheduleMaxRuns: number;
  setScheduleInterval: (value: number) => void;
  setScheduleMaxRuns: (value: number) => void;
  createSchedule: () => void;
  // Freeze 当前选择
  freezing: boolean;
  freezeResult: string | null;
  freezeContext: () => void;
  // Suggest
  suggestQuery: string;
  setSuggestQuery: (value: string) => void;
  suggesting: boolean;
  suggestStatus: string | null;
  suggestCandidates: SuggestCandidate[] | null;
  suggestSelection: string[];
  setSuggestSelection: (value: string[]) => void;
  runSuggest: () => void;
  freezeSuggested: () => void;
  // Import ContextSet
  importWorkspaceId: string;
  setImportWorkspaceId: (value: string) => void;
  importSha: string;
  setImportSha: (value: string) => void;
  importing: boolean;
  runImport: () => void;
  // Web 导入
  webUrl: string;
  setWebUrl: (value: string) => void;
  importingWeb: boolean;
  webResult: string | null;
  importWebResource: () => void;
  // Rebuild
  confirmRebuild: boolean;
  setConfirmRebuild: (value: boolean) => void;
  rebuilding: boolean;
  rebuildResult: string | null;
  rebuildIndex: () => void;
}

export function useHistosContextActions(input: HistosContextActionInput): HistosContextActions {
  const { activeSessionId, graph, lens, selection, draft, refresh } = input;
  const t = useT();

  // Convert to Flow
  const [flow, setFlow] = React.useState<HistosConvertToFlowResultDTO | null>(null);
  const [converting, setConverting] = React.useState(false);
  const [convertResult, setConvertResult] = React.useState<string | null>(null);
  // Run Flow
  const [executingFlow, setExecutingFlow] = React.useState(false);
  const [executeResult, setExecuteResult] = React.useState<string | null>(null);
  // Schedule
  const [scheduling, setScheduling] = React.useState(false);
  const [scheduleResult, setScheduleResult] = React.useState<string | null>(null);
  const [scheduleInterval, setScheduleInterval] = React.useState(60);
  const [scheduleMaxRuns, setScheduleMaxRuns] = React.useState(10);
  // Freeze current selection
  const [freezing, setFreezing] = React.useState(false);
  const [freezeResult, setFreezeResult] = React.useState<string | null>(null);
  // Suggest
  const [suggestQuery, setSuggestQuery] = React.useState("");
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestStatus, setSuggestStatus] = React.useState<string | null>(null);
  const [suggestCandidates, setSuggestCandidates] = React.useState<SuggestCandidate[] | null>(null);
  const [suggestSelection, setSuggestSelection] = React.useState<string[]>([]);
  // Import ContextSet
  const [importWorkspaceId, setImportWorkspaceId] = React.useState("");
  const [importSha, setImportSha] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  // Web 导入
  const [webUrl, setWebUrl] = React.useState("");
  const [importingWeb, setImportingWeb] = React.useState(false);
  const [webResult, setWebResult] = React.useState<string | null>(null);
  // Rebuild
  const [confirmRebuild, setConfirmRebuild] = React.useState(false);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [rebuildResult, setRebuildResult] = React.useState<string | null>(null);

  const convertToFlow = React.useCallback(() => {
    if (!graph || !activeSessionId || converting) return;
    setConverting(true); setConvertResult(null);
    void (async () => {
      // 语义图/混合图不能直接作为 Flow 运行：Convert 恒以 structural 生成 flow_revision。
      const result = await ipc.histosConvertToFlow({
        sourceSet: { sessionIds: [activeSessionId] },
        lens: "structural",
        granularity: "entry",
        ...(selection?.type === "node" ? { selectedNodeRevisionIds: [selection.nodeRevisionId] } : {}),
        ...(selection?.type === "edge" ? { selectedEdgeRevisionIds: [selection.edgeRevisionId] } : {}),
      });
      if (result.ok) {
        setFlow(result.data);
        setConvertResult(t("graph.convertSha", { sha: result.data.sha256 }));
      } else {
        setFlow(null);
        setConvertResult(`${t("graph.convertFailed")}: ${result.message}`);
      }
      setConverting(false);
    })();
  }, [activeSessionId, converting, graph, selection, t]);

  const executeFlow = React.useCallback(() => {
    if (!flow?.validation.ok || !activeSessionId || executingFlow) return;
    setExecutingFlow(true); setExecuteResult(null);
    void (async () => {
      const result = await ipc.histosExecuteFlow({ sha256: flow.sha256 });
      setExecuteResult(result.ok
        ? result.data.ok ? `Flow started: ${result.data.operationId}` : `Flow execution failed: ${result.data.code}`
        : `Flow execution failed: ${result.message}`);
      setExecutingFlow(false);
    })();
  }, [activeSessionId, executingFlow, flow]);

  const createSchedule = React.useCallback(() => {
    if (!flow?.validation.ok || scheduling) return;
    const intervalMinutes = Number.isSafeInteger(scheduleInterval) && scheduleInterval >= 1 ? scheduleInterval : 60;
    const maxRuns = Number.isSafeInteger(scheduleMaxRuns) && scheduleMaxRuns >= 1 ? scheduleMaxRuns : 10;
    setScheduling(true); setScheduleResult(null);
    void (async () => {
      const result = await ipc.flowScheduleCreate({ flowSha: flow.sha256, kind: "interval", intervalMinutes, maxRuns });
      setScheduleResult(result.ok
        ? t("graph.scheduleCreatedParams", { minutes: intervalMinutes, runs: maxRuns, id: result.data.items[result.data.items.length - 1]?.id ?? "" })
        : `${t("graph.scheduleFailed")}: ${result.message}`);
      setScheduling(false);
    })();
  }, [flow, scheduleInterval, scheduleMaxRuns, scheduling, t]);

  const freezeContext = React.useCallback(() => {
    if (!activeSessionId || freezing || draft.nodeRevisionIds.length + draft.edgeRevisionIds.length === 0) return;
    setFreezing(true); setFreezeResult(null);
    void (async () => {
      const result = await ipc.histosFreezeContext({
        sourceSet: { sessionIds: [activeSessionId] },
        lens: "structural",
        granularity: "entry",
        selection: [...draft.nodeRevisionIds, ...draft.edgeRevisionIds],
        targetSessionId: activeSessionId,
      });
      if (!result.ok) {
        setFreezeResult(`${t("graph.freezeFailed")}: ${result.message}`);
      } else if (result.data.ok === false) {
        setFreezeResult(`${t("graph.freezeFailed")}: ${result.data.result.message ?? result.data.diagnostics[0]?.message ?? result.data.message}`);
      } else if (result.data.factAppend?.ok) setFreezeResult(t("graph.freezeSha", { sha: result.data.sha256 }));
      else setFreezeResult(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
      setFreezing(false);
    })();
  }, [activeSessionId, draft, freezing, t]);

  const runSuggest = React.useCallback(() => {
    const query = suggestQuery.trim();
    if (suggesting) return;
    if (!query) { setSuggestCandidates(null); setSuggestStatus(t("graph.suggestEmptyQuery")); return; }
    setSuggesting(true); setSuggestStatus(null);
    void (async () => {
      const result = await ipc.histosSuggestContext({ query, limit: 8 });
      setSuggesting(false);
      if (!result.ok) { setSuggestCandidates(null); setSuggestStatus(result.message); return; }
      setSuggestSelection([]);
      if (result.data.candidates.length === 0) { setSuggestCandidates([]); setSuggestStatus(t("graph.suggestNoHits")); return; }
      setSuggestCandidates(result.data.candidates);
    })();
  }, [suggestQuery, suggesting, t]);

  const freezeSuggested = React.useCallback(() => {
    if (!activeSessionId || suggestSelection.length === 0) return;
    setSuggesting(true); setSuggestStatus(null);
    void (async () => {
      const result = await ipc.histosFreezeContext({
        sourceSet: {},
        lens: "mixed",
        granularity: "entry",
        selection: suggestSelection,
        targetSessionId: activeSessionId,
      });
      if (!result.ok) setSuggestStatus(`${t("graph.freezeFailed")}: ${result.message}`);
      else if (result.data.ok === false) setSuggestStatus(`${t("graph.freezeFailed")}: ${result.data.diagnostics[0]?.message ?? result.data.result.message ?? ""}`);
      else if (result.data.factAppend?.ok) setSuggestStatus(t("graph.freezeSha", { sha: result.data.sha256 }));
      else setSuggestStatus(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
      setSuggesting(false);
    })();
  }, [activeSessionId, suggestSelection, suggesting, t]);

  const runImport = React.useCallback(() => {
    const workspaceId = importWorkspaceId.trim();
    const sha = importSha.trim().toLowerCase();
    if (importing || !activeSessionId) return;
    if (!/^[0-9a-f]{64}$/.test(sha) || !workspaceId) { setSuggestStatus(t("graph.importInvalid")); return; }
    setImporting(true); setSuggestStatus(null);
    void (async () => {
      const result = await ipc.histosImportContext({ sourceWorkspaceId: workspaceId, sourceSha256: sha });
      if (!result.ok) setSuggestStatus(result.message);
      else if (result.data.factAppend?.ok) setSuggestStatus(t("graph.importAttached", { sha: result.data.sha256 }));
      else setSuggestStatus(`${t("graph.freezeFailed")}: ${result.data.factAppend?.error ?? t("graph.sessionNotActive")}`);
      setImporting(false);
    })();
  }, [activeSessionId, importSha, importWorkspaceId, importing, t]);

  const importWebResource = React.useCallback(() => {
    const url = webUrl.trim();
    if (importingWeb || !url) return;
    setImportingWeb(true); setWebResult(null);
    void (async () => {
      const result = await ipc.histosApplyWebResources({ urls: [url] });
      if (!result.ok) setWebResult(`${t("graph.webFailed")}: ${result.message}`);
      else {
        const failures = result.data.diagnostics.length;
        setWebResult(result.data.nodeCount > 0
          ? `${t("graph.webImported", { n: result.data.nodeCount, e: result.data.edgeCount })}${failures > 0 ? ` · ${t("graph.webPartial", { n: failures })}` : ""}`
          : `${t("graph.webFailed")}: ${result.data.diagnostics[0]?.message ?? t("graph.webNoNodes")}`);
      }
      setImportingWeb(false);
    })();
  }, [importingWeb, t, webUrl]);

  const rebuildIndex = React.useCallback(() => {
    if (rebuilding || !activeSessionId) return;
    setRebuilding(true); setRebuildResult(null); setConfirmRebuild(false);
    void (async () => {
      const result = await ipc.histosRebuild({ sourceSet: { sessionIds: [activeSessionId] }, lens, granularity: "entry" });
      setRebuildResult(result.ok ? t("graph.rebuildDone") : `${t("graph.rebuildFailed")}: ${result.message}`);
      setRebuilding(false);
      refresh();
    })();
  }, [activeSessionId, lens, rebuilding, refresh, t]);

  return {
    flow,
    converting,
    convertResult,
    convertToFlow,
    executingFlow,
    executeResult,
    executeFlow,
    scheduling,
    scheduleResult,
    scheduleInterval,
    scheduleMaxRuns,
    setScheduleInterval,
    setScheduleMaxRuns,
    createSchedule,
    freezing,
    freezeResult,
    freezeContext,
    suggestQuery,
    setSuggestQuery,
    suggesting,
    suggestStatus,
    suggestCandidates,
    suggestSelection,
    setSuggestSelection,
    runSuggest,
    freezeSuggested,
    importWorkspaceId,
    setImportWorkspaceId,
    importSha,
    setImportSha,
    importing,
    runImport,
    webUrl,
    setWebUrl,
    importingWeb,
    webResult,
    importWebResource,
    confirmRebuild,
    setConfirmRebuild,
    rebuilding,
    rebuildResult,
    rebuildIndex,
  };
}