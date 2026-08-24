import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const releaseDir = resolve(process.env.OMEGA_RELEASE_DIR ?? join(process.cwd(), "release", "win-unpacked"));
const executable = process.platform === "win32" ? join(releaseDir, "Omega Desktop.exe") : join(releaseDir, "Omega Desktop");
const runtimeRoot = join(releaseDir, "resources", "omega-runtime");
const timeoutMs = Number(process.env.OMEGA_SMOKE_TIMEOUT_MS ?? 45_000);
const userDataDir = mkdtempSync(join(tmpdir(), "omega-electron-smoke-"));

const required = [
  executable,
  join(runtimeRoot, "packages", "coding-agent", "dist"),
  join(runtimeRoot, ".pi", "extensions"),
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  rmSync(userDataDir, { recursive: true, force: true });
  process.stderr.write(`electron smoke: required packaged resources missing:\n${missing.join("\n")}\n`);
  process.exitCode = 1;
} else {
  const args = ["--user-data-dir", userDataDir];
  const child = spawn(executable, args, {
    cwd: releaseDir,
    env: {
      ...process.env,
      OMEGA_AUTOTEST: "1",
      OMEGA_DOMPROBE: "1",
      OMEGA_WORKSPACE: releaseDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  let settled = false;
  let timer;

  const finish = (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const requiredSignals = [
      "[main] agent worker ready",
      "[main] domprobe ",
      "[main] autotest done, quitting",
    ];
    const missingSignals = requiredSignals.filter((signalText) => !stdout.includes(signalText));
    const diagnostics = [
      `electron smoke: ${packageJson.version}`,
      `executable: ${executable}`,
      `exitCode: ${code ?? "null"}`,
      `signal: ${signal ?? "null"}`,
      `stdout:\n${stdout.slice(-12_000)}`,
      `stderr:\n${stderr.slice(-12_000)}`,
    ].join("\n");
    if (code !== 0 || missingSignals.length > 0) {
      process.stderr.write(`${diagnostics}\nmissing signals: ${missingSignals.join(", ")}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${diagnostics}\nelectron smoke: worker handshake, DOM probe, and clean exit passed\n`);
    }
    rmSync(userDataDir, { recursive: true, force: true });
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", (error) => {
    stderr += `spawn error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
    finish(1, null);
  });
  child.once("close", finish);

  timer = setTimeout(() => {
    stderr += `smoke timeout after ${timeoutMs}ms\n`;
    child.kill();
    setTimeout(() => finish(1, "timeout"), 1_000);
  }, timeoutMs);
}
