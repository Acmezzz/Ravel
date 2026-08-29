import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/renderer/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("terminal renderer surface owns an xterm-backed PTY lifecycle", async () => {
  const panel = await read("components/panels/TerminalPanel.tsx");
  const right = await read("components/layout/RightPanel.tsx");
  assert.match(panel, /@xterm\/xterm/);
  assert.match(panel, /FitAddon/);
  assert.match(panel, /ptyCreate/);
  assert.match(panel, /ptyWrite/);
  assert.match(panel, /ptyResize/);
  assert.match(panel, /ptyKill/);
  assert.match(panel, /onPtyData/);
  assert.match(panel, /onPtyExit/);
  assert.match(panel, /ResizeObserver/);
  assert.match(panel, /crypto\.randomUUID/);
  assert.match(panel, /agent\?\.cwd/);
  assert.doesNotMatch(panel, /useAppStore\.setState|set\(.*output|terminalOutput/);
  assert.match(right, /value="terminal"/);
  assert.match(right, /rightTab === "terminal"/);
  // The rightTab union + default moved into the chrome slice when the store was
  // split; assert against the file that now owns that state shape.
  const chrome = await read("store/slices/chromeSlice.ts");
  assert.match(chrome, /rightTab: .*"terminal"/);
  assert.match(chrome, /rightTab: "diff",/);
});
