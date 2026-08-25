import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateOmegaUserData } from "../electron/data-migration.js";

test("migrates Omega desktop data without changing the encrypted credential blob", () => {
  const root = mkdtempSync(join(tmpdir(), "ravel-migration-"));
  try {
    const legacy = join(root, "omega");
    mkdirSync(join(legacy, "event-cache"), { recursive: true });
    writeFileSync(join(legacy, "workspaces.json"), "[]");
    writeFileSync(join(legacy, "credentials.bin.json"), "encrypted-blob");
    writeFileSync(join(legacy, "event-cache", "session.jsonl"), "{}\n");

    const result = migrateOmegaUserData(root);
    const target = join(root, "ravel");
    assert.equal(result.migrated, true);
    assert.equal(readFileSync(join(target, "credentials.bin.json"), "utf8"), "encrypted-blob");
    assert.equal(existsSync(join(target, "event-cache", "session.jsonl")), true);
    assert.equal(existsSync(join(legacy, "credentials.bin.json")), true);
    assert.equal(JSON.parse(readFileSync(join(target, ".migration.json"), "utf8")).source, "omega");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not overwrite an existing Ravel data directory", () => {
  const root = mkdtempSync(join(tmpdir(), "ravel-migration-existing-"));
  try {
    mkdirSync(join(root, "omega"), { recursive: true });
    mkdirSync(join(root, "ravel"), { recursive: true });
    writeFileSync(join(root, "ravel", "desktop-settings.json"), "ravel");
    const result = migrateOmegaUserData(root);
    assert.equal(result.migrated, false);
    assert.equal(readFileSync(join(root, "ravel", "desktop-settings.json"), "utf8"), "ravel");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
