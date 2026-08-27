import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function readSource(path) {
  return readFile(resolve(root, "src", "renderer", ...path.split("/")), "utf8");
}

test("P1 font stacks carry CJK fallbacks through tokens", async () => {
  const css = await readFile(resolve(root, "src", "renderer", "styles", "global.css"), "utf8");
  assert.match(css, /--omega-font-sans:[^;]*"PingFang SC"[^;]*"Microsoft YaHei"[^;]*"Noto Sans CJK SC"[^;]*sans-serif/);
  assert.match(css, /--omega-font-mono:[^;]*"JetBrains Mono"[^;]*monospace/);
  // Inline stacks are gone: body and mono rules must resolve through the tokens.
  assert.match(css, /font: 0\.875rem\/1\.6 var\(--omega-font-sans\);/);
  assert.equal(css.match(/font-family: ui-monospace/g), null);
  assert.doesNotMatch(css, /"Segoe UI", sans-serif;/);
});

test("P1 ships lucide-react as the icon library for control glyphs", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.match(pkg.dependencies["lucide-react"], /^\d+\.\d+\.\d+$/);
  const header = await readSource("components/layout/Header.tsx");
  const composer = await readSource("components/chat/Composer.tsx");
  const toolCard = await readSource("components/chat/ToolCard.tsx");
  assert.match(header, /from "lucide-react"/);
  assert.match(composer, /from "lucide-react"/);
  assert.match(toolCard, /from "lucide-react"/);
  // Brand instruments (∞ status glyph, context donut) stay hand-drawn.
  assert.match(header, /INFINITY_PATH/);
  assert.match(header, /<svg width="24" height="24" viewBox="0 0 24 24">/);
  // No hand-written control-icon svg paths remain in migrated surfaces.
  const workbench = await readSource("components/layout/Workbench.tsx");
  const sessionList = await readSource("components/sessions/SessionList.tsx");
  assert.doesNotMatch(workbench, /<svg viewBox="0 0 24 24" width="20"/);
  assert.doesNotMatch(sessionList, /<svg viewBox="0 0 16 16" className="omega-session-icon"/);
});
