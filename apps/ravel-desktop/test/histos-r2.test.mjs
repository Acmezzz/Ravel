import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const dialogSurfaces = [
  "../src/renderer/components/layout/SettingsDialog.tsx",
  "../src/renderer/components/layout/ResourceCenter.tsx",
  "../src/renderer/components/layout/TrustCenter.tsx",
  "../src/renderer/components/layout/ProjectTrustDialog.tsx",
];

const railSurfaces = [
  "../src/renderer/components/layout/LeftNav.tsx",
  "../src/renderer/components/layout/RightPanel.tsx",
];

const chromeSurfaces = [
  "../src/renderer/components/panels/ApprovalBar.tsx",
  "../src/renderer/components/chat/Composer.tsx",
  "../src/renderer/components/layout/Header.tsx",
];

const chatCardSurfaces = [
  "../src/renderer/components/chat/MessageBubble.tsx",
  "../src/renderer/components/chat/ToolCard.tsx",
  "../src/renderer/components/chat/ThinkingBlock.tsx",
];

const diffFileSurfaces = [
  "../src/renderer/components/panels/DiffViewer.tsx",
  "../src/renderer/components/files/FileTree.tsx",
];

test("R2 migrated settings/resource/trust surfaces have no MUI", async () => {
  for (const path of dialogSurfaces) {
    const source = await read(path);
    assert.doesNotMatch(source, /@mui\//, `${path} still imports MUI`);
    assert.doesNotMatch(source, /\bsx=\{/, `${path} still uses MUI sx`);
    assert.match(source, /from ["'](?:\.\.\/)+ui\/Dialog["']/, `${path} must use the local Dialog`);
  }
});

test("R2 migrated LeftNav/RightPanel have no MUI", async () => {
  for (const path of railSurfaces) {
    const source = await read(path);
    assert.doesNotMatch(source, /@mui\//, `${path} still imports MUI`);
    assert.doesNotMatch(source, /\bsx=\{/, `${path} still uses MUI sx`);
    assert.match(source, /from ["'](?:\.\.\/)+ui\/Tabs["']/, `${path} must use the local Tabs`);
    assert.match(source, /from ["'](?:\.\.\/)+ui\/Tooltip["']/, `${path} must use the local Tooltip`);
  }
});

test("LeftNav keeps session/activity/files/search contracts", async () => {
  const left = await read("../src/renderer/components/layout/LeftNav.tsx");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(left, /id="omega-left-nav"/);
  assert.match(left, /attentionCount/);
  assert.match(left, /NewSessionDialog/);
  assert.match(left, /nav\.collapseLeft/);
  assert.match(left, /nav\.tab\.sessions/);
  assert.match(left, /nav\.tab\.activity/);
  assert.match(left, /nav\.tab\.files/);
  assert.match(left, /nav\.tab\.search/);
  assert.match(left, /omega-attention-dot/);
  assert.match(left, /toggleLeftPanel/);
  assert.match(css, /\.omega-rail /);
  assert.match(css, /\.omega-attention-dot::after/);
});

test("R2 migrated Composer/ApprovalBar/Header have no MUI", async () => {
  for (const path of chromeSurfaces) {
    const source = await read(path);
    assert.doesNotMatch(source, /@mui\//, `${path} still imports MUI`);
    assert.doesNotMatch(source, /\bsx=\{/, `${path} still uses MUI sx`);
  }
  const approval = await read("../src/renderer/components/panels/ApprovalBar.tsx");
  const composer = await read("../src/renderer/components/chat/Composer.tsx");
  const header = await read("../src/renderer/components/layout/Header.tsx");
  assert.match(approval, /from ["'](?:\.\.\/)+ui\/Dialog["']/);
  assert.match(composer, /from ["'](?:\.\.\/)+ui\/Tooltip["']/);
  assert.match(header, /from ["'](?:\.\.\/)+ui\/Tooltip["']/);
  assert.match(header, /from ["'](?:\.\.\/)+ui\/Popover["']/);
});

test("ApprovalBar keeps fail-closed reject confirmation", async () => {
  const approval = await read("../src/renderer/components/panels/ApprovalBar.tsx");
  assert.match(approval, /action: "accept"/);
  assert.match(approval, /action: "reject"/);
  assert.match(approval, /selectedItems, snapshotToken/);
  assert.match(approval, /role="alert"/);
  assert.match(approval, /git clean/);
});

test("Composer keeps send, IME, queue, and mention contracts", async () => {
  const composer = await read("../src/renderer/components/chat/Composer.tsx");
  assert.match(composer, /clientMessageId/);
  assert.match(composer, /sendingRef/);
  assert.match(composer, /lastAgentStartAt/);
  assert.match(composer, /dropLastIfOptimistic/);
  assert.match(composer, /keyCode === 229/);
  assert.match(composer, /COMPOSITION_END_ENTER_GRACE_MS/);
  assert.match(composer, /onCompositionStart/);
  assert.match(composer, /queuedMessages/);
  assert.match(composer, /clearQueue/);
  assert.match(composer, /detectAtToken/);
  assert.match(composer, /startsWith\("!"/);
  assert.match(composer, /composer\.sendAria/);
  assert.match(composer, /composer\.stopAria/);
  assert.match(composer, /AttachFile/);
  assert.match(composer, /onDelete/);
});

test("R2 migrated DiffViewer/FileTree have no MUI", async () => {
  for (const path of diffFileSurfaces) {
    const source = await read(path);
    assert.doesNotMatch(source, /@mui\//, `${path} still imports MUI`);
    assert.doesNotMatch(source, /\bsx=\{/, `${path} still uses MUI sx`);
  }
  const diff = await read("../src/renderer/components/panels/DiffViewer.tsx");
  const tree = await read("../src/renderer/components/files/FileTree.tsx");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(diff, /MAX_RENDERED_FILES/);
  assert.match(diff, /MAX_RENDERED_LINES_PER_HUNK/);
  assert.match(diff, /stopPropagation/);
  assert.match(diff, /aria-label.*hunk/);
  assert.match(tree, /role="alert"/);
  assert.match(tree, /void loadDir\(rel\)/);
  assert.match(tree, /requestEpochRef/);
  assert.match(css, /\.omega-diff-viewer/);
  assert.match(css, /\.omega-file-tree/);
});

test("R2 migrated MessageBubble/ToolCard/ThinkingBlock have no MUI", async () => {
  for (const path of chatCardSurfaces) {
    const source = await read(path);
    assert.doesNotMatch(source, /@mui\//, `${path} still imports MUI`);
    assert.doesNotMatch(source, /\bsx=\{/, `${path} still uses MUI sx`);
  }
  const bubble = await read("../src/renderer/components/chat/MessageBubble.tsx");
  const tool = await read("../src/renderer/components/chat/ToolCard.tsx");
  const thinking = await read("../src/renderer/components/chat/ThinkingBlock.tsx");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(bubble, /from ["'](?:\.\.\/)+ui\/Tooltip["']/);
  assert.match(bubble, /ipc\.fork/);
  assert.match(bubble, /msg-actions/);
  assert.match(tool, /getToolDetail/);
  assert.match(tool, /\(detail\?\.resultText \?\? card\.resultText\) \?/);
  assert.match(tool, /\(detail\?\.argsJson \?\? card\.argsJson\) \?/);
  assert.match(thinking, /getThinking/);
  assert.match(thinking, /thinkingCache/);
  assert.match(css, /\.omega-msg /);
  assert.match(css, /\.omega-toolcard /);
  assert.match(css, /\.omega-thinking /);
});

test("Header keeps StatusGlyph priority and theme origin", async () => {
  const header = await read("../src/renderer/components/layout/Header.tsx");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(header, /INFINITY_PATH/);
  assert.match(header, /clamped >= 85/);
  assert.match(header, /clamped >= 65/);
  assert.match(header, /"aria-label": "重试 Agent worker"/);
  assert.match(header, /aria-pressed=\{agent\?\.thinkingLevel === level\}/);
  assert.match(header, /setThemeMode/);
  assert.match(header, /retryWorker/);
  assert.match(css, /\.omega-header /);
  assert.match(css, /\.omega-status-glyph/);
  assert.doesNotMatch(css, /\.MuiToolbar-root/);
});

test("RightPanel keeps Diff default and collapse contracts", async () => {
  const right = await read("../src/renderer/components/layout/RightPanel.tsx");
  assert.match(right, /id="omega-right-panel"/);
  assert.match(right, /nav\.tab\.diff/);
  assert.match(right, /nav\.tab\.worktree/);
  assert.match(right, /nav\.tab\.telemetry/);
  assert.match(right, /nav\.tab\.snapshots/);
  assert.match(right, /setRightTab/);
  assert.match(right, /toggleRightPanel/);
  assert.match(right, /<DiffViewer/);
  assert.match(right, /omega-rail-body-clip/);
});

test("SettingsDialog keeps IPC, i18n, and validation contracts", async () => {
  const settings = await read("../src/renderer/components/layout/SettingsDialog.tsx");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(settings, /updateSettings/);
  assert.match(settings, /updateDesktopSettings/);
  assert.match(settings, /setPermissionProfile/);
  assert.match(settings, /listResources/);
  assert.match(settings, /onBlur=\{\(\) => void applyDesktopPatch\(\{ keybindings \}\)\}/);
  assert.match(settings, /cap < 1 \|\| cap > 8/);
  assert.match(settings, /minutes < 1 \|\| minutes > 60/);
  assert.match(settings, /settings\.untrustedProject/);
  assert.match(settings, /setModelCenterOpen/);
  assert.match(settings, /setResourceCenterOpen/);
  assert.match(settings, /setTrustCenterOpen/);
  assert.match(settings, /<Tabs /);
  assert.match(settings, /<Switch /);
  assert.match(css, /\.omega-settings-grid/);
  assert.match(css, /\.omega-success-text/);
});

test("R2 chrome stays isolated from runtime storage and upgrade gates", async () => {
  const pkg = await read("../package.json");
  const settings = await read("../src/renderer/components/layout/SettingsDialog.tsx");
  assert.doesNotMatch(pkg, /"vite":\s*"8\./);
  assert.match(pkg, /@xyflow\/react/);
  assert.match(pkg, /elkjs/);
  assert.doesNotMatch(pkg, /better-sqlite3/);
  assert.doesNotMatch(settings, /node:sqlite/);
  assert.doesNotMatch(settings, /FactAddress/);
});
