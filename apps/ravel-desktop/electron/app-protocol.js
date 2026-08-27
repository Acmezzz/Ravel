import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const APP_PROTOCOL = "app";
export const APP_HOST = "bundle";

function reject(message) {
  const error = new Error(message);
  error.code = "invalid_app_asset";
  return error;
}

function comparable(value) {
  return normalize(resolve(value)).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

export function isContainedPath(root, candidate) {
  const base = comparable(root);
  const target = comparable(candidate);
  return target === base || target.startsWith(`${base}/`);
}

function decodedPath(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw reject("Invalid app asset URL");
  }
  if (parsed.protocol !== `${APP_PROTOCOL}:` || parsed.hostname !== APP_HOST || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw reject("App asset URL is not allowed");
  }
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw reject("Malformed app asset path");
  }
  if (!pathname || /[\u0000-\u001f\u007f]/.test(pathname) || pathname.includes("\\") || /^[A-Za-z]:/.test(pathname)) {
    throw reject("App asset path is not allowed");
  }
  const relativePath = pathname.replace(/^\/+/, "");
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw reject("App asset traversal is not allowed");
  return relativePath;
}

export function resolveAppAsset(url, root) {
  if (typeof root !== "string" || !root) throw reject("Renderer root is required");
  const pathname = decodedPath(url);
  const rootPath = resolve(root);
  const candidate = resolve(join(rootPath, pathname));
  if (!isContainedPath(rootPath, candidate) || !existsSync(candidate)) throw reject("App asset not found");
  if (!lstatSync(candidate).isFile()) throw reject("App asset is not a file");
  try {
    const canonicalRoot = realpathSync.native(rootPath);
    const canonicalCandidate = realpathSync.native(candidate);
    if (!isContainedPath(canonicalRoot, canonicalCandidate)) throw reject("App asset escapes renderer root");
    return canonicalCandidate;
  } catch (error) {
    if (error?.code === "invalid_app_asset") throw error;
    if (rootPath.toLowerCase().includes(".asar")) return candidate;
    throw reject("App asset cannot be resolved");
  }
}

export function appRendererUrl(path = "index.html") {
  if (typeof path !== "string" || !path || path.includes("\\") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw reject("Invalid renderer path");
  }
  return `${APP_PROTOCOL}://${APP_HOST}/${path}`;
}

export function isAllowedAppUrl(url) {
  if (typeof url !== "string" || /(?:^|[\\/])\.\.(?:[\\/]|$)|%2e|%2f|%5c/i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_PROTOCOL}:` && parsed.hostname === APP_HOST && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === "/index.html";
  } catch {
    return false;
  }
}

export function rendererAssetRoot({ isPackaged, appPath, mainDir }) {
  return resolve(isPackaged ? appPath : join(mainDir, ".."));
}

export async function registerAppProtocol({ protocol, net, root }) {
  if (!protocol || typeof protocol.handle !== "function") throw new TypeError("protocol.handle is required");
  if (!net || typeof net.fetch !== "function") throw new TypeError("net.fetch is required");
  if (typeof root !== "string" || !root) throw new TypeError("renderer root is required");
  await protocol.handle(APP_PROTOCOL, async (request) => {
    try {
      const filePath = resolveAppAsset(request.url, root);
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      return new Response(error?.code === "invalid_app_asset" ? "Not found" : "Internal error", { status: error?.code === "invalid_app_asset" ? 404 : 500 });
    }
  });
  return root;
}
