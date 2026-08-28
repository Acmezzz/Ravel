/**
 * GraphRevision structured diff (next-cycle B7; roadmap item originally from
 * the external graph-systems survey).
 *
 * Compares two graph-shaped revisions and classifies every difference into
 * the five frozen categories:
 *
 *   added    node/edge present in next only
 *   removed  node/edge present in prev only
 *   changed  same node id whose title/kind changed (field-level from/to)
 *   moved    same edge id whose endpoints changed (the edge "moved")
 *   rerouted same src→dst pair now carried by a different edge id or kind
 *
 * Input accepts both artifact-shaped and DTO-shaped graphs (tolerant key
 * reading: id/nodeId, srcNodeId/src). Pure module — no Electron, no net.
 */

const MAX_DIFF_ITEMS = 10_000;

function firstOf(object, keys) {
  for (const key of keys) {
    if (object && typeof object === "object" && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function normalizeGraph(graph) {
  const nodes = new Map();
  const edges = new Map();
  for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    const id = firstOf(node, ["id", "nodeId", "node_id"]);
    if (typeof id !== "string" || !id) continue;
    nodes.set(id, {
      kind: firstOf(node, ["kind", "type"]) ?? null,
      title: typeof node.title === "string" ? node.title : null,
    });
  }
  for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
    const id = firstOf(edge, ["id", "edgeId", "edge_id"]);
    const src = firstOf(edge, ["srcNodeId", "src", "source"]);
    const dst = firstOf(edge, ["dstNodeId", "dst", "target"]);
    if (typeof id !== "string" || !id || typeof src !== "string" || typeof dst !== "string") continue;
    edges.set(id, { src, dst, kind: edge.kind ?? null });
  }
  return { nodes, edges };
}

function boundedPush(list, item) {
  if (list.length < MAX_DIFF_ITEMS) list.push(item);
}

/**
 * Compare prev → next. Returns { added, removed, changed, moved, rerouted }
 * with entries shaped for direct display. Output is deterministic: sorted by
 * id, then field.
 */
export function diffGraphRevisions(prevGraph, nextGraph) {
  const prev = normalizeGraph(prevGraph);
  const next = normalizeGraph(nextGraph);
  const diff = { added: [], removed: [], changed: [], moved: [], rerouted: [] };

  for (const [id, node] of next.nodes) {
    if (!prev.nodes.has(id)) {
      boundedPush(diff.added, { type: "node", id, ...(node.kind ? { kind: node.kind } : {}), ...(node.title ? { title: node.title } : {}) });
      continue;
    }
    const before = prev.nodes.get(id);
    const changes = [];
    if ((before.kind ?? null) !== (node.kind ?? null)) changes.push({ field: "kind", from: before.kind ?? null, to: node.kind ?? null });
    if ((before.title ?? null) !== (node.title ?? null)) changes.push({ field: "title", from: before.title ?? null, to: node.title ?? null });
    if (changes.length > 0) boundedPush(diff.changed, { type: "node", id, changes });
  }
  for (const [id, node] of prev.nodes) {
    if (!next.nodes.has(id)) {
      boundedPush(diff.removed, { type: "node", id, ...(node.kind ? { kind: node.kind } : {}), ...(node.title ? { title: node.title } : {}) });
    }
  }

  // Reroute detection needs a prev pair → carriers index. A pair that
  // survives from prev to next through a DIFFERENT edge (or kind) is a
  // reroute; its carriers are classified as rerouted rather than added/removed.
  const prevPairIndex = new Map();
  for (const [id, edge] of prev.edges) {
    const key = `${edge.src}→${edge.dst}`;
    if (!prevPairIndex.has(key)) prevPairIndex.set(key, []);
    prevPairIndex.get(key).push({ edgeId: id, kind: edge.kind ?? null });
  }

  const nextPairs = new Map();
  for (const [id, edge] of next.edges) {
    const pairKey = `${edge.src}→${edge.dst}`;
    nextPairs.set(pairKey, { edgeId: id, kind: edge.kind ?? null });
    const before = prev.edges.get(id);
    if (!before) {
      if (prevPairIndex.has(pairKey)) continue; // carried by a new edge: reroute, not an addition
      boundedPush(diff.added, { type: "edge", id, src: edge.src, dst: edge.dst, ...(edge.kind ? { kind: edge.kind } : {}) });
      continue;
    }
    if (before.src !== edge.src || before.dst !== edge.dst) {
      boundedPush(diff.moved, { type: "edge", id, from: { src: before.src, dst: before.dst }, to: { src: edge.src, dst: edge.dst } });
      continue;
    }
    if ((before.kind ?? null) !== (edge.kind ?? null)) {
      boundedPush(diff.changed, { type: "edge", id, changes: [{ field: "kind", from: before.kind ?? null, to: edge.kind ?? null }] });
    }
  }
  for (const [id, edge] of prev.edges) {
    if (!next.edges.has(id)) {
      if (nextPairs.has(`${edge.src}→${edge.dst}`)) continue; // pair survives: reroute, not a removal
      boundedPush(diff.removed, { type: "edge", id, src: edge.src, dst: edge.dst, ...(edge.kind ? { kind: edge.kind } : {}) });
    }
  }
  for (const [pairKey, carriers] of prevPairIndex) {
    const nextCarrier = nextPairs.get(pairKey);
    if (!nextCarrier) continue;
    if (carriers.some((carrier) => carrier.edgeId === nextCarrier.edgeId)) continue; // same edge still carries the pair
    const from = carriers.find((carrier) => carrier.edgeId !== nextCarrier.edgeId) ?? carriers[0];
    boundedPush(diff.rerouted, { pair: pairKey, from, to: nextCarrier });
  }

  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  diff.added.sort(byId);
  diff.removed.sort(byId);
  diff.changed.sort(byId);
  diff.moved.sort(byId);
  diff.rerouted.sort((a, b) => String(a.pair).localeCompare(String(b.pair)));
  return diff;
}

/** One human-readable line per entry, for logs/exports/review notes. */
export function describeGraphDiff(diff) {
  const lines = [];
  for (const item of diff.added) {
    lines.push(item.type === "node" ? `+ 节点 ${item.id}${item.title ? `「${item.title}」` : ""} 新增` : `+ 边 ${item.id}（${item.src} → ${item.dst}）新增`);
  }
  for (const item of diff.removed) {
    lines.push(item.type === "node" ? `- 节点 ${item.id}${item.title ? `「${item.title}」` : ""} 移除` : `- 边 ${item.id}（${item.src} → ${item.dst}）移除`);
  }
  for (const item of diff.changed) {
    for (const change of item.changes) {
      lines.push(`~ ${item.type === "node" ? "节点" : "边"} ${item.id} 的 ${change.field}：${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
    }
  }
  for (const item of diff.moved) {
    lines.push(`> 边 ${item.id} 端点变更：${item.from.src}→${item.from.dst} 改为 ${item.to.src}→${item.to.dst}`);
  }
  for (const item of diff.rerouted) {
    lines.push(`> 连接 ${item.pair} 改由边 ${item.to.edgeId}${item.to.kind ? `（${item.to.kind}）` : ""} 承载（原 ${item.from.edgeId}）`);
  }
  return lines;
}
