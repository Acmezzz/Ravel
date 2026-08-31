import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toRendererEvent } from "../electron/agent-bridge.js";
import { INVOKE_CHANNELS, PUSH_CHANNELS, extractHandleChannels, extractInvokeChannels, uniqueSorted, diffChannelSets } from "../electron/ipc-registry.js";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("main configures Electron isolation and navigation boundaries", async () => {
  const source = await read("../electron/main.js");
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /setWindowOpenHandler/);
  assert.match(source, /will-navigate/);
  assert.match(source, /will-redirect/);
  assert.match(source, /appRendererUrl/);
  assert.match(source, /registerAppProtocol/);
  assert.match(source, /await win\.loadURL\(expectedPageUrl\(\)\)/);
  assert.doesNotMatch(source, /win\.loadFile\(/);
  assert.match(source, /senderAllowed/);
  assert.match(source, /await workerPool\.disposeAll/);
  assert.match(source, /requestCloseDecision/);
  assert.match(source, /CLOSE_DIALOG_BUTTONS/);
  assert.match(source, /closeDecisionFromIndex/);
  assert.match(source, /CLOSE_FLUSH_TIMEOUT/);
  assert.match(source, /abort/);
  assert.match(source, /worker-registry|workspace-registry/);
  assert.match(source, /if \(!app\.isPackaged\) win\?\.webContents\.toggleDevTools\(\)/);
  assert.match(source, /rpc\("bash", \{ command, excludeFromContext/);
  assert.match(source, /createPermissionGuard|assertOperationAllowed/);
  assert.match(source, /pickedByDialog/);
  assert.match(source, /只能安装用户选择的目录、已授权工作区内的本地资源，或已审阅的暂存资源/);
  assert.match(source, /if \(closeHandling \|\| isAgentBusy\(\)\)/);
  assert.match(source, /forgetSessionEvents/);
  assert.match(source, /createNamedSession/);
  assert.match(source, /loadNamedSession/);
});

test("worker and renderer use sequenced event envelopes for stale-event rejection", async () => {
  const worker = await read("../electron/worker.mjs");
  const main = await read("../electron/main.js");
  const ordering = await read("../src/renderer/lib/events/event-ordering.ts");
  const transport = await read("../src/renderer/lib/events/transport-event-reducer.ts");
  const bridge = await read("../src/renderer/app/AppEventBridge.tsx");
  assert.match(worker, /sequence: \+\+eventSequence/);
  assert.match(worker, /sessionId:/);
  assert.match(worker, /generation/);
  assert.match(ordering, /meta\.sequence <= ref\.lastSequence/);
  assert.match(ordering, /meta\.generation < ref\.currentGeneration/);
  assert.match(main, /recentEventsBySession/);
  assert.match(main, /runtimeEpoch/);
  assert.match(main, /firstMeta\?\.runtimeEpoch/);
  assert.match(main, /sendTransportState\("flushing"\)/);
  assert.match(main, /sendTransportState\("exiting"\)/);
  const host = await read("../electron/worker-host.js");
  assert.match(host, /canRetry: !this\.stopping/);
  assert.match(main, /omega:retryWorker/);
  assert.match(transport, /setShutdownPhase", phase: "flushing"/);
  assert.match(bridge, /state\?\.isStreaming !== true/);
  assert.match(transport, /setWorkerError/);
  assert.match(transport, /canRetry/);
});

test("bridge filters raw agent events and does not forward sensitive payloads", async () => {
  const source = await read("../electron/agent-bridge.js");
  assert.match(source, /toRendererEvent/);
  assert.match(source, /event\.message\?\.id/);
  // V3: full-fidelity content, but events are still projected (never the raw SDK event object).
  assert.doesNotMatch(source, /webContents\.send\("agent:event",\s*event\)/);
});

test("tool_execution_summary carries full paths and raw payloads (V3 fidelity)", async () => {
  const events = toRendererEvent({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "edit",
    args: { path: "/abs/secret/project/src/very/deep/README.md", content: "body" },
  });
  const summary = events.find((e) => e.type === "tool_execution_summary");
  assert.ok(summary, "produces a tool_execution_summary event");
  assert.equal(summary.target, "/abs/secret/project/src/very/deep/README.md");
  assert.match(summary.argsJson, /README\.md/);
  // Payloads are size-capped so a pathological result cannot OOM the renderer.
  const source = await read("../electron/agent-bridge.js");
  assert.match(source, /MAX_PAYLOAD_CHARS/);
});

test("message_start keeps IDs and strips raw sensitive event fields (thinking)", () => {
  const result = toRendererEvent({
    type: "message_start",
    message: {
      id: "assistant-1",
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      thinking: "private reasoning",
      toolCall: { args: { secret: "value" } },
    },
  });
  // toRendererEvent now returns an array of safe events.
  assert.ok(Array.isArray(result));
  assert.deepEqual(result[0], {
    type: "message_start",
    message: { role: "assistant", id: "assistant-1", text: "hello" },
  });
});

test("workspace picker and registry IPC stay behind senderAllowed", async () => {
  const source = await read("../electron/main.js");
  for (const channel of ["omega:listWorkspaces", "omega:chooseWorkspace"]) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\("${channel}"`));
    assert.match(source, new RegExp(`"${channel}",\\s*(?:async\\s*)?\\(event`));
  }
  assert.match(source, /workspaceRegistry\.resolveAuthorized/);
  assert.match(source, /dialog\.showOpenDialog/);
});

test("new IPC handlers stay behind senderAllowed and return an IpcResult envelope", async () => {
  const source = await read("../electron/main.js");
  for (const channel of [
    "omega:listSessions",
    "omega:newSession",
    "omega:loadSession",
    "omega:deleteSession",
    "omega:approveChange",
    "omega:getState",
    "omega:listModels",
    "omega:setModel",
    "omega:setThinkingLevel",
    "omega:listCommands",
    "omega:compact",
    "omega:authStatus",
    "omega:getDesktopSettings",
    "omega:updateDesktopSettings",
    "omega:setProviderApiKey",
    "omega:removeProviderApiKey",
    "omega:setSessionName",
    "omega:removeWorkspace",
    "omega:inspectProjectTrust",
    "omega:decideProjectTrust",
    "omega:retryWorker",
    "omega:clone",
    "omega:revealInFolder",
    "omega:listWorktrees",
    "omega:addWorktree",
    "omega:removeWorktree",
    "omega:reloadResources",
    "omega:installLocalResource",
    "omega:removeLocalResource",
    "omega:setResourceEnabled",
    "omega:setSkillModelInvocation",
    "omega:setSkillCommandsEnabled",
    "omega:histosSaveViewState",
    "omega:histosGetViewState",
    "omega:histosExecuteFlow",
    "omega:histosArchive",
    "omega:histosIndexRepo",
    "omega:histosRestore",
    "omega:histosListTombstones",
    "omega:histosPurge",
    "agent:abort",
  ]) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\("${channel}"`), `${channel} handler present`);
    // The handler's 2nd argument is the event. Allow an optional `async` modifier
    // before `(event` — that is an implementation detail, not a security concern.
    assert.match(source, new RegExp(`"${channel}",\\s*(?:async\\s*)?\\(event`), `${channel} receives event`);
  }
  // Every handler re-checks the sender and returns { ok: ... }.
  // (The real implementation passes a descriptive message as a 2nd arg, which is fine.)
  assert.match(source, /if \(!senderAllowed\(event\)\) return errorResult\("forbidden"/, "every handler re-checks the sender");
});

test("preload exposes a narrow validated bridge including omega:* methods", async () => {
  const source = await read("../electron/preload.js");
  assert.match(source, /contextBridge\.exposeInMainWorld/);
  assert.match(source, /MAX_PROMPT_CHARS/);
  assert.match(source, /typeof callback !== "function"/);
  assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  for (const method of [
    "listSessions",
    "newSession",
    "loadSession",
    "deleteSession",
    "approveChange",
    "getState",
    "listModels",
    "setModel",
    "setThinkingLevel",
    "listCommands",
    "compact",
    "authStatus",
    "getDesktopSettings",
    "updateDesktopSettings",
    "setProviderApiKey",
    "removeProviderApiKey",
    "setSessionName",
    "updateSettings",
    "clearQueue",
    "getSessionTree",
    "fork",
    "clone",
    "navigateTree",
    "revealInFolder",
    "listWorktrees",
    "addWorktree",
    "removeWorktree",
    "reloadResources",
    "installLocalResource",
    "removeLocalResource",
    "setResourceEnabled",
    "setSkillModelInvocation",
    "setSkillCommandsEnabled",
    "histosSaveViewState",
    "histosGetViewState",
    "histosExecuteFlow",
    "histosApplyEvalResults",
    "histosQueryFacts",
    "histosWriteFacts",
    "histosFactStats",
    "histosClearFacts",
    "histosArchive",
    "histosIndexRepo",
    "histosRestore",
    "histosListTombstones",
    "histosPurge",
  ]) {
    assert.match(source, new RegExp(`ipcRenderer\\.invoke\\("omega:${method}"`), `${method} invoke present`);
  }
  assert.match(source, /ipcRenderer\.invoke\("agent:abort"\)/);
  // Untrusted inputs are validated before invoking.
  assert.match(source, /invalid_args/);
});

test("IPC registry stays in sync with main handlers and preload invokes", async () => {
  const main = await read("../electron/main.js");
  const preload = await read("../electron/preload.js");
  const contracts = await read("../electron/ipc-contracts.js");
  const registry = await read("../electron/ipc-registry.js");
  const shared = await read("../src/shared/ipc-contracts.ts");
  const handles = uniqueSorted(extractHandleChannels(main));
  const invokes = uniqueSorted(extractInvokeChannels(preload));
  const expected = uniqueSorted(INVOKE_CHANNELS);
  assert.deepEqual(diffChannelSets(expected, handles), { missing: [], extra: [] });
  assert.deepEqual(diffChannelSets(expected, invokes), { missing: [], extra: [] });
  for (const channel of INVOKE_CHANNELS) {
    assert.match(contracts, new RegExp(`"${channel}"`));
    assert.match(shared, new RegExp(`"${channel}"`));
  }
  for (const channel of PUSH_CHANNELS) {
    assert.match(main, new RegExp(`webContents\\.send\\("${channel}"`));
    assert.match(preload, new RegExp(`ipcRenderer\\.on\\("${channel}"`));
    // The contract is the single source of truth for both invoke and push
    // channel names: every push channel must be present in the JS contracts
    // file (or its re-exporting registry).
    assert.match(contracts, new RegExp(`"${channel}"`)) || assert.match(registry, new RegExp(`"${channel}"`));
    assert.match(shared, new RegExp(`"${channel}"`));
  }
});

test("index.html CSP keeps scripts strict while allowing runtime style injection", async () => {
  const html = await read("../index.html");
  assert.match(html, /Content-Security-Policy/);
  // Scope the unsafe-* checks to the actual CSP directive, not the whole document
  // (the words legitimately appear inside a documentation comment).
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  assert.ok(csp, "CSP meta tag is present");
  const cspContent = csp[1];

  // The security-critical directives: no inline script, no eval, locked down
  // object/base/form. This is what must never regress.
  assert.match(cspContent, /script-src 'self' app:;/);
  assert.match(cspContent, /object-src 'none'/);
  assert.match(cspContent, /base-uri 'none'/);
  const scriptSrc = cspContent.match(/script-src([^;]*)/)?.[1] ?? "";
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(cspContent, /unsafe-eval/);

  // style-src deliberately allows 'unsafe-inline': xterm and React Flow inject
  // layout styles at runtime and cannot carry a nonce, which previously rendered
  // the terminal and the Histos graph unusable in the packaged app.
  assert.match(cspContent, /style-src 'self' app: 'unsafe-inline'/);
  assert.match(html, /\.\/dist\/assets\/index\.js/);
});

test("custom window controls are guarded IPC behind senderAllowed", async () => {
  const main = await read("../electron/main.js");
  for (const channel of ["window:minimize", "window:toggleMaximize", "window:close", "window:isMaximized"]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${channel}",\\s*\\(event`), `${channel} handler present`);
  }
  const preload = await read("../electron/preload.js");
  for (const channel of ["window:minimize", "window:toggleMaximize", "window:close", "window:isMaximized"]) {
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\("${channel}"`), `${channel} invoke present`);
  }
  assert.match(preload, /onWindowStateChanged/);
});

test("session-targeted handlers authorize workspace ownership before access", async () => {
  const main = await read("../electron/main.js");
  assert.match(main, /authorizedSessionOf/);
  assert.match(main, /allowedWorkspaces = \(workspaceRegistry\?\.list\(\) \?\? \[\]\)/);
  for (const marker of [
    'ipcMain.handle("omega:readSessionMessages"',
    'ipcMain.handle("omega:setSessionName"',
    'ipcMain.handle("omega:deleteSession"',
  ]) {
    const handler = main.slice(main.indexOf(marker));
    assert.match(handler, /authorizedSessionOf/);
  }
  const load = main.slice(main.indexOf("async function loadNamedSession"));
  assert.ok(load.indexOf("authorizedSessionOf") < load.indexOf("workerPool.get"));
  const deletion = main.slice(main.indexOf('ipcMain.handle("omega:deleteSession"'));
  assert.ok(deletion.indexOf("authorizedSessionOf") < deletion.indexOf("workerPool.dispose"));
  assert.ok(deletion.indexOf("authorizedSessionOf") < deletion.indexOf("unlinkSync"));
});

test("deleteSession only removes files inside the pi sessions root", async () => {
  const main = await read("../electron/main.js");
  assert.match(main, /piSessionsRoot/);
  assert.match(main, /Refusing to delete a file outside the pi sessions directory/);
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /resolveSessionPath/);
});

test("prompt images are validated in both preload and main", async () => {
  const main = await read("../electron/main.js");
  assert.match(main, /MAX_PROMPT_IMAGES/);
  assert.match(main, /normalizePromptImages/);
  const preload = await read("../electron/preload.js");
  assert.match(preload, /MAX_PROMPT_IMAGES/);
  assert.match(preload, /validImage/);
});

test("main notifies on completion only when the window is unfocused", async () => {
  const main = await read("../electron/main.js");
  assert.match(main, /Notification\.isSupported/);
  assert.match(main, /win\.isFocused\(\)/);
});

test("first prompt auto-titles an unnamed session", async () => {
  const worker = await read("../electron/worker.mjs");
  assert.match(worker, /autoTitleFor/);
  assert.match(worker, /sessionName/);
});

test("utility workers do not forward stack traces across the process boundary", async () => {
  const worker = await read("../electron/worker.mjs");
  const histosWorker = await read("../electron/histos-worker.mjs");
  assert.match(worker, /post\(\{ type: "init-error", error: "Agent worker initialization failed" \}\)/);
  assert.match(worker, /post\(\{ type: "worker-error", error: "Agent worker failed" \}\)/);
  assert.match(histosWorker, /post\(\{ type: "error", error: "Histos worker failed" \}\)/);
  assert.doesNotMatch(worker, /post\(\{[^}]*error:\s*error\?\.stack/);
  assert.doesNotMatch(histosWorker, /post\(\{[^}]*error:\s*error\?\.stack/);
});

test("node-pty stays in the isolated PTY worker and is unpacked for ConPTY", async () => {
  const worker = await read("../electron/pty-worker.mjs");
  const host = await read("../electron/pty-host.js");
  const preload = await read("../electron/preload.js");
  const main = await read("../electron/main.js");
  const builder = await read("../electron-builder.yml");
  assert.match(worker, /require\("node-pty"\)/);
  assert.match(worker, /session\.terminal\.onExit/);
  assert.match(worker, /setImmediate\(\(\) => process\.exit\(0\)\)/);
  assert.match(host, /_waitForChildExit/);
  assert.doesNotMatch(host, /require\("node-pty"\)|from ["']node-pty["']/);
  assert.doesNotMatch(preload, /node-pty/);
  assert.doesNotMatch(main, /require\("node-pty"\)|from ["']node-pty["']/);
  assert.match(builder, /node_modules\/node-pty\/\*\*/);
});
