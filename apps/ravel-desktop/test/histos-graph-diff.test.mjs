import test from "node:test";
import assert from "node:assert/strict";
import { describeGraphDiff, diffGraphRevisions } from "../electron/histos-graph-diff.js";

test("graph diff classifies added/removed/changed/moved/rerouted", () => {
  const prev = {
    nodes: [
      { nodeId: "n1", kind: "entry", title: "旧标题" },
      { nodeId: "n2", kind: "operation", title: "运行测试" },
      { nodeId: "gone", kind: "file", title: "删除的节点" },
    ],
    edges: [
      { edgeId: "e1", srcNodeId: "n1", dstNodeId: "n2", kind: "produced" },
      { edgeId: "e-moved", srcNodeId: "n1", dstNodeId: "n2", kind: "produces" },
      { edgeId: "e-old-route", srcNodeId: "n2", dstNodeId: "gone", kind: "navigates" },
    ],
  };
  const next = {
    nodes: [
      { nodeId: "n1", kind: "entry", title: "新标题" },
      { nodeId: "n2", kind: "operation", title: "运行测试" },
      { nodeId: "new", kind: "file", title: "新文件" },
    ],
    edges: [
      { edgeId: "e1", srcNodeId: "n1", dstNodeId: "n2", kind: "produced" },
      // Same edge id, endpoints changed -> moved.
      { edgeId: "e-moved", srcNodeId: "n2", dstNodeId: "new", kind: "produces" },
      // Same pair n2->gone carried by a different edge -> rerouted.
      { edgeId: "e-new-route", srcNodeId: "n2", dstNodeId: "gone", kind: "navigates" },
      { edgeId: "e-added", srcNodeId: "new", dstNodeId: "n2", kind: "produces" },
    ],
  };
  const diff = diffGraphRevisions(prev, next);

  assert.deepEqual(diff.added.map((item) => `${item.type}:${item.id}`).sort(), ["edge:e-added", "node:new"]);
  // e-old-route is not a plain removal: its pair survives via e-new-route (reroute).
  assert.deepEqual(diff.removed.map((item) => `${item.type}:${item.id}`).sort(), ["node:gone"]);
  assert.equal(diff.changed.length, 1);
  assert.deepEqual(diff.changed[0].changes, [{ field: "title", from: "旧标题", to: "新标题" }]);
  assert.equal(diff.moved.length, 1);
  assert.deepEqual(diff.moved[0].from, { src: "n1", dst: "n2" });
  assert.deepEqual(diff.moved[0].to, { src: "n2", dst: "new" });
  assert.equal(diff.rerouted.length, 1);
  assert.equal(diff.rerouted[0].pair, "n2→gone");
  assert.equal(diff.rerouted[0].from.edgeId, "e-old-route");
  assert.equal(diff.rerouted[0].to.edgeId, "e-new-route");

  const lines = describeGraphDiff(diff);
  assert.ok(lines.some((line) => line.startsWith("+ 节点 new")));
  assert.ok(lines.some((line) => line.startsWith("> 边 e-moved")));
  assert.ok(lines.some((line) => line.includes("改由边 e-new-route")));
});

test("identical graphs produce an empty diff and kind changes are reported", () => {
  const graph = { nodes: [{ nodeId: "n1", kind: "entry", title: "t" }], edges: [{ edgeId: "e1", srcNodeId: "n1", dstNodeId: "n1", kind: "produced" }] };
  assert.deepEqual(diffGraphRevisions(graph, graph), { added: [], removed: [], changed: [], moved: [], rerouted: [] });
  const kindChanged = { nodes: [{ nodeId: "n1", kind: "file", title: "t" }], edges: [] };
  const diff = diffGraphRevisions(graph, kindChanged);
  assert.deepEqual(diff.changed[0].changes, [{ field: "kind", from: "entry", to: "file" }]);
});
