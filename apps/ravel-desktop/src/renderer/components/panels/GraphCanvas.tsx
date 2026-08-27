import * as React from "react";
import { ReactFlow, Background, Controls, Handle, Position, type Edge, type Node, type NodeProps, type NodeTypes, type OnSelectionChangeParams } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphProjection, GraphSelection } from "../../lib/graph-projection";
import { cn } from "../../ui/utils";

interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphDraftSelection {
  nodeRevisionIds: string[];
  edgeRevisionIds: string[];
}

type HistosNodeData = { kind: string; title: string; isolated: boolean };
type HistosCanvasType = "operation" | "entry" | "file" | "skill" | "approval" | "cluster";
type HistosFlowNode = Node<HistosNodeData, HistosCanvasType>;

function canvasType(kind: string): HistosCanvasType {
  if (kind === "operation" || kind === "file" || kind === "skill" || kind === "approval" || kind === "cluster") return kind;
  return "entry";
}

function HistosNode({ data, selected }: NodeProps<HistosFlowNode>): React.ReactElement {
  return (
    <div className={cn("omega-histos-node", selected && "is-selected", data.isolated && "is-isolated")} data-kind={data.kind}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="omega-histos-node-kind">{data.kind}</span>
      <strong className="omega-histos-node-title">{data.title}</strong>
      {data.isolated ? <span className="omega-histos-node-flag">isolated</span> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  operation: HistosNode,
  entry: HistosNode,
  file: HistosNode,
  skill: HistosNode,
  approval: HistosNode,
  cluster: HistosNode,
};

function createWorker(): Worker {
  return new Worker(new URL("../../workers/graph-layout.worker.ts", import.meta.url), { type: "module" });
}

export function GraphCanvas({ graph, onSelect, onDraftChange }: {
  graph: GraphProjection;
  onSelect: (selection: GraphSelection | null) => void;
  onDraftChange?: (draft: GraphDraftSelection) => void;
}): React.ReactElement {
  const [positions, setPositions] = React.useState<LayoutPosition[]>([]);
  const [draft, setDraft] = React.useState<GraphDraftSelection>({ nodeRevisionIds: [], edgeRevisionIds: [] });
  const workerRef = React.useRef<Worker | null>(null);
  const requestId = React.useRef(0);
  const selectedNodes = React.useMemo(() => new Set(draft.nodeRevisionIds), [draft.nodeRevisionIds]);
  const selectedEdges = React.useMemo(() => new Set(draft.edgeRevisionIds), [draft.edgeRevisionIds]);

  React.useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] });
    onDraftChange?.({ nodeRevisionIds: [], edgeRevisionIds: [] });
  }, [graph, onDraftChange]);

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
  const nodes = graph.nodes.map((node): HistosFlowNode => {
    const position = positionById.get(node.id);
    return {
      id: node.id,
      type: canvasType(node.kind),
      position: { x: position?.x ?? 0, y: position?.y ?? 0 },
      data: { kind: node.kind, title: node.title, isolated: node.isolated },
      selected: selectedNodes.has(node.id) || node.selected,
      draggable: false,
      connectable: false,
    };
  });
  const edges = graph.edges.filter((edge) => edge.sourceNodeRevisionId && edge.targetNodeRevisionId).map((edge): Edge => ({
    id: edge.id,
    source: edge.sourceNodeRevisionId as string,
    target: edge.targetNodeRevisionId as string,
    label: edge.kind,
    selected: selectedEdges.has(edge.id) || edge.selected,
  }));

  const applyDraft = React.useCallback((next: GraphDraftSelection) => {
    setDraft(next);
    onDraftChange?.(next);
    if (next.nodeRevisionIds.length === 1 && next.edgeRevisionIds.length === 0) onSelect({ type: "node", nodeRevisionId: next.nodeRevisionIds[0] });
    else if (next.edgeRevisionIds.length === 1 && next.nodeRevisionIds.length === 0) onSelect({ type: "edge", edgeRevisionId: next.edgeRevisionIds[0] });
    else if (next.nodeRevisionIds[0]) onSelect({ type: "node", nodeRevisionId: next.nodeRevisionIds[0] });
    else if (next.edgeRevisionIds[0]) onSelect({ type: "edge", edgeRevisionId: next.edgeRevisionIds[0] });
    else onSelect(null);
  }, [onDraftChange, onSelect]);

  const onSelectionChange = React.useCallback((params: OnSelectionChangeParams<HistosFlowNode, Edge>) => {
    applyDraft({
      nodeRevisionIds: params.nodes.map((node) => node.id),
      edgeRevisionIds: params.edges.map((edge) => edge.id),
    });
  }, [applyDraft]);

  return (
    <div className="omega-graph-canvas" role="application" aria-label="Histos graph canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onSelectionChange={onSelectionChange}
        onPaneClick={() => applyDraft({ nodeRevisionIds: [], edgeRevisionIds: [] })}
        selectionOnDrag
        panOnDrag={[1, 2]}
        deleteKeyCode={null}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
