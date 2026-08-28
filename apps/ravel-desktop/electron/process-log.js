/** Minimal structured logging for utility processes; secrets and paths never cross this boundary. */
const MAX_MESSAGE = 512;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,96}$/;

function safeMessage(value) {
  return String(value ?? "unknown").replace(/[A-Za-z]:\\[^\s]+|\/(?:[^\s/]+\/)+[^\s]*/g, "<path>").slice(0, MAX_MESSAGE);
}

export function processLog(processName, event, error) {
  const record = {
    process: SAFE_CODE.test(processName) ? processName : "utility",
    event: SAFE_CODE.test(event) ? event : "event",
    ...(error ? { error: safeMessage(error instanceof Error ? error.message : error) } : {}),
    timestamp: new Date().toISOString(),
  };
  try { process.stderr.write(`${JSON.stringify(record)}\n`); } catch { /* logging must not crash the worker */ }
  return record;
}
