import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/renderer/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ELK layout worker is bounded and renderer-safe", async () => {
  const worker = await read("workers/graph-layout.worker.ts");
  assert.match(worker, /import Elk from "elkjs\/lib\/elk\.bundled"/);
  assert.match(worker, /MAX_NODES = 500/);
  assert.match(worker, /MAX_EDGES = 2_000/);
  assert.match(worker, /Number\.isFinite\(node\.width\)/);
  assert.match(worker, /nodeIds/);
  assert.match(worker, /elk\.layout/);
  assert.doesNotMatch(worker, /fs|sqlite|ipc|process\./i);
});

test("GraphCanvas uses React Flow as a read-only projection surface", async () => {
  const canvas = await read("components/panels/GraphCanvas.tsx");
  const panel = await read("components/panels/GraphPanel.tsx");
  assert.match(canvas, /from "@xyflow\/react"/);
  assert.match(canvas, /new URL\("\.\.\/\.\.\/workers\/graph-layout\.worker\.ts", import\.meta\.url\)/);
  assert.match(canvas, /nodesDraggable=\{false\}/);
  assert.match(canvas, /nodesConnectable=\{false\}/);
  assert.match(canvas, /elementsSelectable/);
  assert.match(canvas, /worker\.terminate\(\)/);
  assert.doesNotMatch(canvas, /histosGetGraph|ipc\.|readFile|node:fs|node:sqlite/);
  assert.match(panel, /<GraphCanvas graph=\{projected\}/);
});
