import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import https from "node:https";

const activeDownloads = new Map();
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? "" };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function isHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function safeAssetFilename(value) {
  const raw = String(value ?? "");
  if (raw.includes("/") || raw.includes("\\")) {
    const error = new Error("Invalid update asset filename");
    error.code = "invalid_update_asset";
    throw error;
  }
  const name = basename(raw);
  if (!name || name === "." || name === ".." || !/^[A-Za-z0-9._-]+$/.test(name) || name.length > 180) {
    const error = new Error("Invalid update asset filename");
    error.code = "invalid_update_asset";
    throw error;
  }
  return name;
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || !parseVersion(manifest.version) || typeof manifest.notes !== "string") {
    const error = new Error("Invalid release manifest");
    error.code = "invalid_update_manifest";
    throw error;
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    const error = new Error("Release manifest has no assets");
    error.code = "invalid_update_manifest";
    throw error;
  }
  const assets = manifest.assets.map((asset) => {
    const filename = safeAssetFilename(asset.filename);
    if (!isHttpsUrl(asset.url) || !/^[a-f0-9]{64}$/i.test(String(asset.sha256 ?? "")) || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_DOWNLOAD_BYTES) {
      const error = new Error("Invalid release asset");
      error.code = "invalid_update_asset";
      throw error;
    }
    return { filename, url: asset.url, sha256: asset.sha256.toLowerCase(), size: asset.size };
  });
  return { version: String(manifest.version), notes: manifest.notes.slice(0, 20_000), assets };
}

export function readReleaseManifest(filePath) {
  return validateManifest(JSON.parse(readFileSync(filePath, "utf8")));
}

function requestBuffer(url, limit) {
  return new Promise((resolve, reject) => {
    if (!isHttpsUrl(url)) {
      const error = new Error("Updater only accepts HTTPS URLs");
      error.code = "insecure_update_url";
      reject(error);
      return;
    }
    const request = https.get(url, { headers: { accept: "application/json" } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(Object.assign(new Error(`Update request failed: ${response.statusCode}`), { code: "update_http_error" }));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) request.destroy(new Error("Update response too large"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

export async function fetchReleaseManifest(url) {
  return validateManifest(JSON.parse((await requestBuffer(url, MAX_MANIFEST_BYTES)).toString("utf8")));
}

export function verifySha256(filePath, expected) {
  const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return actual === String(expected).toLowerCase();
}

export function downloadUpdate(asset, destinationDir, { onProgress } = {}) {
  const validated = validateManifest({ version: "0.0.0", notes: "", assets: [asset] }).assets[0];
  const normalizedDestination = resolve(destinationDir);
  const downloadKey = `${normalizedDestination}\u0000${validated.sha256}`;
  const existing = activeDownloads.get(downloadKey);
  if (existing) return existing;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    mkdirSync(normalizedDestination, { recursive: true });
    const finalPath = join(normalizedDestination, validated.filename);
    const tempPath = `${finalPath}.download-${process.pid}`;
    let received = 0;
    let settled = false;
    let request;
    let response;
    const hash = createHash("sha256");
    const output = createWriteStream(tempPath, { flags: "w" });

    const removeTempFile = () => {
      try { unlinkSync(tempPath); } catch { /* best effort */ }
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      request?.destroy();
      response?.destroy();
      output.once("close", removeTempFile);
      output.destroy();
      removeTempFile();
      rejectPromise(error);
    };
    const succeed = (result) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    output.on("error", fail);
    request = https.get(validated.url, (incomingResponse) => {
      response = incomingResponse;
      response.on("error", fail);
      if (response.statusCode !== 200) {
        response.resume();
        fail(Object.assign(new Error(`Update download failed: ${response.statusCode}`), { code: "update_http_error" }));
        return;
      }
      response.on("data", (chunk) => {
        if (settled) return;
        received += chunk.length;
        if (received > MAX_DOWNLOAD_BYTES || received > validated.size + 1024) {
          fail(new Error("Update asset exceeds declared size"));
          return;
        }
        hash.update(chunk);
        if (!output.write(chunk)) output.once("drain", () => {});
        onProgress?.({ received, total: validated.size });
      });
      response.on("end", () => {
        if (settled) return;
        output.end((error) => {
          if (error) { fail(error); return; }
          if (settled) return;
          const digest = hash.digest("hex");
          if (received !== validated.size || digest !== validated.sha256) {
            fail(Object.assign(new Error("Update checksum or size mismatch"), { code: "update_integrity_failed" }));
            return;
          }
          try {
            renameSync(tempPath, finalPath);
            succeed({ path: finalPath, sha256: digest, size: received });
          } catch (error) {
            fail(error);
          }
        });
      });
    });
    request.on("error", fail);
  }).finally(() => activeDownloads.delete(downloadKey));
  activeDownloads.set(downloadKey, promise);
  return promise;
}
