import Elk from "elkjs/lib/elk.bundled";

type LayoutNode = { id: string; width: number; height: number };
type LayoutEdge = { id: string; sources: string[]; targets: string[] };
type LayoutRequest = { type: "layout"; requestId: number; nodes: LayoutNode[]; edges: LayoutEdge[] };
type LayoutResponse = { type: "layout"; requestId: number; nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>; error?: string };

const MAX_NODES = 500;
const MAX_EDGES = 2_000;
const elk = new Elk();

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  if (!request || request.type !== "layout" || !Number.isSafeInteger(request.requestId) || request.requestId < 0 || !Array.isArray(request.nodes) || !Array.isArray(request.edges) || request.nodes.length > MAX_NODES || request.edges.length > MAX_EDGES) return;
  const nodes = request.nodes.filter((node) => bounded(node.id, 512) && Number.isFinite(node.width) && Number.isFinite(node.height)).map((node) => ({ id: node.id, width: Math.max(80, Math.min(node.width, 480)), height: Math.max(36, Math.min(node.height, 240)) }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = request.edges.filter((edge) => bounded(edge.id, 512) && edge.sources.length === 1 && edge.targets.length === 1 && nodeIds.has(edge.sources[0]) && nodeIds.has(edge.targets[0])).map((edge) => ({ id: edge.id, sources: edge.sources, targets: edge.targets }));
  try {
    const result = await elk.layout({ id: "histos-graph", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "24", "elk.layered.spacing.nodeNodeBetweenLayers": "48" }, children: nodes, edges });
    const response: LayoutResponse = { type: "layout", requestId: request.requestId, nodes: (result.children ?? []).map((node) => ({ id: node.id, x: Number.isFinite(node.x) ? node.x ?? 0 : 0, y: Number.isFinite(node.y) ? node.y ?? 0 : 0, width: node.width ?? 160, height: node.height ?? 64 })) };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({ type: "layout", requestId: request.requestId, nodes: [], error: error instanceof Error ? error.message.slice(0, 512) : "layout failed" } satisfies LayoutResponse);
  }
};
