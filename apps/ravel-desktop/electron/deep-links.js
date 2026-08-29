/**
 * ravel:// deep link parsing and OS protocol registration policy.
 *
 * `omega://` remains accepted as a legacy entry point; compat identifiers are
 * intentional until the migration window closes.
 */

export const DEEP_LINK_PROTOCOL = "ravel";
const LEGACY_PROTOCOLS = ["omega://"];
const MAX_PARAM_LENGTH = 4096;

function sanitizeParam(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PARAM_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** Path of the OAuth callback deep link (next-cycle B5). */
export const OAUTH_CALLBACK_URL = `${DEEP_LINK_PROTOCOL}://oauth/callback`;

/** Parse a ravel:// or omega:// deep link into { workspace, sessionId }. Returns null for anything not usable. */
export function parseDeepLink(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(`${DEEP_LINK_PROTOCOL}://`) && !LEGACY_PROTOCOLS.some((prefix) => trimmed.startsWith(prefix))) {
    return null;
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // OAuth callback (B5): ravel://oauth/callback?code=...&state=...
  if (url.host === "oauth" && url.pathname === "/oauth/callback") {
    const code = sanitizeParam(url.searchParams.get("code"));
    const state = sanitizeParam(url.searchParams.get("state"));
    if (!code || !state) return null;
    return { oauth: { code, state } };
  }
  const workspace = sanitizeParam(url.searchParams.get("workspace"));
  const sessionId = sanitizeParam(url.searchParams.get("session"));
  if (!workspace && !sessionId) return null;
  return { workspace, sessionId };
}

/**
 * Register the protocol only in packaged builds or on explicit developer
 * opt-in, so dev runs never claim the OS handler. Automated packaged runs
 * (electron/migration smoke) also skip registration to leave the host
 * machine's OS state untouched.
 */
export function shouldRegisterProtocol({ isPackaged, env }) {
  if (env?.RAVEL_AUTOTEST === "1") return false;
  if (env?.RAVEL_REGISTER_PROTOCOL === "1") return true;
  return Boolean(isPackaged);
}
