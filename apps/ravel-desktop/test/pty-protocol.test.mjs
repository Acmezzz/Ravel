import test from "node:test";
import assert from "node:assert/strict";
import {
  PTY_METHODS,
  createPtyErrorResponse,
  createPtyRequest,
  createPtyResponse,
  isPtyMethod,
  isPtyOutputEvent,
  isPtyRequest,
  isPtyResponse,
  sanitizePtyOutputDTO,
} from "../electron/pty-protocol.js";

test("PTY wire protocol enforces strict methods, bounded envelopes, and sanitizes output DTOs", () => {
  assert.deepEqual([...PTY_METHODS], ["init", "spawn", "write", "resize", "kill", "dispose"]);
  assert.equal(isPtyMethod("spawn"), true);
  assert.equal(isPtyMethod("eval"), false);

  const req = createPtyRequest("req-1", 1, "spawn", { cols: 80, rows: 24 });
  assert.equal(isPtyRequest(req), true);
  assert.equal(isPtyRequest({ ...req, method: "invalid" }), false);

  const resp = createPtyResponse("req-1", 1, { pid: 1234 });
  assert.equal(isPtyResponse(resp), true);

  const errResp = createPtyErrorResponse("req-1", 1, "Spawn failed", "spawn_error");
  assert.equal(isPtyResponse(errResp), true);
  assert.equal(errResp.code, "spawn_error");

  const output = sanitizePtyOutputDTO("sess-1", "hello\n", 0, false);
  assert.deepEqual(output, { sessionId: "sess-1", chunk: "hello\n", sequence: 0, isFinal: false });
  assert.equal(isPtyOutputEvent({ type: "pty:data", ...output }), true);
  assert.throws(() => sanitizePtyOutputDTO("", "x", 0), /Invalid PTY output/);
});
