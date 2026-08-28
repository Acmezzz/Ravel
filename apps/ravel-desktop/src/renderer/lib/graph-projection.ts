import type { HistosGraphDTO, HistosNodeRevisionDTO, HistosTraceAnchorDTO } from "../types/dto";

const KNOWN_NODE_KINDS = new Set(["session", "entry", "operation", "tool", "approval", "cluster", "file", "skill", "mcp_config", "span", "context"]);

export type GraphSelection =
  | { type: "node"; nodeRevisionId: string }
  | { type: "edge"; edgeRevisionId: string };

export interface GraphTraceTarget {
  sessionId: string;
  entryId?: string;
  toolCallId?: string;
  assistantEntryId?: string;
  resultEntryId?: string;
}

export interface ProjectedGraphNode {
  id: string;
  nodeId: string;
  kind: string;
  knownKind: boolean;
  title: string;
  createdAt: number;
  anchor?: GraphTraceTarget;
  selected: boolean;
  isolated: boolean;
  parentId?: string | null;
}

export interface ProjectedGraphEdge {
  id: string;
  edgeId: string;
  kind: string;
  createdAt: number;
  sourceNodeRevisionId: string | null;
  targetNodeRevisionId: string | null;
  missingSource: boolean;
  missingTarget: boolean;
  anchor?: GraphTraceTarget;
  selected: boolean;
}

export interface GraphProjection {
  nodes: ProjectedGraphNode[];
  edges: ProjectedGraphEdge[];
  selected: GraphSelection | null;
  diagnostics: string[];
}

function compareRevision(left: { createdAt: number; nodeRevisionId?: string; edgeRevisionId?: string }, right: { createdAt: number; nodeRevisionId?: string; edgeRevisionId?: string }): number {
  return left.createdAt - right.createdAt
    || (left.nodeRevisionId ?? left.edgeRevisionId ?? "").localeCompare(right.nodeRevisionId ?? right.edgeRevisionId ?? "");
}

function safeAnchor(anchor: HistosTraceAnchorDTO | undefined): GraphTraceTarget | undefined {
  if (!anchor || typeof anchor.sessionId !== "string" || anchor.sessionId.length === 0) return undefined;
  const target: GraphTraceTarget = { sessionId: anchor.sessionId };
  for (const field of ["entryId", "toolCallId", "assistantEntryId", "resultEntryId"] as const) {
    const value = anchor[field];
    if (typeof value === "string" && value.length > 0) target[field] = value;
  }
  return Object.keys(target).length > 1 ? target : undefined;
}

function projectNode(node: HistosNodeRevisionDTO, selected: GraphSelection | null, isolated: boolean): ProjectedGraphNode {
  const anchor = safeAnchor(node.anchor);
  return {
    id: node.nodeRevisionId,
    nodeId: node.nodeId,
    kind: node.kind,
    knownKind: KNOWN_NODE_KINDS.has(node.kind),
    title: node.title ?? node.nodeId,
    createdAt: node.createdAt,
    ...(anchor ? { anchor } : {}),
    selected: selected?.type === "node" && selected.nodeRevisionId === node.nodeRevisionId,
    isolated,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
  };
}

export function projectHistosGraph(graph: HistosGraphDTO, selection: GraphSelection | null = null): GraphProjection {
  const diagnostics: string[] = [];
  const sourceNodes = [...graph.nodes].sort(compareRevision);
  const sourceEdges = [...graph.edges].sort(compareRevision);
  const nodeById = new Map<string, string>();
  for (const node of sourceNodes) {
    if (nodeById.has(node.nodeId)) {
      diagnostics.push(`duplicate node id: ${node.nodeId}`);
      continue;
    }
    nodeById.set(node.nodeId, node.nodeRevisionId);
  }
  const connected = new Set<string>();
  const edges = sourceEdges.map((edge): ProjectedGraphEdge => {
    const sourceNodeRevisionId = nodeById.get(edge.srcNodeId) ?? null;
    const targetNodeRevisionId = nodeById.get(edge.dstNodeId) ?? null;
    if (sourceNodeRevisionId) connected.add(sourceNodeRevisionId);
    if (targetNodeRevisionId) connected.add(targetNodeRevisionId);
    const anchor = safeAnchor(edge.anchor);
    return {
      id: edge.edgeRevisionId,
      edgeId: edge.edgeId,
      kind: edge.kind,
      createdAt: edge.createdAt,
      sourceNodeRevisionId,
      targetNodeRevisionId,
      missingSource: sourceNodeRevisionId === null,
      missingTarget: targetNodeRevisionId === null,
      ...(anchor ? { anchor } : {}),
      selected: selection?.type === "edge" && selection.edgeRevisionId === edge.edgeRevisionId,
    };
  });
  const nodes = sourceNodes.map((node) => projectNode(node, selection, !connected.has(node.nodeRevisionId)));
  return { nodes, edges, selected: selection, diagnostics };
}
