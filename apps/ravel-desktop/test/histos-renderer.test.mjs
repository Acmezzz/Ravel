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

test("Graph panel and right rail expose the selectable graph and gated Flow surface", async () => {
  const panel = await read("components/panels/GraphPanel.tsx");
  const right = await read("components/layout/RightPanel.tsx");
  const workbench = await read("components/layout/Workbench.tsx");
  const store = await read("store/useAppStore.ts");
  assert.match(panel, /ipc\.histosGetGraph/);
  assert.match(panel, /ipc\.histosFreezeContext/);
  assert.match(panel, /targetSessionId: activeSessionId/);
  assert.match(panel, /<SnippetEditor value=\{selected\.title\}/);
  assert.match(panel, /sourceSet: \{ sessionIds: \[sessionId\] \}/);
  assert.match(panel, /lens: "structural"/);
  assert.match(panel, /granularity: "entry"/);
  assert.match(panel, /requestTranscriptNavigation/);
  assert.match(panel, /target\.sessionId !== activeSessionId/);
  assert.match(panel, /ipc\.histosConvertToFlow/);
  assert.match(panel, /ipc\.histosExecuteFlow/);
  assert.match(panel, /Run Flow/);
  assert.match(panel, /flow\?\.validation\.ok/);
  assert.match(right, /value="graph"/);
  assert.match(right, /rightTab === "graph"/);
  assert.match(workbench, /label="打开 Graph 面板"/);
  assert.match(store, /rightTab: "diff" \| "graph"/);
  assert.match(store, /transcriptNavigation/);
  assert.match(await read("components/chat/MessageBubble.tsx"), /data-entry-id/);
  assert.match(await read("components/chat/ToolCard.tsx"), /data-tool-call-id/);
  assert.match(await read("components/chat/MessageList.tsx"), /CSS\.escape/);
  assert.match(store, /rightTab: "diff",/);
});
