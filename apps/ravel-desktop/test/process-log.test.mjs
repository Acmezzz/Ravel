import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUtilityProcessError, processLog } from "../electron/process-log.js";

test("process logs are bounded, structured, and redact paths", () => {
  const record = processLog("pty-worker", "uncaught_exception", new Error("failed at C:\\Users\\secret\\file.txt"));
  assert.deepEqual(Object.keys(record).sort(), ["error", "event", "process", "timestamp"]);
  assert.equal(record.process, "pty-worker");
  assert.doesNotMatch(record.error, /C:\\Users\\/);
  assert.ok(record.error.length <= 512);
});

test("utility process errors normalize Electron's three-argument signature", () => {
  const diagnostic = normalizeUtilityProcessError("crash", "C:\\Users\\secret\\worker.js:12", "x".repeat(5_000));
  assert.deepEqual(Object.keys(diagnostic).sort(), ["location", "report", "type"]);
  assert.equal(diagnostic.type, "crash");
  assert.doesNotMatch(diagnostic.location, /C:\\Users\\/);
  assert.ok(diagnostic.location.length <= 512);
  assert.ok(diagnostic.report.length <= 1_024);
});
