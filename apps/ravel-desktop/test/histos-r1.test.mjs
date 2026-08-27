import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("R1 keeps the single-file IIFE, CSP, and compiler build contract", async () => {
  const vite = await read("../vite.config.ts");
  const html = await read("../index.html");
  const postcss = await read("../postcss.config.js");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(vite, /format:\s*["']iife["']/);
  assert.match(vite, /codeSplitting:\s*false/);
  assert.doesNotMatch(vite, /inlineDynamicImports/);
  assert.match(vite, /modulePreload:\s*false/);
  assert.match(vite, /babel-plugin-react-compiler/);
  assert.match(vite, /target:\s*["']19["']/);
  assert.match(postcss, /@tailwindcss\/postcss/);
  assert.match(css, /@import ["']tailwindcss["']/);
  assert.match(css, /@theme\s*\{/);
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  assert.ok(csp, "CSP meta tag is present");
  assert.match(csp[1], /script-src 'self'/);
  assert.match(csp[1], /style-src 'self' app:(?:;|')/);
  assert.doesNotMatch(csp[1], /nonce-/);
  assert.doesNotMatch(csp[1], /unsafe-inline/);
  assert.doesNotMatch(csp[1], /unsafe-eval/);
});

test("R1 headless primitives use static classes and preserve ModelPicker behavior", async () => {
  const popover = await read("../src/renderer/ui/Popover.tsx");
  const button = await read("../src/renderer/ui/Button.tsx");
  const textField = await read("../src/renderer/ui/TextField.tsx");
  const picker = await read("../src/renderer/components/layout/ModelPicker.tsx");
  const empty = await read("../src/renderer/components/chat/EmptyState.tsx");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(popover, /anchor=\{anchor\}/);
  assert.match(popover, /onOpenChange/);
  assert.match(popover, /omega-popover/);
  assert.match(button, /omega-button/);
  assert.match(textField, /omega-input/);
  assert.match(picker, /<Popover/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /aria-activedescendant/);
  assert.match(picker, /modelSwitchToken/);
  assert.match(empty, /omega-empty-suggestion/);
  assert.match(css, /\.omega-popover/);
  assert.match(css, /\.omega-button/);
});

test("R1 keeps the Header status thresholds and CSS-variable resize hot path", async () => {
  const header = await read("../src/renderer/components/layout/Header.tsx");
  const workbench = await read("../src/renderer/components/layout/Workbench.tsx");
  const resize = await read("../src/renderer/components/layout/PanelResizeHandle.tsx");
  const palettes = await read("../src/renderer/theme/palettes.ts");
  const css = await read("../src/renderer/styles/global.css");
  assert.match(header, /clamped >= 85/);
  assert.match(header, /clamped >= 65/);
  assert.match(header, /INFINITY_PATH/);
  assert.match(workbench, /--omega-left-panel-width/);
  assert.match(workbench, /--omega-right-panel-width/);
  assert.match(workbench, /draggingRef/);
  assert.match(workbench, /ravel-panel-widths/);
  assert.match(resize, /lostpointercapture/);
  assert.match(resize, /aria-valuenow/);
  assert.match(resize, /Home/);
  assert.match(resize, /End/);
  assert.match(palettes, /prefers-reduced-motion/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /omega-ring-spin/);
});
