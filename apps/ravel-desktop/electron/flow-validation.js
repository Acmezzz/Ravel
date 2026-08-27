import { createHash } from "node:crypto";
import { canonicalJson } from "./histos-address.js";
import { validateArtifact, writeArtifact, readArtifact } from "./histos-provenance.js";

const VALID_FLOW_KINDS = new Set(["entry", "operation", "tool", "approval", "cluster", "file", "skill"]);
const VALID_EDGE_KINDS = new Set(["contains", "references", "produced", "approved", "session_ref", "context"]);

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
  for (const node of artifact.nodes ?? []) {
    if (!VALID_FLOW_KINDS.has(node.kind)) errors.push(`unsupported node kind: ${node.kind}`);
    nodeMap.set(node.nodeId, node);
  }
  const incoming = new Map();
  for (const edge of artifact.edges ?? []) {
    if (!VALID_EDGE_KINDS.has(edge.kind)) errors.push(`unsupported edge kind: ${edge.kind}`);
    if (!nodeMap.has(edge.srcNodeId)) errors.push(`missing source node ${edge.srcNodeId} for edge ${edge.edgeId}`);
    if (!nodeMap.has(edge.dstNodeId)) errors.push(`missing destination node ${edge.dstNodeId} for edge ${edge.edgeId}`);
    incoming.set(edge.dstNodeId, (incoming.get(edge.dstNodeId) ?? 0) + 1);
  }
  if ((artifact.nodes ?? []).length === 0) errors.push("FlowSpec must contain at least one node");
  const evidenceRevisions = new Set((artifact.evidence ?? []).map((item) => item.revisionId));
  for (const node of artifact.nodes ?? []) {
    if (!evidenceRevisions.has(node.nodeRevisionId)) warnings.push(`node ${node.nodeId} has no direct evidence`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    artifact,
    sha256: createHash("sha256").update(Buffer.from(canonicalJson(artifact), "utf8")).digest("hex"),
  };
}

export function convertGraphToFlowDraft(graph, options = {}) {
  if (!graph || typeof graph !== "object") throw invalid("graph must be an object");
  const selectedNodes = new Set(options.selectedNodeRevisionIds ?? (graph.nodes ?? []).map((item) => item.nodeRevisionId));
  const selectedEdges = new Set(options.selectedEdgeRevisionIds ?? (graph.edges ?? []).map((item) => item.edgeRevisionId));
  const nodes = (graph.nodes ?? []).filter((node) => selectedNodes.has(node.nodeRevisionId));
  const edges = (graph.edges ?? []).filter((edge) => selectedEdges.has(edge.edgeRevisionId));
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
