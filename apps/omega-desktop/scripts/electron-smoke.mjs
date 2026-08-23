import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const releaseDir = process.env.OMEGA_RELEASE_DIR ?? join(process.cwd(), "release", "win-unpacked");
const executable = process.platform === "win32" ? join(releaseDir, "Omega Desktop.exe") : join(releaseDir, "Omega Desktop");
if (!existsSync(executable)) {
  process.stderr.write(`electron smoke: unpacked executable missing: ${executable}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`electron smoke: ${packageJson.version} unpacked executable present\n`);
}
