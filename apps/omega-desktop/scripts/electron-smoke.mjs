import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const releaseDir = resolve(process.env.OMEGA_RELEASE_DIR ?? join(process.cwd(), "release", "win-unpacked"));
const executable = process.platform === "win32" ? join(releaseDir, "Omega Desktop.exe") : join(releaseDir, "Omega Desktop");
const runtimeRoot = join(releaseDir, "resources", "omega-runtime");
const timeoutMs = Number(process.env.OMEGA_SMOKE_TIMEOUT_MS ?? 45_000);

const required = [
  executable,
  join(runtimeRoot, "packages", "coding-agent", "dist"),
  join(runtimeRoot, ".pi", "extensions"),
];
const missing = required.filter((path) => !existsSync(path));

const requiredSignals = [
  "[main] agent worker ready",
  "[main] domprobe ",
  "[main] autotest done, quitting",
];

function runAttempt(attempt) {
  const userDataDir = mkdtempSync(join(tmpdir(), `omega-electron-smoke-${attempt}-`));
  const args = [`--user-data-dir=${userDataDir}`];
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

  return new Promise((resolveAttempt) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;

    const finish = (code, signal, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const missingSignals = requiredSignals.filter((signalText) => !stdout.includes(signalText));
      resolveAttempt({ attempt, code, signal, timedOut, stdout, stderr, missingSignals, userDataDir });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      stderr += `spawn error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
      finish(1, null);
    });
    child.once("close", (code, signal) => finish(code, signal));

    timer = setTimeout(() => {
      stderr += `smoke timeout after ${timeoutMs}ms\n`;
      child.kill();
      setTimeout(() => finish(1, "timeout", true), 1_000);
    }, timeoutMs);
  });
}

function diagnostics(result) {
  return [
    `electron smoke: ${packageJson.version}`,
    `attempt: ${result.attempt}`,
    `executable: ${executable}`,
    `exitCode: ${result.code ?? "null"}`,
    `signal: ${result.signal ?? "null"}`,
    `stdout:\n${result.stdout.slice(-12_000)}`,
    `stderr:\n${result.stderr.slice(-12_000)}`,
  ].join("\n");
}

async function main() {
  if (missing.length > 0) {
    process.stderr.write(`electron smoke: required packaged resources missing:\n${missing.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  let result = await runAttempt(1);
  rmSync(result.userDataDir, { recursive: true, force: true });
  const passed = result.code === 0 && result.missingSignals.length === 0;
  if (!passed && result.code === 0 && result.stdout.trim() === "" && !result.stderr.trim()) {
    result = await runAttempt(2);
    rmSync(result.userDataDir, { recursive: true, force: true });
  }

  const finalPassed = result.code === 0 && result.missingSignals.length === 0;
  if (!finalPassed) {
    process.stderr.write(`${diagnostics(result)}\nmissing signals: ${result.missingSignals.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${diagnostics(result)}\nelectron smoke: worker handshake, DOM probe, and clean exit passed\n`);
}

void main();
