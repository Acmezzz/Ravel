/**
 * Scheduled Flow triggers (next-cycle B8; record shapes ported from
 * prime-agent cron-jobs — once/cron/interval reduced to interval + daily for
 * this slice).
 *
 * A schedule is Ravel-owned config in <workspace>/.ravel/flow-schedules.json;
 * it carries an explicit unattended pre-authorization (maxRuns bounded). Every
 * fire is recorded as a durable flow_trigger fact by the agent worker, and the
 * execution itself reuses the normal validate→plan→execute pipeline with the
 * pre-auth grant surfaced in the approval facts (ruleSource schedule:<id>).
 * The schedule file is configuration; the trigger history is facts.
 *
 * Pure scheduling math is exported separately so tests run without the clock.
 */
import { readJsonFile, writeJsonFileAtomic } from "./config-file.js";

export const SCHEDULE_KINDS = Object.freeze(["interval", "daily"]);
export const SCHEDULE_OUTCOMES = Object.freeze(["started", "skipped_busy", "error"]);
export const SCHEDULES_FILE_NAME = "flow-schedules.json";
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_SCHEDULES = 50;

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SCHEDULE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_args";
  return error;
}

/** Validate + normalize one schedule. `flowSha` must be a 64-hex artifact sha. */
export function validateSchedule(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("schedule must be an object");
  const flowSha = typeof input.flowSha === "string" ? input.flowSha : "";
  if (!/^[0-9a-f]{64}$/.test(flowSha)) throw invalid("schedule.flowSha must be a lowercase SHA-256");
  const id = input.id === undefined ? `schedule-${Math.random().toString(36).slice(2, 10)}${now.toString(36)}` : input.id;
  if (typeof id !== "string" || !SCHEDULE_ID.test(id)) throw invalid("schedule.id is invalid");
  if (!SCHEDULE_KINDS.includes(input.kind)) throw invalid("schedule.kind must be interval or daily");
  const base = {
    id,
    flowSha,
    kind: input.kind,
    preAuthorized: true, // unattended runs always require the explicit grant
    maxRuns: Number.isSafeInteger(input.maxRuns) && input.maxRuns >= 1 && input.maxRuns <= 1000 ? input.maxRuns : 10,
    runCount: Number.isSafeInteger(input.runCount) && input.runCount >= 0 ? input.runCount : 0,
    lastFiredAt: Number.isSafeInteger(input.lastFiredAt) ? input.lastFiredAt : null,
    enabled: input.enabled !== false,
    createdAt: Number.isSafeInteger(input.createdAt) ? input.createdAt : now,
  };
  if (base.runCount >= base.maxRuns) base.enabled = false;
  if (input.kind === "interval") {
    const intervalMinutes = Number.isSafeInteger(input.intervalMinutes) ? input.intervalMinutes : null;
    if (intervalMinutes === null || intervalMinutes < MIN_INTERVAL_MINUTES || intervalMinutes > MAX_INTERVAL_MINUTES) {
      throw invalid(`schedule.intervalMinutes must be ${MIN_INTERVAL_MINUTES}..${MAX_INTERVAL_MINUTES}`);
    }
    return { ...base, intervalMinutes };
  }
  const timeOfDay = typeof input.timeOfDay === "string" && TIME_OF_DAY.test(input.timeOfDay.trim()) ? input.timeOfDay.trim() : null;
  if (!timeOfDay) throw invalid("schedule.timeOfDay must be HH:MM (local time)");
  return { ...base, timeOfDay };
}

/** Next millisecond at or after `fromMs` when the schedule should fire. */
export function nextDueAt(schedule, fromMs) {
  if (schedule.kind === "interval") {
    const intervalMs = schedule.intervalMinutes * 60_000;
    const anchor = schedule.lastFiredAt ?? schedule.createdAt;
    return anchor + intervalMs;
  }
  const [hours, minutes] = String(schedule.timeOfDay).split(":").map(Number);
  for (let day = 0; day < 2; day += 1) {
    const candidate = new Date(fromMs);
    candidate.setHours(hours, minutes, 0, 0);
    candidate.setDate(candidate.getDate() + day);
    const at = candidate.getTime();
    if (at >= fromMs && (schedule.lastFiredAt === null || schedule.lastFiredAt < at)) return at;
  }
  return fromMs;
}

/** Whether the scheduler should fire this schedule at `nowMs`. */
export function isDue(schedule, nowMs) {
  if (!schedule.enabled) return false;
  if (schedule.runCount >= schedule.maxRuns) return false;
  if (schedule.kind === "daily") {
    // Fire when today's slot boundary is crossed while the app is running.
    // Missed slots (app closed at the fire time) are deliberately skipped:
    // no surprise burst of unattended runs after a reboot.
    const [hours, minutes] = String(schedule.timeOfDay).split(":").map(Number);
    const slot = new Date(nowMs);
    slot.setHours(hours, minutes, 0, 0);
    const slotAt = slot.getTime();
    if (slotAt > nowMs || slotAt < schedule.createdAt) return false;
    return schedule.lastFiredAt === null || schedule.lastFiredAt < slotAt;
  }
  return nextDueAt(schedule, nowMs) <= nowMs;
}

/** Account one fire: bump the counter and auto-disable at the pre-auth cap. */
export function recordFire(schedule, nowMs) {
  const runCount = schedule.runCount + 1;
  const exhausted = runCount >= schedule.maxRuns;
  return { ...schedule, runCount, lastFiredAt: nowMs, ...(exhausted ? { enabled: false } : {}) };
}

function parseList(value) {
  if (!Array.isArray(value)) return [];
  const schedules = [];
  for (const item of value) {
    try {
      schedules.push(validateSchedule(item));
    } catch {
      /* invalid entries are dropped, never evaluated */
    }
  }
  return schedules.slice(0, MAX_SCHEDULES);
}

export function loadSchedules(file) {
  return parseList(readJsonFile(file));
}

export function saveSchedules(file, schedules) {
  writeJsonFileAtomic(file, schedules.slice(0, MAX_SCHEDULES));
}

/** Read-modify-write the schedule list under the shared config lock. */
export function mutateSchedules(file, mutate) {
  const current = loadSchedules(file);
  const next = mutate(current);
  saveSchedules(file, next);
  return next;
}
