import * as React from "react";
import { ReactFlow, Background, Controls, type Edge, type Node, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphProjection } from "../../lib/graph-projection";

interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const nodeTypes: NodeTypes = {};

function createWorker(): Worker {
  return new Worker(new URL("../../workers/graph-layout.worker.ts", import.meta.url), { type: "module" });
}

export function GraphCanvas({ graph, onSelect }: { graph: GraphProjection; onSelect: (selection: { type: "node"; nodeRevisionId: string } | { type: "edge"; edgeRevisionId: string }) => void }): React.ReactElement {
  const [positions, setPositions] = React.useState<LayoutPosition[]>([]);
  const workerRef = React.useRef<Worker | null>(null);
  const requestId = React.useRef(0);

  React.useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const currentRequest = ++requestId.current;
    const onMessage = (event: MessageEvent<{ type: "layout"; requestId: number; nodes: LayoutPosition[] }>) => {
      if (event.data.type === "layout" && event.data.requestId === currentRequest) setPositions(event.data.nodes);
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({
      type: "layout",
      requestId: currentRequest,
      nodes: graph.nodes.map((node) => ({ id: node.id, width: 180, height: node.isolated ? 72 : 64 })),
      edges: graph.edges.flatMap((edge) => edge.sourceNodeRevisionId && edge.targetNodeRevisionId ? [{ id: edge.id, sources: [edge.sourceNodeRevisionId], targets: [edge.targetNodeRevisionId] }] : []),
    });
    return () => worker.removeEventListener("message", onMessage);
  }, [graph]);

  const positionById = new Map(positions.map((position) => [position.id, position]));
  const nodes = graph.nodes.map((node): Node => {
    const position = positionById.get(node.id);
    return { id: node.id, type: "default", position: { x: position?.x ?? 0, y: position?.y ?? 0 }, data: { label: `${node.kind}: ${node.title}` }, selected: node.selected };
  });
  const edges = graph.edges.filter((edge) => edge.sourceNodeRevisionId && edge.targetNodeRevisionId).map((edge): Edge => ({ id: edge.id, source: edge.sourceNodeRevisionId as string, target: edge.targetNodeRevisionId as string, label: edge.kind, selected: edge.selected }));

  return (
    <div className="omega-graph-canvas" role="application" aria-label="Histos graph canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView onNodeClick={(_, node) => onSelect({ type: "node", nodeRevisionId: node.id })} onEdgeClick={(_, edge) => onSelect({ type: "edge", edgeRevisionId: edge.id })} nodesDraggable={false} nodesConnectable={false} elementsSelectable>
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
