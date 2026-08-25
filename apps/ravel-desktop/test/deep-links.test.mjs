import test from "node:test";
import assert from "node:assert/strict";
import { parseDeepLink, shouldRegisterProtocol } from "../electron/deep-links.js";

test("parses ravel:// workspace and session params", () => {
  assert.deepEqual(
    parseDeepLink("ravel://open?workspace=D%3A%5Cproject%5Cagent&session=abc-123"),
    { workspace: "D:\\project\\agent", sessionId: "abc-123" },
  );
  assert.deepEqual(parseDeepLink("ravel://open?workspace=/home/user/repo"), {
    workspace: "/home/user/repo",
    sessionId: null,
  });
  assert.deepEqual(parseDeepLink("ravel://open?session=abc-123"), {
    workspace: null,
    sessionId: "abc-123",
  });
});

test("keeps omega:// as a legacy deep link entry point", () => {
  assert.deepEqual(parseDeepLink("omega://open?workspace=/tmp/demo"), {
    workspace: "/tmp/demo",
    sessionId: null,
  });
});

test("rejects unknown protocols and malformed links", () => {
  assert.equal(parseDeepLink(null), null);
  assert.equal(parseDeepLink(42), null);
  assert.equal(parseDeepLink("https://open?workspace=/tmp/demo"), null);
  assert.equal(parseDeepLink("pi://open?workspace=/tmp/demo"), null);
  assert.equal(parseDeepLink("ravel://%zz"), null);
  // No usable parameters means there is nothing to apply.
  assert.equal(parseDeepLink("ravel://open"), null);
  assert.equal(parseDeepLink("ravel://open?unknown=1"), null);
  assert.equal(parseDeepLink("  "), null);
});

test("rejects control characters and oversized parameters", () => {
  assert.equal(parseDeepLink(`ravel://open?workspace=${encodeURIComponent("C:\\tmp\u0000evil")}`), null);
  const oversized = "a".repeat(5000);
  assert.equal(parseDeepLink(`ravel://open?workspace=${encodeURIComponent(oversized)}`), null);
});

test("protocol registration is opt-in for dev builds and default for packaged builds", () => {
  assert.equal(shouldRegisterProtocol({ isPackaged: true, env: {} }), true);
  assert.equal(shouldRegisterProtocol({ isPackaged: false, env: {} }), false);
  assert.equal(shouldRegisterProtocol({ isPackaged: false, env: { RAVEL_REGISTER_PROTOCOL: "1" } }), true);
  assert.equal(shouldRegisterProtocol({ isPackaged: false, env: { RAVEL_REGISTER_PROTOCOL: "0" } }), false);
});

test("automated packaged runs never register the OS protocol", () => {
  assert.equal(shouldRegisterProtocol({ isPackaged: true, env: { RAVEL_AUTOTEST: "1" } }), false);
  assert.equal(shouldRegisterProtocol({ isPackaged: true, env: { RAVEL_AUTOTEST: "1", RAVEL_REGISTER_PROTOCOL: "1" } }), false);
});
