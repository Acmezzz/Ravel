/**
 * Local credential vault. Renderer never receives plaintext. Electron
 * safeStorage is preferred; if unavailable the store refuses to persist.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createCredentialStore(filePath, { encryptString, decryptString, isEncryptionAvailable } = {}) {
  function readVault() {
    if (!existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeVault(vault) {
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(vault, null, "\t")}\n`, { mode: 0o600 });
    renameSync(temp, filePath);
  }

  function has(id) {
    if (typeof id !== "string" || !id.trim()) return false;
    return Boolean(readVault()[id]);
  }

  function listIds() {
    return Object.keys(readVault());
  }

  function set(id, secret) {
    if (typeof id !== "string" || !id.trim()) {
      const error = new Error("credential id is required");
      error.code = "invalid_args";
      throw error;
    }
    if (typeof secret !== "string" || !secret) {
      const error = new Error("credential secret is required");
      error.code = "invalid_args";
      throw error;
    }
    if (typeof isEncryptionAvailable === "function" && !isEncryptionAvailable()) {
      const error = new Error("系统密钥存储不可用，无法保存凭据");
      error.code = "encryption_unavailable";
      throw error;
    }
    if (typeof encryptString !== "function") {
      const error = new Error("credential encryption is unavailable");
      error.code = "encryption_unavailable";
      throw error;
    }
    const vault = readVault();
    vault[id.trim().slice(0, 128)] = encryptString(secret).toString("base64");
    writeVault(vault);
    return { id: id.trim().slice(0, 128), stored: true };
  }

  function remove(id) {
    if (typeof id !== "string" || !id.trim()) return false;
    const vault = readVault();
    if (!vault[id]) return false;
    delete vault[id];
    if (Object.keys(vault).length === 0 && existsSync(filePath)) unlinkSync(filePath);
    else writeVault(vault);
    return true;
  }

  function read(id) {
    if (typeof decryptString !== "function") return null;
    const encoded = readVault()[id];
    if (typeof encoded !== "string") return null;
    try {
      return decryptString(Buffer.from(encoded, "base64"));
    } catch {
      return null;
    }
  }

  return { has, listIds, set, remove, read };
}
