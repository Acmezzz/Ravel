import * as React from "react";
import { applyNodeChanges, ReactFlow, Background, Controls, Handle, Position, type Edge, type Node, type NodeChange, type NodeProps, type NodeTypes, type OnSelectionChangeParams } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphProjection, GraphSelection } from "../../lib/graph-projection";
import { ipc } from "../../ipc/client";
import type { HistosQueryDTO } from "../../types/dto";
import { cn } from "../../ui/utils";
import GraphLayoutWorker from "../../workers/graph-layout.worker?worker";

/**
 * React Flow projection of a GraphRevision (docs/ravel-histos-refactor-plan.md §6).
 * Canvas far-layer (Canvas 2D scene graph) upgrade requires ALL THREE measured
 * criteria simultaneously — do not open that door otherwise:
 *   1. visible simple nodes sustained > ~2000 on one canvas
 *   2. interaction frame time (drag/zoom) P95 > 16ms
 *   3. elkjs worker + viewport culling + node recycling are already not enough
 * Until then this stays React Flow with bounded input (500 nodes / 2000 edges).
 */
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

/**
 * `?worker` gives Vite a real worker entry and a generated constructor.
 * The hand-rolled URL form cannot work here: `import.meta` is erased from the
 * classic IIFE renderer bundle, so a module-relative URL has no base.
 */
function createWorker(): Worker {
  return new GraphLayoutWorker();
}

export function GraphCanvas({ graph, query, onSelect, onDraftChange }: {
  graph: GraphProjection;
  query: HistosQueryDTO;
  onSelect: (selection: GraphSelection | null) => void;
  onDraftChange?: (draft: GraphDraftSelection) => void;
}): React.ReactElement {
  const [positions, setPositions] = React.useState<LayoutPosition[]>([]);
  const [draft, setDraft] = React.useState<GraphDraftSelection>({ nodeRevisionIds: [], edgeRevisionIds: [] });
  const [viewStateLoaded, setViewStateLoaded] = React.useState(false);
  const workerRef = React.useRef<Worker | null>(null);
  const requestId = React.useRef(0);
  const selectedNodes = React.useMemo(() => new Set(draft.nodeRevisionIds), [draft.nodeRevisionIds]);
  const selectedEdges = React.useMemo(() => new Set(draft.edgeRevisionIds), [draft.edgeRevisionIds]);
  const positionByIdRef = React.useRef(new Map<string, LayoutPosition>());

  React.useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const graphKey = React.useMemo(() => `${graph.nodes.map((node) => node.id).join("\u0000")}\u0001${graph.edges.map((edge) => edge.id).join("\u0000")}`, [graph.nodes, graph.edges]);

  React.useEffect(() => {
    setDraft({ nodeRevisionIds: [], edgeRevisionIds: [] });
    onDraftChange?.({ nodeRevisionIds: [], edgeRevisionIds: [] });
    setPositions([]);
    setViewStateLoaded(false);
    positionByIdRef.current = new Map();
  }, [graphKey, onDraftChange]);

  React.useEffect(() => {
    let cancelled = false;
    void ipc.histosGetViewState(query).then((result) => {
      if (cancelled) return;
      const savedPositions = result.ok && result.data?.kind === "view_state" && Array.isArray(result.data.positions) ? result.data.positions : [];
      const restored = savedPositions.map((position) => ({ ...position, width: 180, height: 64 }));
      setPositions(restored);
      positionByIdRef.current = new Map(restored.map((position) => [position.id, position]));
      setViewStateLoaded(true);
    });
    return () => { cancelled = true; };
  }, [query]);

  React.useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !viewStateLoaded || positions.length > 0) return;
    const currentRequest = ++requestId.current;
    const onMessage = (event: MessageEvent<{ type: "layout"; requestId: number; nodes: LayoutPosition[] }>) => {
      if (event.data.type === "layout" && event.data.requestId === currentRequest) {
        setPositions(event.data.nodes);
        positionByIdRef.current = new Map(event.data.nodes.map((position) => [position.id, position]));
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({
      type: "layout",
      requestId: currentRequest,
      nodes: graph.nodes.map((node) => ({ id: node.id, parentId: node.parentId ?? null, width: 180, height: node.isolated ? 72 : 64 })),
      edges: graph.edges.flatMap((edge) => edge.sourceNodeRevisionId && edge.targetNodeRevisionId ? [{ id: edge.id, sources: [edge.sourceNodeRevisionId], targets: [edge.targetNodeRevisionId] }] : []),
    });
    return () => worker.removeEventListener("message", onMessage);
  }, [graph, graphKey, positions.length, viewStateLoaded]);

  const positionById = positionByIdRef.current;
  const nodes = graph.nodes.map((node): HistosFlowNode => {
    const position = positionById.get(node.id);
    return {
      id: node.id,
      type: canvasType(node.kind),
      position: { x: position?.x ?? 0, y: position?.y ?? 0 },
      data: { kind: node.kind, title: node.title, isolated: node.isolated },
      ...(node.parentId ? { parentId: node.parentId } : {}),
      selected: selectedNodes.has(node.id) || node.selected,
      draggable: true,
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

  const onNodesChange = React.useCallback((changes: NodeChange<HistosFlowNode>[]) => {
    const next = applyNodeChanges(changes, nodes);
    const nextPositions = next.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: 180, height: node.height ?? 64 }));
    positionByIdRef.current = new Map(nextPositions.map((position) => [position.id, position]));
    setPositions(nextPositions);
  }, [nodes]);

  const [layoutSaveError, setLayoutSaveError] = React.useState<string | null>(null);
  const onNodeDragStop = React.useCallback(async () => {
    const snapshot = [...positionByIdRef.current.values()].map(({ id, x, y }) => ({ id, x, y }));
    if (snapshot.length === 0) return;
    try {
      const result = await ipc.histosSaveViewState({ ...query, positions: snapshot });
      setLayoutSaveError(result.ok ? null : result.message);
    } catch (error) {
      setLayoutSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [query]);

  return (
    <div className="omega-graph-canvas" role="application" aria-label="Histos graph canvas">
      {layoutSaveError ? (
        <div className="omega-graph-canvas-save-error" role="alert">画布布局保存失败：{layoutSaveError}</div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onSelectionChange={onSelectionChange}
        onNodesChange={onNodesChange}
        onNodeDragStop={() => void onNodeDragStop()}
        onPaneClick={() => applyDraft({ nodeRevisionIds: [], edgeRevisionIds: [] })}
        selectionOnDrag
        panOnDrag={[1, 2]}
        deleteKeyCode={null}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
