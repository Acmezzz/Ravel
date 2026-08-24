import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeTranscript, toRendererEvent } from "../electron/agent-bridge.js";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("agent:event message_start contract is preserved (role/id/text)", () => {
  const events = toRendererEvent({
    type: "message_start",
    message: { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "hello" }] },
  });
  const messageStart = events.find((e) => e.type === "message_start");
  assert.ok(messageStart, "message_start is emitted");
  assert.deepEqual(messageStart.message, { role: "assistant", id: "assistant-1", text: "hello" });
});

test("agent:event text_delta is preserved and additive only", () => {
  const events = toRendererEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "world" },
  });
  const delta = events.find((e) => e.type === "message_update" && e.assistantMessageEvent.type === "text_delta");
  assert.ok(delta, "text_delta is emitted");
  assert.equal(delta.assistantMessageEvent.delta, "world");
});

test("renderer event projection bounds transcript and queue payloads", () => {
  const longText = "x".repeat(70_000);
  const message = toRendererEvent({
    type: "message_end",
    message: { id: "message-1", role: "assistant", content: [{ type: "text", text: longText }] },
  })[0];
  assert.equal(message.message.text.length, 64_001);
  const delta = toRendererEvent({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: longText },
  }).find((event) => event.type === "message_update");
  assert.equal(delta.assistantMessageEvent.delta.length, 4_001);
  const queue = toRendererEvent({
    type: "queue_update",
    steering: [longText, longText],
    followUp: [longText],
  })[0];
  assert.equal(queue.steering[0].length, 2_001);
  assert.equal(queue.pendingCount, 3);
  const error = toRendererEvent({ type: "error", message: longText })[0];
  assert.equal(error.message.length, 64_001);
});

test("tool_execution_summary is additive and does not alter existing event fields", () => {
  // The original tool_execution_start shape must remain identical.
  const base = toRendererEvent({
    type: "tool_execution_start",
    toolCallId: "call-9",
    toolName: "read",
  });
  const safe = base.find((e) => e.type === "tool_execution_start");
  assert.deepEqual(safe, { type: "tool_execution_start", toolCallId: "call-9", toolName: "read" });

  // And a summary event is produced alongside it.
  const summary = base.find((e) => e.type === "tool_execution_summary");
  assert.ok(summary, "summary event is added");
  assert.equal(summary.toolCallId, "call-9");
  assert.equal(summary.status, "running");
});

test("tool_execution_end marks the summary as done/error", () => {
  const end = toRendererEvent({
    type: "tool_execution_end",
    toolCallId: "call-9",
    toolName: "read",
    isError: true,
  });
  const summary = end.find((e) => e.type === "tool_execution_summary");
  assert.ok(summary);
  assert.equal(summary.status, "error");
  assert.ok(summary.endedAt, "endedAt timestamp is set");
});

test("index.html keeps a CSP boundary and references the built bundle", async () => {
  const html = await read("../index.html");
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /\.\/dist\/assets\/index\.js/);
  assert.match(html, /\.\/dist\/assets\/style\.css/);
});

test("bridge source still wires the agent event channel", async () => {
  const source = await read("../electron/agent-bridge.js");
  const main = await read("../electron/main.js");
  assert.match(main, /webContents\.send\("agent:event"/);
  assert.match(source, /tool_execution_summary/);
  assert.match(source, /createAgentSessionRuntime/);
});

test("thinking deltas are forwarded verbatim alongside thinking_status", () => {
  const events = toRendererEvent({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "chain of thought text" },
  });
  const delta = events.find((e) => e.type === "message_update");
  assert.ok(delta, "thinking_delta message_update is emitted");
  assert.equal(delta.assistantMessageEvent.delta, "chain of thought text");
  const status = events.find((e) => e.type === "thinking_status");
  assert.deepEqual(status, { type: "thinking_status", active: true });
});

test("thinking_end marks thinking_status inactive", () => {
  const events = toRendererEvent({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end" },
  });
  const status = events.find((e) => e.type === "thinking_status");
  assert.deepEqual(status, { type: "thinking_status", active: false });
});

test("tool events forward raw args, full paths, and results", () => {
  const end = toRendererEvent({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "edit",
    isError: false,
    args: { path: "/abs/secret/project/src/README.md" },
    result: { content: [{ type: "text", text: "the edited result" }] },
  });
  const summary = end.find((e) => e.type === "tool_execution_summary");
  assert.ok(summary);
  assert.equal(summary.target, "/abs/secret/project/src/README.md");
  assert.equal(summary.resultText, "the edited result");
  assert.match(summary.argsJson, /README\.md/);
});

test("compaction events expose status only", () => {
  const start = toRendererEvent({ type: "compaction_start", reason: "manual" });
  assert.deepEqual(start, [{ type: "compaction_start", status: "start" }]);
  const end = toRendererEvent({
    type: "compaction_end",
    reason: "manual",
    result: { summary: "private compaction text", tokensBefore: 12000 },
    aborted: false,
  });
  assert.deepEqual(end, [{ type: "compaction_end", status: "done" }]);
});

test("queue_update forwards queued user texts for the queue UI", () => {
  const events = toRendererEvent({
    type: "queue_update",
    steering: ["interrupt this"],
    followUp: ["then this"],
  });
  assert.deepEqual(events, [
    { type: "queue_update", steering: ["interrupt this"], followUp: ["then this"], pendingCount: 2 },
  ]);
});

test("bash_execution_update forwards live output", () => {
  const events = toRendererEvent({ type: "bash_execution_update", delta: "line of output\n" });
  assert.deepEqual(events, [{ type: "bash_execution_update", delta: "line of output\n" }]);
});

test("message_end carries the authoritative final text", () => {
  const events = toRendererEvent({
    type: "message_end",
    message: { id: "assistant-9", role: "assistant", content: [{ type: "text", text: "final answer" }] },
  });
  assert.deepEqual(events, [{ type: "message_end", message: { role: "assistant", id: "assistant-9", text: "final answer" } }]);
});

test("tool_execution_end emits the summary before the raw event", () => {
  const events = toRendererEvent({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "read",
    isError: false,
    args: { path: "/a/b.txt" },
    result: { content: [{ type: "text", text: "body" }] },
  });
  assert.equal(events[0].type, "tool_execution_summary");
  assert.equal(events[1].type, "tool_execution_end");
});

test("sanitizeTranscript keeps thinking, entry ids, and tool payloads", () => {
  const fakeSession = {
    sessionManager: {
      getBranch: () => [
        { type: "message", id: "entry-1", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { id: "u1", role: "user", content: "hello" } },
        {
          type: "message",
          id: "entry-2",
          parentId: "entry-1",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            id: "a1",
            role: "assistant",
            content: [
              { type: "thinking", text: "visible reasoning" },
              { type: "text", text: "answer" },
              { type: "toolCall", id: "c1", name: "read", arguments: { path: "/abs/secret/README.md" } },
            ],
          },
        },
        {
          type: "message",
          id: "entry-3",
          parentId: "entry-2",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: { id: "r1", role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "file body" }] },
        },
      ],
    },
  };
  const { messages, toolCards } = sanitizeTranscript(fakeSession);
  assert.equal(messages[0].entryId, "entry-1");
  assert.equal(messages[1].entryId, "entry-2");
  assert.equal(messages[1].thinkingDeferred, true);
  assert.equal(messages[1].thinking, undefined);
  assert.equal(messages[1].text, "answer");
  assert.equal(toolCards[0].target, "/abs/secret/README.md");
  assert.match(toolCards[0].argsJson, /README\.md/);
  assert.equal(toolCards[0].resultText, "file body");
  assert.equal(toolCards[0].afterMessageId, "a1");
});

test("command palette discovers commands instead of hardcoding the V1 list", async () => {
  const source = await read("../src/renderer/components/layout/CommandPalette.tsx");
  assert.match(source, /listCommands/);
  assert.doesNotMatch(source, /const COMMANDS/);
});

test("prompt channel supports steering interrupts while streaming", async () => {
  const worker = await read("../electron/worker.mjs");
  const main = await read("../electron/main.js");
  assert.match(main, /PROMPT_BEHAVIORS/);
  assert.match(main, /"steer"/);
  // Streaming prompts bypass the serial queue so steer actually interrupts.
  assert.match(worker, /session\.isStreaming/);
  // Auto-title skips slash commands and image placeholders.
  assert.match(worker, /autoTitleFor/);
  assert.match(worker, /startsWith\("\/"\)/);
});

test("prompt identity survives the renderer-to-worker boundary", async () => {
  const app = await read("../src/renderer/App.tsx");
  const composer = await read("../src/renderer/components/chat/Composer.tsx");
  const client = await read("../src/renderer/ipc/client.ts");
  const preload = await read("../electron/preload.js");
  const main = await read("../electron/main.js");
  const worker = await read("../electron/worker.mjs");
  assert.match(composer, /clientMessageId/);
  assert.match(client, /clientMessageId\?: string/);
  assert.match(preload, /clientMessageId must be a bounded string/);
  assert.match(main, /clientMessageId: clientMessageId\?\.slice\(0, 128\)/);
  assert.match(worker, /activeClientMessageIds/);
  assert.match(worker, /runtimeEpoch/);
  assert.match(app, /meta\?\.clientMessageId/);
  assert.match(app, /currentRuntimeEpoch/);
});

test("optimistic state is cleared on transcript replacement and worker recovery", async () => {
  const store = await read("../src/renderer/store/useAppStore.ts");
  const app = await read("../src/renderer/App.tsx");
  assert.match(store, /pendingOptimistic: \[\]/);
  assert.match(store, /dropAllOptimistic/);
  assert.match(app, /store\.pendingOptimistic\.length > 0/);
  assert.match(app, /store\.dropAllOptimistic\(\)/);
});

test("session_busy is reported when fork/navigate hit a running turn", async () => {
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /withBusyCode/);
  assert.match(worker, /session_busy/);
});

test("composer sends are non-blocking with optimistic rollback guards", async () => {
  const source = await read("../src/renderer/components/chat/Composer.tsx");
  assert.match(source, /sendingRef/);
  assert.match(source, /lastAgentStartAt/);
  assert.match(source, /dropLastIfOptimistic/);
  assert.match(source, /consumeOptimisticWith|optimistic-/);
});

test("panels no longer hardcode dark-only backgrounds", async () => {
  const approval = await read("../src/renderer/components/panels/ApprovalBar.tsx");
  const scout = await read("../src/renderer/components/panels/ScoutPanel.tsx");
  assert.doesNotMatch(approval, /#151923/);
  assert.doesNotMatch(scout, /#151923/);
});

test("agent tools include the pi search tools (grep/find/ls)", async () => {
  const source = await read("../electron/agent-bridge.js");
  assert.match(source, /\["read", "bash", "edit", "write", "grep", "find", "ls"\]/);
});

test("native menu bar is replaced by the in-app title bar", async () => {
  const main = await read("../electron/main.js");
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
  const titleBar = await read("../src/renderer/components/layout/TitleBar.tsx");
  assert.match(titleBar, /WebkitAppRegion/);
  assert.match(titleBar, /ipc\.minimize/);
  assert.match(titleBar, /ipc\.toggleMaximize/);
  assert.match(titleBar, /ipc\.closeWindow/);
});

test("session list supports search, rename, and delete affordances", async () => {
  const source = await read("../src/renderer/components/sessions/SessionList.tsx");
  assert.match(source, /搜索会话/);
  assert.match(source, /setSessionName/);
  assert.match(source, /deleteSession/);
  assert.match(source, /sessionActivity/);
  assert.match(source, /parentSessionId/);
  assert.match(source, /运行中/);
  assert.match(source, /未读/);
  assert.match(source, /子会话/);
  assert.match(source, /加载更多/);
  assert.match(source, /applySessionPage/);
  assert.match(source, /sessionNextOffset/);
});

test("workbench registers Ctrl+K palette and Ctrl+Shift+N new-session shortcuts", async () => {
  const source = await read("../src/renderer/App.tsx");
  assert.match(source, /keydown/);
  assert.match(source, /matchesKeybinding/);
  assert.match(source, /keybindings\.newSession/);
});

test("composer supports image paste, attach, and removable chips", async () => {
  const source = await read("../src/renderer/components/chat/Composer.tsx");
  assert.match(source, /onPaste/);
  assert.match(source, /readImageFile/);
  assert.match(source, /AttachFile/);
  assert.match(source, /onDelete/);
});

test("settings dialog drives queue modes and auto toggles via IPC", async () => {
  const source = await read("../src/renderer/components/layout/SettingsDialog.tsx");
  assert.match(source, /updateSettings/);
  assert.match(source, /steeringMode/);
  assert.match(source, /followUpMode/);
  assert.match(source, /autoCompaction/);
  assert.match(source, /autoRetry/);
});

test("composer carries the pi-web IME composition guard", async () => {
  const source = await read("../src/renderer/components/chat/Composer.tsx");
  assert.match(source, /keyCode === 229/);
  assert.match(source, /COMPOSITION_END_ENTER_GRACE_MS/);
  assert.match(source, /onCompositionStart/);
});

test("composer visualizes the queue with a recall action", async () => {
  const source = await read("../src/renderer/components/chat/Composer.tsx");
  assert.match(source, /queuedMessages/);
  assert.match(source, /clearQueue/);
  assert.match(source, /QueuedRow/);
});

test("theme system has dual palettes, system follow, and view transition", async () => {
  const palettes = await read("../src/renderer/theme/palettes.ts");
  assert.match(palettes, /darkPalette/);
  assert.match(palettes, /lightPalette/);
  assert.match(palettes, /startViewTransition/);
  const main = await read("../src/renderer/main.tsx");
  assert.match(main, /initialResolvedMode/);
  const header = await read("../src/renderer/components/layout/Header.tsx");
  assert.match(header, /setThemeMode/);
});

test("fork, tree overlay, and model picker exist as surfaces", async () => {
  const tree = await read("../src/renderer/components/layout/TreeOverlay.tsx");
  assert.match(tree, /navigateTree/);
  assert.match(tree, /回退到这里/);
  assert.match(tree, /ipc\.clone/);
  const picker = await read("../src/renderer/components/layout/ModelPicker.tsx");
  assert.match(picker, /setModel/);
  assert.match(picker, /modelSwitchToken/);
  const bubble = await read("../src/renderer/components/chat/MessageBubble.tsx");
  assert.match(bubble, /ipc\.fork/);
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /position: "at"/);
  assert.match(worker, /clone:/);
});

test("workspace layer IPC stays path-safe behind senderAllowed", async () => {
  const main = await read("../electron/main.js");
  for (const channel of ["omega:listDir", "omega:readFile", "omega:fileIndex", "omega:revealInFolder", "omega:bash", "omega:gitSnapshot", "omega:listWorktrees", "omega:addWorktree", "omega:removeWorktree", "omega:gitStage", "omega:gitUnstage", "omega:gitCommit"]) {
    assert.ok(main.includes(`ipcMain.handle("${channel}",`), `${channel} handler present`);
  }
  const workspace = await read("../electron/workspace-service.js");
  assert.match(workspace, /Path escapes the workspace root/);
  assert.match(workspace, /IGNORED_DIRS/);
});

test("git review backend applies hunk patches via stdin only", async () => {
  const diff = await read("../electron/diff-service.js");
  assert.match(diff, /"--cached", "--recount", "-"/);
  assert.match(diff, /"-R", "--cached"/);
  assert.match(diff, /"commit", "-F", "-"/);
  assert.match(diff, /computeSnapshot/);
  assert.match(diff, /parseStatusPath/);
});

test("composer supports @ file completion and ! bash passthrough", async () => {
  const source = await read("../src/renderer/components/chat/Composer.tsx");
  assert.match(source, /detectAtToken/);
  assert.match(source, /ipc\.fileIndex/);
  assert.match(source, /runBash/);
  assert.match(source, /startsWith\("!"/);
});

test("left nav exposes the files tab and viewer", async () => {
  const leftNav = await read("../src/renderer/components/layout/LeftNav.tsx");
  assert.match(leftNav, /FileTree/);
  assert.match(leftNav, /leftTab/);
  const viewer = await read("../src/renderer/components/files/FileViewer.tsx");
  assert.match(viewer, /binary/);
  assert.match(viewer, /revealInFolder/);
  assert.match(viewer, /source/);
  assert.match(viewer, /preview/);
  assert.match(viewer, /@\$\{viewer\.path\}:\$\{start\}-\$\{end\}/);
  const markdown = await read("../src/renderer/components/common/Markdown.tsx");
  assert.match(markdown, /openViewer/);
});

test("Project Switcher, replay, and worker recovery reconcile surfaces exist", async () => {
  const switcher = await read("../src/renderer/components/layout/ProjectSwitcher.tsx");
  const client = await read("../src/renderer/ipc/client.ts");
  const app = await read("../src/renderer/App.tsx");
  assert.match(switcher, /chooseWorkspace/);
  assert.match(switcher, /switchWorkspace/);
  assert.match(switcher, /workspaceId/);
  assert.match(client, /recentEvents/);
  assert.match(app, /recentEvents/);
  assert.match(app, /streamingAssistantId: null/);
  assert.match(app, /queuedMessages/);
  assert.match(app, /setSessionTree/);
  assert.match(app, /未确认发送的消息没有自动重发/);
  assert.match(app, /const reconciled = await refreshControlPlane\(\)/);
  assert.match(app, /state\?\.isStreaming !== true/);
  assert.match(switcher, /bumpWorkspaceEpoch/);
  assert.match(switcher, /queryExtensionState/);
  assert.match(switcher, /listModels/);
  assert.match(switcher, /ProjectTrustDialog/);
  assert.match(switcher, /removeWorkspace/);
  assert.match(switcher, /trust_required/);
  const trust = await read("../src/renderer/components/layout/ProjectTrustDialog.tsx");
  assert.match(trust, /始终信任/);
  assert.match(trust, /仅本次/);
  assert.match(trust, /永不信任/);
  const header = await read("../src/renderer/components/layout/Header.tsx");
  assert.match(header, /retryWorker/);
  assert.match(header, /重试 Worker/);
  const main = await read("../electron/main.js");
  assert.match(main, /omega:inspectProjectTrust/);
  assert.match(main, /omega:decideProjectTrust/);
  assert.match(main, /omega:removeWorkspace/);
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /projectTrusted/);
  const bridge = await read("../electron/agent-bridge.js");
  assert.match(bridge, /projectTrusted: session.settingsManager/);
  assert.match(bridge, /queuedMessages: queueSnapshotOf/);
  assert.match(bridge, /tree: sessionTreeOf/);
});

test("session worker pool is session-keyed with a cap and idle TTL", async () => {
  const main = await read("../electron/main.js");
  const pool = await read("../electron/worker-pool.js");
  assert.match(main, /createWorkerSlotPool/);
  assert.match(main, /acquireSlot/);
  assert.match(pool, /worker_cap_exceeded/);
  assert.match(pool, /idleTtlMs/);
  assert.match(pool, /Map/);
});

test("session list uses disk-first JSONL reader instead of starting a live runtime", async () => {
  const main = await read("../electron/main.js");
  const reader = await read("../electron/session-reader.js");
  assert.match(main, /readSessionSummaries/);
  assert.match(main, /piSessionsRoot/);
  assert.match(main, /okResult\(\{ \.\.\.page/);
  assert.match(main, /workspaceId/);
  assert.match(reader, /createReadStream/);
  assert.match(reader, /session_info/);
  assert.match(reader, /treeIndex/);
  assert.match(reader, /nextOffset/);
});

test("R3: deferred thinking and stats/export IPC surfaces", async () => {
  const bridge = await read("../electron/agent-bridge.js");
  assert.match(bridge, /thinkingDeferred/);
  assert.match(bridge, /export function getThinking/);
  assert.match(bridge, /userMessages/);
  const main = await read("../electron/main.js");
  for (const channel of ["omega:getThinking", "omega:getSystemPrompt", "omega:exportHtml"]) {
    assert.ok(main.includes(`ipcMain.handle("${channel}",`), `${channel} handler present`);
  }
  const exporter = await read("../electron/export-html.js");
  assert.match(exporter, /buildSessionHtml/);
});

test("stage 4 isolates renderer subscriptions, scroll work, and stale reads", async () => {
  const composer = await read("../src/renderer/components/chat/Composer.tsx");
  const list = await read("../src/renderer/components/chat/MessageList.tsx");
  const surface = await read("../src/renderer/components/layout/ExtensionSurface.tsx");
  const tree = await read("../src/renderer/components/files/FileTree.tsx");
  const viewer = await read("../src/renderer/components/files/FileViewer.tsx");
  const sessions = await read("../src/renderer/components/sessions/SessionList.tsx");
  assert.match(composer, /messages\.length/);
  assert.match(composer, /useAppStore\.getState\(\)\.messages/);
  assert.match(list, /requestAnimationFrame/);
  assert.match(list, /historyEpochRef/);
  assert.match(surface, /shallow/);
  assert.match(tree, /requestEpochRef/);
  assert.match(viewer, /pageRequestEpochRef/);
  assert.match(sessions, /requestEpochRef/);
});

test("stage 5 workbench keeps focus and narrow layouts explicit", async () => {
  const workbench = await read("../src/renderer/components/layout/Workbench.tsx");
  const header = await read("../src/renderer/components/layout/Header.tsx");
  const store = await read("../src/renderer/store/useAppStore.ts");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(workbench, /useMediaQuery/);
  assert.match(workbench, /focusMode/);
  assert.match(workbench, /compactRightOpen/);
  assert.match(header, /toggleFocusMode/);
  assert.match(header, /更多工作台操作/);
  assert.match(store, /leftPanelOpen/);
  assert.match(store, /toggleFocusMode/);
  assert.match(css, /message-reading-column/);
  assert.match(css, /--omega-accent/);
});

test("stage 4 bounds large diff and extension projections", async () => {
  const diff = await read("../src/renderer/components/panels/DiffViewer.tsx");
  const scout = await read("../src/renderer/components/panels/ScoutPanel.tsx");
  const workflow = await read("../src/renderer/components/panels/WorkflowPanel.tsx");
  assert.match(diff, /MAX_RENDERED_FILES/);
  assert.match(diff, /MAX_RENDERED_LINES_PER_HUNK/);
  assert.match(scout, /MAX_ROUNDS/);
  assert.match(scout, /MAX_PROPOSALS/);
  assert.match(workflow, /MAX_FEATURES/);
  assert.match(workflow, /MAX_ISSUES/);
});

test("R3: thinking blocks defer loading and message list windows", async () => {
  const thinking = await read("../src/renderer/components/chat/ThinkingBlock.tsx");
  assert.match(thinking, /getThinking/);
  assert.match(thinking, /thinkingCache/);
  const list = await read("../src/renderer/components/chat/MessageList.tsx");
  assert.match(list, /WINDOW_SIZE/);
  assert.match(list, /scrollMemory/);
  assert.match(list, /加载更早消息/);
  const info = await read("../src/renderer/components/layout/SessionInfoDialog.tsx");
  assert.match(info, /exportHtml/);
  assert.match(info, /getSystemPrompt/);
});

test("R5: resource inventory is exposed through the worker and surfaced in settings", async () => {
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /listResources/);
  assert.match(worker, /getSkills\(\)/);
  assert.match(worker, /getPrompts\(\)/);
  const main = await read("../electron/main.js");
  assert.ok(main.includes('ipcMain.handle("omega:listResources",'));
  const settings = await read("../src/renderer/components/layout/SettingsDialog.tsx");
  assert.match(settings, /listResources/);
  assert.match(settings, /扩展（/);
  assert.match(settings, /Skills（/);
  assert.match(settings, /资源中心/);
});

test("resource center manages local install, enable, and reload without network", async () => {
  const helper = await read("../electron/resource-center.js");
  assert.match(helper, /network_forbidden/);
  assert.match(helper, /disable-model-invocation/);
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /installAndPersist/);
  assert.match(worker, /reloadResources/);
  assert.match(worker, /setResourceEnabled/);
  assert.match(worker, /knownResourcePath/);
  assert.doesNotMatch(worker, /installNpm|installGit/);
  const center = await read("../src/renderer/components/layout/ResourceCenter.tsx");
  assert.match(center, /installLocalResource/);
  assert.match(center, /reloadResources/);
  assert.match(center, /不会联网/);
  const palette = await read("../src/renderer/components/layout/CommandPalette.tsx");
  assert.match(palette, /打开资源中心/);
});
