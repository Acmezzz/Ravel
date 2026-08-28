import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MIN_INTERVAL_MINUTES,
  isDue,
  loadSchedules,
  mutateSchedules,
  nextDueAt,
  recordFire,
  validateSchedule,
} from "../electron/flow-scheduler.js";

const FLOW_SHA = "a".repeat(64);

test("schedule validation enforces shape, caps and the explicit pre-auth grant", () => {
  const schedule = validateSchedule({ flowSha: FLOW_SHA, kind: "interval", intervalMinutes: 60, maxRuns: 5 }, { now: 1_000 });
  assert.equal(schedule.enabled, true);
  assert.equal(schedule.preAuthorized, true, "unattended schedules always carry the pre-auth grant");
  assert.equal(schedule.runCount, 0);
  assert.equal(schedule.lastFiredAt, null);
  assert.throws(() => validateSchedule({ flowSha: "nothex", kind: "interval", intervalMinutes: 60 }), (error) => error.code === "invalid_args");
  assert.throws(() => validateSchedule({ flowSha: FLOW_SHA, kind: "interval", intervalMinutes: MIN_INTERVAL_MINUTES - 1 }), (error) => error.code === "invalid_args");
  assert.throws(() => validateSchedule({ flowSha: FLOW_SHA, kind: "daily", timeOfDay: "24:00" }), (error) => error.code === "invalid_args");
  assert.throws(() => validateSchedule({ flowSha: FLOW_SHA, kind: "cron" }), (error) => error.code === "invalid_args");
  // A schedule whose runs are exhausted is disabled on load.
  assert.equal(validateSchedule({ flowSha: FLOW_SHA, kind: "interval", intervalMinutes: 60, maxRuns: 3, runCount: 3 }).enabled, false);
});

test("interval schedules fire on the interval and account fires with a run cap", () => {
  const schedule = validateSchedule({ flowSha: FLOW_SHA, kind: "interval", intervalMinutes: 60, maxRuns: 2, createdAt: 0 }, { now: 0 });
  assert.equal(isDue(schedule, 59 * 60_000), false);
  assert.equal(isDue(schedule, 60 * 60_000), true);
  assert.equal(nextDueAt(schedule, 0), 60 * 60_000);
  const fired1 = recordFire(schedule, 60 * 60_000);
  assert.equal(fired1.runCount, 1);
  assert.equal(fired1.enabled, true, "one run left");
  const fired2 = recordFire(fired1, 120 * 60_000);
  assert.equal(fired2.enabled, false, "pre-auth cap auto-disables the schedule");
  assert.equal(isDue(fired2, 10_000 * 60 * 60), false);
});

test("daily schedules fire once per local day at the requested time", () => {
  const schedule = validateSchedule({ flowSha: FLOW_SHA, kind: "daily", timeOfDay: "09:30", maxRuns: 5, createdAt: 0 }, { now: 0 });
  const nineThirty = new Date(); nineThirty.setHours(9, 30, 0, 0);
  const before = new Date(nineThirty); before.setMinutes(before.getMinutes() - 1);
  const after = new Date(nineThirty); after.setMinutes(after.getMinutes() + 1);
  assert.equal(isDue(schedule, before.getTime()), false);
  assert.equal(isDue(schedule, after.getTime()), true);
  const fired = recordFire(schedule, after.getTime());
  assert.equal(isDue(fired, after.getTime()), false, "a second fire the same day is not due");
  const tomorrow = new Date(after); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 31, 0, 0);
  assert.equal(isDue(fired, tomorrow.getTime()), true);
  assert.equal(nextDueAt({ ...schedule, lastFiredAt: null }, before.getTime()), nineThirty.getTime());
});

test("schedule store round-trips through disk and drops invalid entries", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ravel-sched-")), "flow-schedules.json");
  try {
    mutateSchedules(file, () => [
      validateSchedule({ flowSha: FLOW_SHA, kind: "interval", intervalMinutes: 30, maxRuns: 5, id: "schedule-a" }, { now: 0 }),
      { broken: true },
    ]);
    const loaded = loadSchedules(file);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "schedule-a");
    mutateSchedules(file, (current) => current.filter((entry) => entry.id !== "schedule-a"));
    assert.equal(loadSchedules(file).length, 0);
  } finally {
    rmSync(join(file, ".."), { recursive: true, force: true });
  }
});
