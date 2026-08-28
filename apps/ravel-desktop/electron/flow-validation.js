import { createHash } from "node:crypto";
import { canonicalJson } from "./histos-address.js";
import { validateArtifact, writeArtifact, readArtifact } from "./histos-provenance.js";

const VALID_FLOW_KINDS = new Set(["entry", "operation", "tool", "approval", "cluster", "file", "skill"]);
const VALID_EDGE_KINDS = new Set(["contains", "references", "produced", "approved", "session_ref", "context"]);
const EXECUTABLE_FLOW_KINDS = new Set(["entry", "operation", "tool"]);
const MAX_EXECUTION_NODES = 128;
const MAX_EXECUTION_TITLE = 4096;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "invalid_args";
  return error;
}

export function validateFlowSpec(draft, options = {}) {
  const artifact = validateArtifact({ ...draft, kind: "flow_revision" }, { ...options, kind: "flow_revision" });
  const errors = [];
  const warnings = [];
  const nodeMap = new Map();
  const nodeRevisionIds = new Set();
  for (const node of artifact.nodes ?? []) {
    if (!VALID_FLOW_KINDS.has(node.kind)) errors.push(`unsupported node kind: ${node.kind}`);
    if (nodeMap.has(node.nodeId)) errors.push(`duplicate node id: ${node.nodeId}`);
    if (nodeRevisionIds.has(node.nodeRevisionId)) errors.push(`duplicate node revision id: ${node.nodeRevisionId}`);
    nodeMap.set(node.nodeId, node);
    nodeRevisionIds.add(node.nodeRevisionId);
  }

  const adjacency = new Map([...nodeMap.keys()].map((id) => [id, []]));
  const edgeIds = new Set();
  const approvalSources = new Set();
  for (const edge of artifact.edges ?? []) {
    if (!VALID_EDGE_KINDS.has(edge.kind)) errors.push(`unsupported edge kind: ${edge.kind}`);
    if (edgeIds.has(edge.edgeId)) errors.push(`duplicate edge id: ${edge.edgeId}`);
    edgeIds.add(edge.edgeId);
    const source = nodeMap.get(edge.srcNodeId);
    const target = nodeMap.get(edge.dstNodeId);
    if (!source) errors.push(`missing source node ${edge.srcNodeId} for edge ${edge.edgeId}`);
    if (!target) errors.push(`missing destination node ${edge.dstNodeId} for edge ${edge.edgeId}`);
    if (source && target) adjacency.get(edge.srcNodeId).push(edge.dstNodeId);
    if (edge.kind === "approved") {
      if (source?.kind !== "approval") errors.push(`approved edge ${edge.edgeId} must start at an approval node`);
      if (target?.kind !== "tool") errors.push(`approved edge ${edge.edgeId} must end at a tool node`);
      approvalSources.add(edge.srcNodeId);
    }
  }

  if ((artifact.nodes ?? []).length === 0) errors.push("FlowSpec must contain at least one node");
  if ((artifact.nodes ?? []).length > MAX_EXECUTION_NODES) errors.push(`FlowSpec exceeds ${MAX_EXECUTION_NODES} nodes`);
  if (!(artifact.nodes ?? []).some((node) => node.kind === "entry")) errors.push("FlowSpec must contain an entry node");
  if ((artifact.nodes ?? []).filter((node) => node.kind === "entry").length > 1) warnings.push("FlowSpec contains multiple entry nodes; execution uses stable artifact order");
  for (const node of artifact.nodes ?? []) {
    if (node.kind === "approval" && !approvalSources.has(node.nodeId)) errors.push(`approval node ${node.nodeId} has no approved edge`);
    if (node.requiresApproval === true && ![...(artifact.edges ?? [])].some((edge) => edge.kind === "approved" && edge.dstNodeId === node.nodeId)) {
      errors.push(`tool node ${node.nodeId} requires approval coverage`);
    }
  }

  const color = new Map();
  const visit = (nodeId) => {
    const state = color.get(nodeId) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(nodeId, 1);
    for (const next of adjacency.get(nodeId) ?? []) if (visit(next)) return true;
    color.set(nodeId, 2);
    return false;
  };
  for (const nodeId of nodeMap.keys()) if (visit(nodeId)) {
    errors.push("FlowSpec contains a cycle");
    break;
  }

  const evidenceRevisions = new Set((artifact.evidence ?? []).map((item) => item.revisionId));
  const artifactRevisions = new Set([
    ...(artifact.nodes ?? []).map((node) => node.nodeRevisionId),
    ...(artifact.edges ?? []).map((edge) => edge.edgeRevisionId),
  ]);
  for (const item of artifact.evidence ?? []) {
    if (!artifactRevisions.has(item.revisionId)) errors.push(`evidence references unknown revision ${item.revisionId}`);
  }
  for (const node of artifact.nodes ?? []) {
    if (EXECUTABLE_FLOW_KINDS.has(node.kind) && !evidenceRevisions.has(node.nodeRevisionId)) errors.push(`executable node ${node.nodeId} has no direct evidence`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    artifact,
    sha256: createHash("sha256").update(Buffer.from(canonicalJson(artifact), "utf8")).digest("hex"),
  };
}

export function executionPlanOf(artifact, sha256, { targetSessionId } = {}) {
  const validation = validateFlowSpec(artifact, { workspaceId: artifact.workspaceId });
  if (!validation.ok) {
    const error = new Error(`Flow validation failed: ${validation.errors.join("; ")}`);
    error.code = "validation_failed";
    throw error;
  }
  if (validation.sha256 !== sha256) {
    const error = new Error("Flow artifact hash changed during execution preparation");
    error.code = "integrity_error";
    throw error;
  }
  const sessions = artifact.sourceSet?.sessionIds ?? artifact.sourceSet?.sessions;
  if (targetSessionId !== undefined && (!Array.isArray(sessions) || sessions.length !== 1 || sessions[0] !== targetSessionId)) {
    const error = new Error("Flow must target exactly one active source session");
    error.code = "session_mismatch";
    throw error;
  }
  const nodeMap = new Map(artifact.nodes.map((node) => [node.nodeId, node]));
  const nodeOrder = new Map(artifact.nodes.map((node, index) => [node.nodeId, index]));
  const indegree = new Map(artifact.nodes.map((node) => [node.nodeId, 0]));
  const outgoing = new Map(artifact.nodes.map((node) => [node.nodeId, []]));
  for (const edge of artifact.edges ?? []) {
    if (!indegree.has(edge.srcNodeId) || !indegree.has(edge.dstNodeId)) continue;
    outgoing.get(edge.srcNodeId).push(edge.dstNodeId);
    indegree.set(edge.dstNodeId, indegree.get(edge.dstNodeId) + 1);
  }
  const ready = artifact.nodes.filter((node) => indegree.get(node.nodeId) === 0).map((node) => node.nodeId);
  const orderedIds = [];
  while (ready.length > 0) {
    ready.sort((left, right) => nodeOrder.get(left) - nodeOrder.get(right));
    const nodeId = ready.shift();
    orderedIds.push(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) {
      const nextDegree = indegree.get(next) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) ready.push(next);
    }
  }
  const reachable = new Set();
  const visitReachable = (nodeId) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) visitReachable(next);
  };
  for (const node of artifact.nodes) if (node.kind === "entry") visitReachable(node.nodeId);
  const unreachable = artifact.nodes.filter((node) => !reachable.has(node.nodeId));
  if (unreachable.length > 0) {
    const error = new Error("Flow contains unreachable nodes");
    error.code = "validation_failed";
    throw error;
  }
  const steps = orderedIds.filter((nodeId) => EXECUTABLE_FLOW_KINDS.has(nodeMap.get(nodeId)?.kind));
  return {
    flowSha: sha256,
    targetSessionId: targetSessionId ?? null,
    steps: steps.slice(0, MAX_EXECUTION_NODES).map((nodeId) => {
      const node = nodeMap.get(nodeId);
      return {
        id: node.nodeId,
        kind: node.kind,
        title: String(node.title ?? "").slice(0, MAX_EXECUTION_TITLE),
      };
    }),
  };
}

export function convertGraphToFlowDraft(graph, options = {}) {
  if (!graph || typeof graph !== "object") throw invalid("graph must be an object");
  const selectedNodes = new Set(options.selectedNodeRevisionIds ?? (graph.nodes ?? []).map((item) => item.nodeRevisionId));
  const selectedEdges = new Set(options.selectedEdgeRevisionIds ?? (graph.edges ?? []).map((item) => item.edgeRevisionId));
  const nodes = (graph.nodes ?? []).filter((node) => selectedNodes.has(node.nodeRevisionId));
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const edges = (graph.edges ?? []).filter((edge) => selectedEdges.has(edge.edgeRevisionId) && nodeIds.has(edge.srcNodeId) && nodeIds.has(edge.dstNodeId));
  const validRevisions = new Set([...nodes.map((node) => node.nodeRevisionId), ...edges.map((edge) => edge.edgeRevisionId)]);
  const evidence = (graph.evidence ?? []).filter((item) => validRevisions.has(item.revisionId));
  return {
    schemaVersion: 1,
    workspaceId: options.workspaceId ?? graph.workspaceId ?? "workspace",
    kind: "flow_revision",
    sourceSet: graph.sourceSet ?? { sessionIds: [] },
    lens: "structural",
    granularity: graph.granularity ?? "entry",
    nodes,
    edges,
    evidence,
    parents: options.parentSha ? [options.parentSha] : [],
  };
}

export async function persistValidatedFlowSpec(artifactsDir, draft, options = {}) {
  const validation = validateFlowSpec(draft, options);
  if (!validation.ok) {
    const error = new Error(`Flow validation failed: ${validation.errors.join("; ")}`);
    error.code = "validation_failed";
    error.errors = validation.errors;
    throw error;
  }
  const sha256 = await writeArtifact(artifactsDir, validation.artifact, { ...options, kind: "flow_revision" });
  return { sha256, artifact: { ...validation.artifact, sha256 }, validation };
}

export async function loadFlowSpec(artifactsDir, sha256, options = {}) {
  const artifact = await readArtifact(artifactsDir, sha256, { ...options, kind: "flow_revision" });
  const validation = validateFlowSpec(artifact, options);
  return { ...artifact, sha256, validation };
}
