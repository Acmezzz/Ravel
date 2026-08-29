import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * 打包后的 Renderer 走自定义 `app://` 协议，不是 secure context。
 *
 * 曾经 IDE 终端在 effect 里直接调用 `crypto.randomUUID()`，打包版一打开 IDE 就抛
 * `crypto.randomUUID is not a function`，React 卸载整棵树 → 白屏。这里锁住三件事：
 * Renderer 不直接使用 secure-context-only API、崩溃被 SurfaceBoundary 兜住、
 * Histos 的响应式覆盖必须排在基础规则之后（否则永远不生效）。
 */

const root = resolve(import.meta.dirname, "..");
const rendererRoot = join(root, "src", "renderer");

async function collectSources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSources(path)));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

test("renderer avoids secure-context-only crypto APIs", async () => {
  const offenders = [];
  for (const path of await collectSources(rendererRoot)) {
    // lib/uid.ts is the single sanctioned wrapper around the secure-context API.
    if (path.endsWith(join("lib", "uid.ts"))) continue;
    const source = await readFile(path, "utf8");
    if (/crypto\.randomUUID/.test(source)) offenders.push(path.slice(rendererRoot.length + 1));
  }
  assert.deepEqual(offenders, [], "use lib/uid.ts createId() instead of crypto.randomUUID");

  const terminal = await readFile(join(rendererRoot, "components", "panels", "TerminalPanel.tsx"), "utf8");
  assert.match(terminal, /import \{ createId \} from "\.\.\/\.\.\/lib\/uid"/);
  assert.match(terminal, /createId\("terminal"\)/);

  const uid = await readFile(join(rendererRoot, "lib", "uid.ts"), "utf8");
  assert.match(uid, /getRandomValues/, "must fall back to getRandomValues outside a secure context");
});

test("surface crashes degrade to a recoverable card", async () => {
  const shell = await readFile(join(rendererRoot, "shell", "RavelShell.tsx"), "utf8");
  assert.match(shell, /<SurfaceBoundary resetKey=\{surfaceMode\}>/);
  assert.match(shell, /<SurfaceRouter \/>/);

  const boundary = await readFile(join(rendererRoot, "shell", "SurfaceBoundary.tsx"), "utf8");
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /ravel-surface-error/);
  // Switching surface remounts a clean tree instead of staying blank.
  assert.match(boundary, /prev\.resetKey !== this\.props\.resetKey/);
});

test("app scheme is privileged so renderer workers can be constructed", async () => {
  const protocol = await readFile(join(root, "electron", "app-protocol.js"), "utf8");
  const main = await readFile(join(root, "electron", "main.js"), "utf8");

  assert.match(protocol, /export function registerAppSchemePrivileges/);
  assert.match(protocol, /standard: true/);
  assert.match(protocol, /secure: true/);
  // Without `standard` the origin stays opaque and `new Worker(...)` throws
  // SecurityError, which is what killed the Histos surface.
  assert.match(main, /registerAppSchemePrivileges\(protocol\)/);
  assert.ok(
    main.indexOf("registerAppSchemePrivileges(protocol)") < main.indexOf("app\n  .whenReady()"),
    "scheme privileges must be registered before app.whenReady()",
  );
});

test("histos responsive rules come after the base layout rules", async () => {
  const css = await readFile(join(rendererRoot, "styles", "global.css"), "utf8");
  const base = css.indexOf(".ravel-histos-main {");
  const override = css.indexOf("@media (max-width: 1120px)");
  assert.notEqual(base, -1, "base .ravel-histos-main rule missing");
  assert.notEqual(override, -1, "narrow-window override missing");
  assert.ok(base < override, "override must follow the base rule or it can never win");

  // Inspector lives to the right of the canvas: the base rule is a two-column grid.
  const baseRule = css.slice(base, css.indexOf("}", base));
  assert.match(baseRule, /display: grid/);
  assert.match(baseRule, /grid-template-columns: minmax\(0, 1fr\) minmax\(280px, 330px\)/);
});
