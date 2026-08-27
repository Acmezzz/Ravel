import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/renderer/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");


test("Histos graph projection preserves identity, ordering, anchors, and missing endpoints", async () => {
  const source = await read("lib/graph-projection.ts");
  assert.match(source, /export function projectHistosGraph/);
  assert.match(source, /nodeRevisionId/);
  assert.match(source, /missingSource/);
  assert.match(source, /safeAnchor/);
  assert.doesNotMatch(source, /localStorage|SQLite|readFile|querySelector|title\.match/);
  assert.match(source, /sort\(compareRevision\)/);
  assert.match(source, /nodeById/);
  assert.match(source, /connected/);
  assert.match(source, /selected: selection\?\.type/);
  assert.match(source, /targetNodeRevisionId = nodeById\.get/);
  assert.match(source, /knownKind/);
});

test("Graph panel and right rail expose the read-only graph surface", async () => {
  const panel = await read("components/panels/GraphPanel.tsx");
  const right = await read("components/layout/RightPanel.tsx");
  const workbench = await read("components/layout/Workbench.tsx");
  const store = await read("store/useAppStore.ts");
  assert.match(panel, /ipc\.histosGetGraph/);
  assert.match(panel, /sourceSet: \{ sessionIds: \[sessionId\] \}/);
  assert.match(panel, /lens: "structural"/);
  assert.match(panel, /granularity: "entry"/);
  assert.doesNotMatch(panel, /Run|runSemanticGraph/);
  assert.match(right, /value="graph"/);
  assert.match(right, /rightTab === "graph"/);
  assert.match(workbench, /label="打开 Graph 面板"/);
  assert.match(store, /rightTab: "diff" \| "graph"/);
  assert.match(store, /rightTab: "diff",/);
});
