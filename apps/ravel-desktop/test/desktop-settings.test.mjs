import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { sanitizeDesktopSettings, createDesktopSettingsStore, DESKTOP_SETTINGS_DEFAULTS } from "../electron/desktop-settings.js";
import { createCredentialStore } from "../electron/credential-store.js";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("sanitizeDesktopSettings clamps worker prefs and drops invalid theme", () => {
  const next = sanitizeDesktopSettings({
    themeMode: "neon",
    workerCap: 99,
    workerIdleTtlMs: 12,
    lastSessionId: "  sess-1  ",
    lastWorkspace: 12,
    rightPanelOpen: "yes",
    windowBounds: { x: 10, y: 20, width: 100, height: 50, maximized: 1 },
  });
  assert.equal(next.themeMode, DESKTOP_SETTINGS_DEFAULTS.themeMode);
  assert.equal(next.workerCap, 8);
  assert.equal(next.workerIdleTtlMs, 30_000);
  assert.equal(next.lastSessionId, "sess-1");
  assert.equal(next.lastWorkspace, null);
  assert.equal(next.rightPanelOpen, true);
  assert.equal(next.windowBounds.width, 800);
  assert.equal(next.windowBounds.height, 600);
  assert.equal(next.windowBounds.maximized, true);
});

test("desktop settings persist atomically and round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "omega-desktop-settings-"));
  const file = join(dir, "desktop-settings.json");
  const store = createDesktopSettingsStore(file);
  const saved = store.update({ themeMode: "dark", workerCap: 2, workerIdleTtlMs: 120_000, rightPanelOpen: false });
  assert.equal(saved.themeMode, "dark");
  assert.equal(saved.workerCap, 2);
  const reloaded = createDesktopSettingsStore(file).get();
  assert.deepEqual(reloaded, saved);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(raw.themeMode, "dark");
});

test("desktop settings serialize concurrent updates without losing atomic persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omega-desktop-settings-concurrent-"));
  const file = join(dir, "desktop-settings.json");
  const store = createDesktopSettingsStore(file);

  await Promise.all(Array.from({ length: 20 }, (_, index) => Promise.resolve().then(() => store.update({
    lastSessionId: `session-${index}`,
    workerCap: (index % 8) + 1,
  }))));

  const persisted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(typeof persisted.lastSessionId, "string");
  assert.match(persisted.lastSessionId, /^session-\d+$/);
  assert.ok(persisted.workerCap >= 1 && persisted.workerCap <= 8);
  assert.deepEqual(createDesktopSettingsStore(file).get(), store.get());
});

test("credential store encrypts secrets and refuses when encryption is unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "omega-creds-"));
  const file = join(dir, "credentials.bin.json");
  const available = createCredentialStore(file, {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString("utf8").slice(4),
  });
  available.set("openai", "sk-secret");
  assert.equal(available.has("openai"), true);
  assert.deepEqual(available.listIds(), ["openai"]);
  assert.equal(available.read("openai"), "sk-secret");
  const persisted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(persisted.openai.includes("sk-secret"), false);

  const locked = createCredentialStore(join(dir, "locked.json"), {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value),
    decryptString: (buffer) => buffer.toString("utf8"),
  });
  assert.throws(() => locked.set("openai", "sk-secret"), (error) => error.code === "encryption_unavailable");

  const plaintext = createCredentialStore(join(dir, "plaintext.json"), {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value) => Buffer.from(value),
    decryptString: (buffer) => buffer.toString("utf8"),
  });
  assert.throws(() => plaintext.set("openai", "sk-secret"), (error) => error.code === "encryption_unavailable");
});

test("credential store backs up a corrupt vault instead of overwriting it", () => {
  const dir = mkdtempSync(join(tmpdir(), "omega-creds-corrupt-"));
  const file = join(dir, "credentials.bin.json");
  writeFileSync(file, "{not-json");
  const store = createCredentialStore(file, {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString("utf8").slice(4),
  });
  assert.throws(() => store.set("openai", "sk-secret"), (error) => error.code === "vault_corrupt");
  assert.equal(readFileSync(file, "utf8"), "{not-json");
  const backups = readdirSync(dir).filter((name) => name.includes(".corrupt-"));
  assert.equal(backups.length, 1);
});

test("Model Center and credential IPC never return plaintext keys to the renderer", async () => {
  const center = await read("../src/renderer/components/layout/ModelCenter.tsx");
  const main = await read("../electron/main.js");
  const preload = await read("../electron/preload.js");
  assert.match(center, /不会回显已保存的 key/);
  assert.doesNotMatch(center, /credentialStore\.read|decryptString|apiKey:\s*auth/);
  assert.match(main, /omega:setProviderApiKey/);
  assert.match(main, /credentialStore\?\.set\(providerId, apiKey\)/);
  assert.match(main, /rpc\("setProviderApiKey"/);
  assert.doesNotMatch(main, /okResult\(\{[^}]*apiKey/);
  assert.match(preload, /apiKey: req\.apiKey\.trim\(\)\.slice\(0, 8192\)/);
  assert.doesNotMatch(preload, /read\(providerId\)/);
});
