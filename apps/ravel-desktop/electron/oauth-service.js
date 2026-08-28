/**
 * MCP server OAuth login (next-cycle B5; flow adapted from opencode's
 * oauth-callback and prime's login-gated integrations, MIT).
 *
 * Authorization Code + PKCE against the server's own OAuth provider. The
 * callback returns through the `ravel://oauth/callback` deep link (no local
 * HTTP listener — RFC 8252 custom-scheme flow), and the resulting access
 * token lands in the safeStorage vault under `mcp:<server>`, where the MCP
 * bridge's `$cred:` header resolution picks it up at connect time. Plaintext
 * tokens never touch disk.
 *
 * Deferred (recorded in the borrowing doc): dynamic client registration and
 * refresh-token rotation — the client id comes from the server's auth config,
 * and a re-login issues a fresh token.
 *
 * Pure parts are exported separately so tests run without a network.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

/** For ravel://oauth/callback the URL host is "oauth" and the path is "/callback". */
export const OAUTH_CALLBACK_HOST = "oauth";
export const OAUTH_CALLBACK_PATH = "/callback";
export const MAX_AUTH_URL = 2048;
const TOKEN_TIMEOUT_MS = 30_000;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

function validateHttpsUrl(value, field) {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_AUTH_URL) throw invalid(`${field} must be at most ${MAX_AUTH_URL} characters`);
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:") throw invalid(`${field} must use https`);
  if (parsed.username || parsed.password) throw invalid(`${field} must not embed credentials`);
  return trimmed;
}

/** Validate the per-server auth config stored in mcp.json. */
export function validateOAuthConfig(auth) {
  if (auth === undefined || auth === null) return undefined;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw invalid("auth must be an object");
  const scopes = auth.scopes ?? [];
  if (!Array.isArray(scopes) || scopes.length > 16 || scopes.some((scope) => typeof scope !== "string" || scope.length > 128)) {
    throw invalid("auth.scopes must be at most 16 strings of 128 characters");
  }
  const clientId = typeof auth.clientId === "string" ? auth.clientId.trim() : "";
  if (!clientId || clientId.length > 256) throw invalid("auth.clientId is required (at most 256 characters)");
  const clientSecret = auth.clientSecret === undefined || auth.clientSecret === null
    ? undefined
    : typeof auth.clientSecret === "string" && auth.clientSecret.length <= 2048
      ? auth.clientSecret
      : (() => { throw invalid("auth.clientSecret must be at most 2048 characters"); })();
  return {
    authorizationUrl: validateHttpsUrl(auth.authorizationUrl, "auth.authorizationUrl"),
    tokenUrl: validateHttpsUrl(auth.tokenUrl, "auth.tokenUrl"),
    clientId,
    ...(clientSecret !== undefined ? { clientSecret } : {}),
    ...(scopes.length > 0 ? { scopes } : {}),
  };
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/** PKCE pair per RFC 7636: 43-128 char verifier, S256 challenge. */
export function createPkcePair() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl({ authorizationUrl, clientId, scopes = [], redirectUri, state, codeChallenge }) {
  const url = new URL(authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "));
  return url.toString();
}

export function newOauthState() {
  return randomUUID();
}

/**
 * Parse a callback deep link against the expected state. Returns { code } or
 * null (wrong path, state mismatch, provider-reported error).
 */
export function parseOauthCallback(value, expectedState) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "ravel:" || url.host !== OAUTH_CALLBACK_HOST || url.pathname !== OAUTH_CALLBACK_PATH) return null;
  if (url.searchParams.get("state") !== expectedState || !expectedState) return null;
  const providerError = url.searchParams.get("error");
  if (providerError) return null;
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096) return null;
  return { code };
}

/** Exchange the authorization code for tokens. fetchImpl injectable for tests. */
export async function exchangeAuthorizationCode({ tokenUrl, clientId, clientSecret, code, verifier, redirectUri, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (clientSecret !== undefined) body.set("client_secret", clientSecret);
  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (error) {
    throw Object.assign(new Error(`token endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`), { code: "oauth_exchange_failed" });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`token endpoint returned ${response.status}`), { code: "oauth_exchange_failed" });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("token endpoint returned invalid JSON"), { code: "oauth_exchange_failed" });
  }
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!accessToken) {
    throw Object.assign(new Error("token response is missing access_token"), { code: "oauth_exchange_failed" });
  }
  return {
    accessToken,
    ...(typeof payload?.refresh_token === "string" ? { refreshToken: payload.refresh_token } : {}),
    ...(typeof payload?.expires_in === "number" ? { expiresIn: payload.expires_in } : {}),
  };
}
