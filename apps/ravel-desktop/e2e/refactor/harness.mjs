/**
 * 任务十 e2e 验收共享 harness。
 *
 * 与 e2e/p7.electron.spec.mjs 完全同源的 launch 基建：electron.launch 参数、
 * env、cwd（含 --user-data-dir、--disable-gpu、--no-sandbox、
 * RAVEL_WORKSPACE/OMEGA_WORKSPACE、RAVEL_EXTENSIONS_ROOT/OMEGA_EXTENSIONS_ROOT、
 * RAVEL_P7_RUNTIME）保持一致；复用 P7 seed 会话生成器。
 *
 * 四个 refactor spec 均 import 此处 helper，避免复制三份 Electron 启动样板。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { _electron as electron } from "@playwright/test";
import { seedSession } from "../fixtures/seed-session.mjs";

// harness 位于 e2e/refactor/，向上两级才是 apps/ravel-desktop。
export const desktopRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const repoRoot = resolve(desktopRoot, "../..");
export const packageJson = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));

const packagedCandidates = [
  process.env.RAVEL_ELECTRON_EXECUTABLE,
  join(desktopRoot, "release", "win-unpacked", process.platform === "win32" ? "Ravel Desktop.exe" : "Ravel Desktop"),
  join(desktopRoot, "release-abi148-final7", "win-unpacked", process.platform === "win32" ? "Ravel Desktop.exe" : "Ravel Desktop"),
].filter(Boolean);
// 重构 surface（RavelShell / data-surface-* / ShellSurfaceTabs）只存在于最近构建的
// runtime bundle（apps/ravel-desktop/index.html + dist/assets/index.js）。仓库中的
// release/ 打包产物是旧版（无 data-surface-*）。因此 refactor spec 默认强制 runtime
// 模式，仅当显式设 RAVEL_P7_USE_PACKAGED=1 时才走打包产物。
export const packagedExecutable =
  process.env.RAVEL_P7_USE_PACKAGED === "1" ? packagedCandidates.find((candidate) => existsSync(candidate)) : undefined;
const runtimeExecutable =
  process.platform === "win32"
    ? join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
    : join(repoRoot, "node_modules", "electron", "dist", "electron");
const runtimeEntry = packagedExecutable ? dirnameForExecutable(packagedExecutable) : desktopRoot;

function dirnameForExecutable(executable) {
  return resolve(executable, "..");
}

export function runningMode() {
  return packagedExecutable ? "packaged" : "runtime";
}

export function executablePath() {
  return packagedExecutable ?? runtimeExecutable;
}

export function executableArgs() {
  return packagedExecutable ? [] : [desktopRoot];
}

export function removeTempDirectory(path) {
  if (!path) return;
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* Electron may hold profile files briefly after exit. */
  }
}

export async function closeApplication(app) {
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

export function diagnostics(error, h) {
  const target = h?.app?.windows()?.[0];
  return [
    `Ravel refactor e2e diagnostics`,
    `package: ${packageJson.name}@${packageJson.version}`,
    `mode: ${runningMode()}`,
    `executable: ${executablePath()}`,
    `profile: ${h?.profileDir ?? "unknown"}`,
    `console: ${JSON.stringify(h?.consoleMessages ?? [])}`,
    `pageErrors: ${JSON.stringify(h?.pageErrors ?? [])}`,
    `url: ${target?.url?.() ?? "no page"}`,
    `error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  ].join("\n");
}

/** P7-identical Electron launch（含 seed 会话 / 隔离 HOME / workspace）。 */
export async function launchRavel() {
  const profileDir = mkdtempSync(join(tmpdir(), "ravel-refactor-electron-"));
  const workspace = mkdtempSync(join(tmpdir(), "ravel-refactor-workspace-"));
  const seed = await seedSession({ workspace, home: profileDir });
  const consoleMessages = [];
  const pageErrors = [];
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
  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });
  page.on("console", (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, profileDir, workspace, seed, consoleMessages, pageErrors };
}

/** 输出诊断并抛错（参照 p7 的 diagnostics 用法）。 */
export function failWithDiagnostics(message, h) {
  throw new Error(diagnostics(new Error(message), h));
}