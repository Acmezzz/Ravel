import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  newOauthState,
  parseOauthCallback,
  validateOAuthConfig,
} from "../electron/oauth-service.js";

test("OAuth config requires https endpoints and rejects embedded credentials", () => {
  assert.throws(() => validateOAuthConfig({ authorizationUrl: "http://a/authorize", tokenUrl: "https://a/token", clientId: "x" }), (error) => error.code === "invalid_args");
  assert.throws(() => validateOAuthConfig({ authorizationUrl: "https://a/authorize", tokenUrl: "not a url", clientId: "x" }), (error) => error.code === "invalid_args");
  assert.throws(() => validateOAuthConfig({ authorizationUrl: "https://user:pw@a/authorize", tokenUrl: "https://a/token", clientId: "x" }), (error) => error.code === "invalid_args");
  assert.throws(() => validateOAuthConfig({ authorizationUrl: "https://a/authorize", tokenUrl: "https://a/token" }), (error) => error.code === "invalid_args");
  const auth = validateOAuthConfig({
    authorizationUrl: "https://a/authorize",
    tokenUrl: "https://a/token",
    clientId: "client",
    scopes: ["repo"],
  });
  assert.deepEqual(auth, { authorizationUrl: "https://a/authorize", tokenUrl: "https://a/token", clientId: "client", scopes: ["repo"] });
  assert.equal(validateOAuthConfig(undefined), undefined);
});

test("authorize URL carries PKCE S256 + state, and callbacks validate state", () => {
  const state = newOauthState();
  const { verifier, challenge } = createPkcePair();
  assert.notEqual(verifier, challenge);
  assert.ok(verifier.length >= 43);
  const url = buildAuthorizeUrl({
    authorizationUrl: "https://a/authorize",
    clientId: "client",
    scopes: ["repo", "read:org"],
    redirectUri: "ravel://oauth/callback",
    state,
    codeChallenge: challenge,
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("state"), state);
  assert.equal(parsed.searchParams.get("scope"), "repo read:org");
  const good = `ravel://oauth/callback?code=abc&state=${state}`;
  assert.deepEqual(parseOauthCallback(good, state), { code: "abc" });
  assert.equal(parseOauthCallback(good, "other-state"), null, "state mismatch is rejected");
  assert.equal(parseOauthCallback(`ravel://oauth/callback?error=access_denied&state=${state}`, state), null);
  assert.equal(parseOauthCallback("https://evil/oauth/callback?code=abc&state=x", "x"), null, "non-ravel schemes are rejected");
});

async function jsonFetch(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("token exchange succeeds and maps failures to oauth_exchange_failed", async () => {
  let captured;
  const tokens = await exchangeAuthorizationCode({
    tokenUrl: "https://a/token",
    clientId: "client",
    code: "abc",
    verifier: "v",
    redirectUri: "ravel://oauth/callback",
    fetchImpl: async (url, init) => {
      captured = { url, body: String(init.body) };
      return jsonFetch({ access_token: "tok", token_type: "Bearer", expires_in: 3600 });
    },
  });
  assert.equal(tokens.accessToken, "tok");
  assert.equal(tokens.expiresIn, 3600);
  assert.ok(captured.body.includes("grant_type=authorization_code"));
  assert.ok(captured.body.includes("code_verifier=v"));
  await assert.rejects(
    () => exchangeAuthorizationCode({ tokenUrl: "https://a/token", clientId: "c", code: "x", verifier: "v", redirectUri: "r", fetchImpl: async () => jsonFetch({}, 401) }),
    (error) => error.code === "oauth_exchange_failed",
  );
  await assert.rejects(
    () => exchangeAuthorizationCode({ tokenUrl: "https://a/token", clientId: "c", code: "x", verifier: "v", redirectUri: "r", fetchImpl: async () => jsonFetch({}) }),
    (error) => error.code === "oauth_exchange_failed",
  );
});
