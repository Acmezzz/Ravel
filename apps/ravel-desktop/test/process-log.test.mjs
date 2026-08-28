import test from "node:test";
import assert from "node:assert/strict";
import { processLog } from "../electron/process-log.js";

test("process logs are bounded, structured, and redact paths", () => {
  const record = processLog("pty-worker", "uncaught_exception", new Error("failed at C:\\Users\\secret\\file.txt"));
  assert.deepEqual(Object.keys(record).sort(), ["error", "event", "process", "timestamp"]);
  assert.equal(record.process, "pty-worker");
  assert.doesNotMatch(record.error, /C:\\Users/);
  assert.ok(record.error.length <= 512);
});
