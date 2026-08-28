/** Minimal structured logging for utility processes; secrets and paths never cross this boundary. */
const MAX_MESSAGE = 512;
const MAX_DIAGNOSTIC_FIELD = 512;
const MAX_REPORT = 1_024;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,96}$/;

function safeMessage(value, limit = MAX_MESSAGE) {
  let text;
  if (value instanceof Error) text = value.message;
  else if (typeof value === "string") text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  return String(text ?? "unknown")
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, "<path>")
    .replace(/(^|[\s("'`])\/(?:[^\s\/]+\/)+[^\s"'`]+/g, (_match, prefix) => `${prefix}<path>`)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, limit);
}

/** Normalize Electron's utilityProcess error(type, location, report) event safely. */
export function normalizeUtilityProcessError(type, location, report) {
  if (type instanceof Error && location === undefined && report === undefined) {
    return Object.freeze({
      type: "error",
      location: "unknown",
      report: safeMessage(type.message, MAX_REPORT),
    });
  }
  return Object.freeze({
    type: safeMessage(type, MAX_DIAGNOSTIC_FIELD),
    location: safeMessage(location, MAX_DIAGNOSTIC_FIELD),
    report: safeMessage(report, MAX_REPORT),
  });
}

export function utilityProcessError(type, location, report, code = "worker_unavailable") {
  const diagnostic = normalizeUtilityProcessError(type, location, report);
  const message = `${diagnostic.type} at ${diagnostic.location}: ${diagnostic.report}`.slice(0, MAX_MESSAGE);
  return Object.assign(new Error(message), { code, diagnostic });
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

export { safeMessage };
