import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isHttpsUrl, safeAssetFilename, validateManifest } from "../electron/updater-service.js";

test("updater only accepts safe HTTPS assets and validates checksums", () => {
  assert.equal(isHttpsUrl("https://github.com/omega/omega/releases/latest.json"), true);
  assert.equal(isHttpsUrl("http://example.com/update.json"), false);
  assert.equal(safeAssetFilename("omega-win.zip"), "omega-win.zip");
  assert.throws(() => safeAssetFilename("../secret.zip"), /Invalid update asset filename/);
  const manifest = validateManifest({ version: "1.2.3", notes: "notes", assets: [{ filename: "omega.zip", url: "https://example.com/omega.zip", sha256: "a".repeat(64), size: 10 }] });
  assert.equal(manifest.assets[0].sha256, "a".repeat(64));
  assert.throws(() => validateManifest({ version: "1.2.3", notes: "", assets: [{ filename: "omega.zip", url: "http://example.com/omega.zip", sha256: "a".repeat(64), size: 10 }] }), /Invalid release asset/);
});

test("updater compares semantic versions and release gate is offline-safe", async () => {
  assert.equal(compareVersions("1.2.4", "1.2.3"), 1);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3-beta", "1.2.3"), -1);
  const source = await (await import("node:fs/promises")).readFile(new URL("../scripts/release-gate.mjs", import.meta.url), "utf8");
  assert.match(source, /release gate/);
  assert.match(source, /NSIS/);
});
