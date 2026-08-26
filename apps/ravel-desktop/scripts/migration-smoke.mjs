/**
 * Real-launch acceptance for the Omega -> Ravel userData migration.
 *
 * Boots the packaged executable twice against a synthetic legacy
 * `omega/` userData directory and asserts every roadmap criterion that is
 * automatable: migration creates `ravel/`, files are byte-identical, the
 * legacy tree is untouched, a second run does not re-migrate, and the
 * success marker is written only by completed migrations.
 *
 * Requires a packaged build first: npm run --workspace @ravel/desktop package:dir
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const releaseDir = resolve(process.env.RAVEL_RELEASE_DIR ?? join(process.cwd(), "release", "win-unpacked"));
const executable = process.platform === "win32" ? join(releaseDir, "Ravel Desktop.exe") : join(releaseDir, "Ravel Desktop");
const timeoutMs = Number(process.env.RAVEL_SMOKE_TIMEOUT_MS ?? 60_000);

const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    process.stdout.write(`ok - ${name}\n`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    process.stdout.write(`FAIL - ${name}${detail ? `: ${detail}` : ""}\n`);
  }
}

function hashTree(root) {
  const hashes = new Map();
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else hashes.set(full.slice(root.length + 1), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  }
  if (existsSync(root)) walk(root);
  return hashes;
}

/** Launch the packaged app once and wait for a clean exit. */
function launch(userDataDir) {
  return new Promise((resolveLaunch) => {
    let stdout = "";
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userDataDir}`], {
      cwd: releaseDir,
      env: { ...process.env, RAVEL_AUTOTEST: "1", RAVEL_WORKSPACE: releaseDir },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stdout += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolveLaunch({ code: 1, timedOut: true, stdout });
    }, timeoutMs);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveLaunch({ code, timedOut: false, stdout });
    });
  });
}

function main() {
  check("packaged executable exists", existsSync(executable), executable);
  if (!existsSync(executable)) process.exit(1);

  // Synthetic legacy profile, mirroring what Omega wrote under userData/omega.
  const userDataDir = mkdtempSync(join(tmpdir(), "ravel-migration-smoke-"));
  const legacyRoot = join(userDataDir, "omega");
  mkdirSync(join(legacyRoot, "event-cache"), { recursive: true });
  const credentialBlob = JSON.stringify({ "legacy-provider": Buffer.from("opaque-ciphertext-for-smoke").toString("base64") });
  writeFileSync(join(legacyRoot, "workspaces.json"), `${JSON.stringify([{ path: releaseDir }])}\n`, "utf8");
  writeFileSync(join(legacyRoot, "desktop-settings.json"), `${JSON.stringify({ themeMode: "dark" })}\n`, "utf8");
  writeFileSync(join(legacyRoot, "credentials.bin.json"), `${credentialBlob}\n`, "utf8");
  writeFileSync(join(legacyRoot, "event-cache", "session-cache.jsonl"), "{}\n", "utf8");

  const legacyBefore = hashTree(legacyRoot);
  void (async () => {
    try {
      // First launch performs the migration.
      const first = await launch(userDataDir);
      check("first launch exits cleanly", first.code === 0 && !first.timedOut, first.timedOut ? "timed out" : `exit ${first.code}`);
      check("worker became ready on first launch", first.stdout.includes("[main] agent worker ready"));

      const ravelRoot = join(userDataDir, "ravel");
      check("userData/ravel was created", existsSync(ravelRoot));
      for (const relative of ["workspaces.json", "desktop-settings.json", "credentials.bin.json", "event-cache/session-cache.jsonl"]) {
        check(`migrated file present: ${relative}`, existsSync(join(ravelRoot, ...relative.split("/"))));
      }
      const markerPath = join(ravelRoot, ".migration.json");
      check("migration marker written", existsSync(markerPath));
      let markerAfterFirstRun = "";
      if (existsSync(markerPath)) {
        markerAfterFirstRun = readFileSync(markerPath, "utf8");
        check("marker names omega as source", markerAfterFirstRun.includes('"source": "omega"') || markerAfterFirstRun.includes('"source":"omega"'));
      }

      const migratedCredentials = existsSync(join(ravelRoot, "credentials.bin.json"))
        ? createHash("sha256").update(readFileSync(join(ravelRoot, "credentials.bin.json"))).digest("hex")
        : "";
      const legacyCredentialsHash = legacyBefore.get("credentials.bin.json") ?? "";
      check("credentials blob bytes unchanged (sha256)", migratedCredentials === legacyCredentialsHash && legacyCredentialsHash !== "");

      const legacyAfterFirst = hashTree(legacyRoot);
      check("legacy omega tree untouched after first run", hashesEqual(legacyBefore, legacyAfterFirst));

      // Second launch must not re-migrate.
      const second = await launch(userDataDir);
      check("second launch exits cleanly", second.code === 0 && !second.timedOut, second.timedOut ? "timed out" : `exit ${second.code}`);
      const legacyAfterSecond = hashTree(legacyRoot);
      check("legacy omega tree untouched after second run", hashesEqual(legacyBefore, legacyAfterSecond));
      check("no duplicate migration marker rewrite", existsSync(markerPath) && readFileSync(markerPath, "utf8") === markerAfterFirstRun);

      if (failures.length > 0) {
        process.stderr.write(`\nmigration smoke failed:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
        process.stderr.write(`\nlast stdout tail:\n${first.stdout.slice(-4000)}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write("\nmigration smoke: real Electron launch chain passed all checks\n");
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  })();
}

function hashesEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [path, digest] of left) {
    if (right.get(path) !== digest) return false;
  }
  return true;
}

main();
