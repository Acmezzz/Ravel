import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "../electron/updater-service.js";

const root = new URL("./", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", root), "utf8"));
const builder = readFileSync(new URL("../electron-builder.yml", root), "utf8");
if (!packageJson.version || !/^\d+\.\d+\.\d+/.test(packageJson.version)) throw new Error("package version must be semver");
if (/nsis/i.test(builder)) throw new Error("NSIS packaging is disabled for Omega local release");
if (!/target:\s*\n\s*- dir/.test(builder)) throw new Error("Windows unpacked dir target is required");
const manifestPath = process.env.OMEGA_RELEASE_MANIFEST;
if (manifestPath && existsSync(manifestPath)) validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
process.stdout.write("release gate: ok\n");
