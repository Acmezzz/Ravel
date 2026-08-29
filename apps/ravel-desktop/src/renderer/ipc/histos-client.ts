import type {
  IpcResult,
  HistosGetGraphRequest,
  HistosCondenseGraphRequest,
  HistosCondenseGraphResultDTO,
  HistosQueryDTO,
  HistosArtifactDTO,
  HistosExecuteFlowRequest,
  HistosExecuteFlowResultDTO,
  HistosRebuildRequest,
  HistosRebuildResultDTO,
  HistosApplyWebResourcesRequest,
  HistosApplyWebResourcesResultDTO,
  HistosApplyAgentActivityRequest,
  HistosApplyAgentActivityResultDTO,
  HistosApplyEvalResultsRequest,
  HistosApplyEvalResultsResultDTO,
  HistosListCapabilitiesRequest,
  HistosCapabilityDTO,
  HistosInvokeNodeRequest,
  HistosInvokeNodeResultDTO,
  HistosGetNodeRequest,
  HistosNodeRevisionDTO,
  HistosFreezeContextRequest,
  HistosContextFreezeResultDTO,
  HistosConvertToFlowRequest,
  HistosConvertToFlowResultDTO,
  HistosGetArtifactRequest,
  HistosGraphDTO,
} from "../types/dto";
import { ok } from "./utils";

/** Histos graph/context/flow surfaces. */
export const histosClient = {
  histosGetGraph: async (req: HistosGetGraphRequest): Promise<IpcResult<HistosGraphDTO>> =>
    ok(await window.omega?.histosGetGraph?.(req)),
  histosCondenseGraph: async (req: HistosCondenseGraphRequest): Promise<IpcResult<HistosCondenseGraphResultDTO>> =>
    ok(await window.omega?.histosCondenseGraph?.(req)),
  histosSaveViewState: async (req: HistosQueryDTO & { positions: Array<{ id: string; x: number; y: number }> }): Promise<IpcResult<{ sha256: string; artifact: HistosArtifactDTO }>> =>
    ok(await window.omega?.histosSaveViewState?.(req)),
  histosGetViewState: async (req: HistosQueryDTO): Promise<IpcResult<HistosArtifactDTO | null>> =>
    ok(await window.omega?.histosGetViewState?.(req)),
  histosExecuteFlow: async (req: HistosExecuteFlowRequest): Promise<IpcResult<HistosExecuteFlowResultDTO>> =>
    ok(await window.omega?.histosExecuteFlow?.(req)),
  histosRebuild: async (req: HistosRebuildRequest): Promise<IpcResult<HistosRebuildResultDTO>> =>
    ok(await window.omega?.histosRebuild?.(req)),
  histosApplyWebResources: async (req: HistosApplyWebResourcesRequest): Promise<IpcResult<HistosApplyWebResourcesResultDTO>> =>
    ok(await window.omega?.histosApplyWebResources?.(req)),
  histosApplyAgentActivity: async (req: HistosApplyAgentActivityRequest): Promise<IpcResult<HistosApplyAgentActivityResultDTO>> =>
    ok(await window.omega?.histosApplyAgentActivity?.(req)),
  histosApplyEvalResults: async (req: HistosApplyEvalResultsRequest): Promise<IpcResult<HistosApplyEvalResultsResultDTO>> =>
    ok(await window.omega?.histosApplyEvalResults?.(req)),
  histosListCapabilities: async (req?: HistosListCapabilitiesRequest): Promise<IpcResult<HistosCapabilityDTO[]>> =>
    ok(await window.omega?.histosListCapabilities?.(req)),
  histosInvokeNode: async (req: HistosInvokeNodeRequest): Promise<IpcResult<HistosInvokeNodeResultDTO>> =>
    ok(await window.omega?.histosInvokeNode?.(req)),
  histosGetNode: async (req: HistosGetNodeRequest): Promise<IpcResult<HistosNodeRevisionDTO | null>> =>
    ok(await window.omega?.histosGetNode?.(req)),
  histosFreezeContext: async (req: HistosFreezeContextRequest): Promise<IpcResult<HistosContextFreezeResultDTO>> =>
    ok(await window.omega?.histosFreezeContext?.(req)),
  histosConvertToFlow: async (req: HistosConvertToFlowRequest): Promise<IpcResult<HistosConvertToFlowResultDTO>> =>
    ok(await window.omega?.histosConvertToFlow?.(req)),
  histosGetArtifact: async (req: HistosGetArtifactRequest): Promise<IpcResult<HistosArtifactDTO>> =>
    ok(await window.omega?.histosGetArtifact?.(req)),
  histosDiffGraphs: async (req: { prev: HistosGetArtifactRequest; next: HistosGetArtifactRequest }): Promise<IpcResult<{ diff: Record<string, unknown[]>; summary: string[] }>> =>
    ok(await window.omega?.histosDiffGraphs?.(req)),
  histosDistillResource: async (req: { kind: "skill" | "extension" | "prompt"; name: string; filePath: string }): Promise<IpcResult<{ graphSha256: string; contextSha256: string | null; node: { nodeId: string; nodeRevisionId: string; title: string } }>> =>
    ok(await window.omega?.histosDistillResource?.(req)),
  histosImportContext: async (req: { sourceWorkspaceId: string; sourceSha256: string; budget?: number }): Promise<IpcResult<{ sha256: string; sourceSha256: string; factAppend: { ok: boolean; error?: string } }>> =>
    ok(await window.omega?.histosImportContext?.(req)),
  histosSuggestContext: async (req: { query?: string; terms?: string[]; limit?: number }): Promise<IpcResult<{ terms: string[]; candidates: Array<{ nodeRevisionId: string; nodeId: string; kind: string; title: string | null; artifactSha: string | null; lens: string | null; createdAt: number; evidenceCount: number; matchedTerms: string[]; score: number }> }>> =>
    ok(await window.omega?.histosSuggestContext?.(req)),
};

export type HistosClient = typeof histosClient;