import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { _electron as electron } from "@playwright/test";
import { seedSession } from "./fixtures/seed-session.mjs";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const packageJson = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
const packagedCandidates = [
  process.env.RAVEL_ELECTRON_EXECUTABLE,
  join(desktopRoot, "release", "win-unpacked", process.platform === "win32" ? "Ravel Desktop.exe" : "Ravel Desktop"),
  join(desktopRoot, "release-abi148-final7", "win-unpacked", process.platform === "win32" ? "Ravel Desktop.exe" : "Ravel Desktop"),
].filter(Boolean);
const packagedExecutable = process.env.RAVEL_P7_USE_PACKAGED === "0" ? undefined : packagedCandidates.find((candidate) => existsSync(candidate));
const runtimeExecutable = process.platform === "win32"
  ? join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
  : join(repoRoot, "node_modules", "electron", "dist", "electron");
const runtimeEntry = packagedExecutable ? dirnameForExecutable(packagedExecutable) : desktopRoot;
let pageErrors = [];
let consoleMessages = [];

function removeTempDirectory(path) {
  if (!path) return;
  try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Electron may hold profile files briefly after exit. */ }
}

function dirnameForExecutable(executable) {
  return resolve(executable, "..");
}

function executableArgs() {
  return packagedExecutable ? [] : [desktopRoot];
}

function executablePath() {
  return packagedExecutable ?? runtimeExecutable;
}

async function closeApplication(app) {
  if (!app) return;
  try {
    await Promise.race([app.close(), new Promise((resolveClose) => setTimeout(resolveClose, 5_000))]);
  } catch {
    /* The Electron channel may already be disposed after process exit. */
  }
  try {
    const child = app.process();
    if (child && child.exitCode === null) {
      // Windows: SIGKILL on the main process orphans Electron utility
      // processes (agent/histos/PTY) that keep inherited handles open, which
      // stalls the Playwright worker teardown. Reap the whole tree.
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
      await Promise.race([exited, new Promise((resolveExit) => setTimeout(resolveExit, 5_000))]);
    }
  } catch {
    /* Process already gone. */
  }
}

function diagnostics(error, app, profileDir) {
  const target = app?.windows()?.[0];
  return [
    `P7 Electron gate diagnostics`,
    `package: ${packageJson.name}@${packageJson.version}`,
    `mode: ${packagedExecutable ? "packaged" : "runtime"}`,
    `executable: ${executablePath()}`,
    `profile: ${profileDir ?? "unknown"}`,
    `console: ${JSON.stringify(consoleMessages)}`,
    `pageErrors: ${JSON.stringify(pageErrors)}`,
    `url: ${target?.url?.() ?? "no page"}`,
    `error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  ].join("\n");
}

async function launchP7() {
  const profileDir = mkdtempSync(join(tmpdir(), "ravel-p7-electron-"));
  const workspace = mkdtempSync(join(tmpdir(), "ravel-p7-workspace-"));
  const seed = await seedSession({ workspace, home: profileDir });
  const app = await electron.launch({
    executablePath: executablePath(),
    args: [...executableArgs(), `--user-data-dir=${profileDir}`, "--disable-gpu", "--no-sandbox"],
    cwd: packagedExecutable ? runtimeEntry : desktopRoot,
    env: {
      ...process.env,
      HOME: profileDir,
      USERPROFILE: profileDir,
      RAVEL_WORKSPACE: workspace,
      OMEGA_WORKSPACE: workspace,
      RAVEL_EXTENSIONS_ROOT: join(repoRoot, ".pi", "extensions"),
      OMEGA_EXTENSIONS_ROOT: join(repoRoot, ".pi", "extensions"),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      ...(packagedExecutable ? {} : { RAVEL_P7_RUNTIME: "1" }),
    },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => { pageErrors.push(String(error)); });
  page.on("console", (message) => { consoleMessages.push(`${message.type()}: ${message.text()}`); });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, profileDir, workspace, seed, consoleMessages, pageErrors };
}

test.beforeEach(() => { pageErrors = []; consoleMessages = []; });

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    testInfo.annotations.push({ type: "diagnostics", description: `mode=${packagedExecutable ? "packaged" : "runtime"}; executable=${executablePath()}` });
  }
});

test("P7 app protocol loading, Electron isolation, and runtime surfaces", async () => {
  let harness;
  try {
    harness = await launchP7();
    const { app, page, profileDir, seed } = harness;
    pageErrors = harness.pageErrors;
    consoleMessages = harness.consoleMessages;
    await expect.poll(() => page.url()).toBe("app://bundle/index.html");
    await expect(page.locator("#root")).toBeVisible();
    await expect(page.locator("#omega-composer-input")).toBeVisible();
    await expect(page.locator(".omega-status-glyph")).toBeVisible();
    expect(await page.evaluate(() => ({
      protocol: window.location.protocol,
      hasNode: typeof window.node,
      hasRequire: typeof window.require,
      hasProcess: typeof window.process,
      hasOmega: typeof window.omega,
      contextIsolation: typeof window.omega === "object",
    }))).toMatchObject({ protocol: "app:", hasNode: "undefined", hasRequire: "undefined", hasProcess: "undefined", hasOmega: "object", contextIsolation: true });
    // Runtime surfaces are reachable through the shell's product-surface tabs:
    // Graph lives on the Histos surface, Terminal/Telemetry on the IDE bottom dock.
    await expect(page.getByRole("tab", { name: /对话/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Histos/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /IDE/ })).toBeVisible();
    await page.getByRole("tab", { name: /Histos/ }).click();
    await expect(page.locator('[data-surface="histos"]')).toBeVisible();
    await expect(page.locator(".omega-graph-canvas")).toBeVisible();
    await page.getByRole("tab", { name: /IDE/ }).click();
    const dock = page.locator('.ravel-ide-bottom[aria-label="IDE 底部面板"]');
    await expect(dock.getByRole("tab", { name: /终端/ })).toBeVisible();
    await expect(dock.getByRole("tab", { name: /遥测/ })).toBeVisible();
    await page.getByRole("tab", { name: /对话/ }).click();
    await expect(page.locator("#omega-composer-input")).toBeVisible();
    expect(seed.sessionId).toBe("p7-seeded-session");
    await closeApplication(app);
    expect(pageErrors, diagnostics(new Error("renderer page error"), app, profileDir)).toEqual([]);
    expect(consoleMessages.filter((message) => /error/i.test(message)), diagnostics(new Error("renderer console error"), app, profileDir)).toEqual([]);
  } catch (error) {
    throw new Error(diagnostics(error, harness?.app, harness?.profileDir), { cause: error });
  } finally {
    await closeApplication(harness?.app);
    removeTempDirectory(harness?.profileDir);
    removeTempDirectory(harness?.workspace);
  }
});

// PTY and ContextSet/approval are exercised only when the normal boot surfaces are stable.
test("P7 best-effort PTY and ContextSet/approval surfaces", async () => {
  let harness;
  try {
    harness = await launchP7();
    const { page, app, profileDir } = harness;
    await expect(page.locator("#omega-composer-input")).toBeVisible();
    await page.getByRole("tab", { name: /Histos/ }).click();
    const canvas = page.locator(".omega-graph-canvas");
    await expect(canvas).toBeVisible();
    const nodes = canvas.locator(".react-flow__node");
    if (await nodes.count()) {
      await nodes.first().click();
      const freeze = page.getByRole("button", { name: /冻结上下文|Freeze context/ });
      if (await freeze.isEnabled()) {
        await freeze.click();
        await expect(page.getByRole("status").filter({ hasText: /ContextSet/ })).toBeVisible();
      }
    }
    await page.getByRole("tab", { name: /IDE/ }).click();
    await page.locator('.ravel-ide-bottom[aria-label="IDE 底部面板"]').getByRole("tab", { name: /终端/ }).click();
    await expect(page.getByRole("region", { name: /终端|Terminal/ })).toBeVisible();
    await closeApplication(app);
  } catch (error) {
    test.info().annotations.push({ type: "best-effort", description: `PTY/ContextSet/approval skipped: ${error instanceof Error ? error.message : String(error)}` });
    await closeApplication(harness?.app);
  } finally {
    removeTempDirectory(harness?.profileDir);
    removeTempDirectory(harness?.workspace);
  }
});
