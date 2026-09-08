import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCHEDULE, brusselsMinuteInfo, effectiveTheme, sanitizeSchedule } from "../src/theme-model.js";

test("brusselsMinuteInfo reads the correct local time across DST", () => {
  // Winter (CET, UTC+1): 06:30 UTC is 07:30 Brussels.
  assert.deepEqual(brusselsMinuteInfo(Date.parse("2026-01-15T06:30:00Z")), { dateKey: "2026-01-15", minuteOfDay: 7 * 60 + 30 });
  // Summer (CEST, UTC+2): 05:30 UTC is 07:30 Brussels.
  assert.deepEqual(brusselsMinuteInfo(Date.parse("2026-07-15T05:30:00Z")), { dateKey: "2026-07-15", minuteOfDay: 7 * 60 + 30 });
});

test("sanitizeSchedule clamps to valid minutes-of-day and falls back to defaults", () => {
  assert.deepEqual(sanitizeSchedule({ dayMinute: 390, nightMinute: 1260 }), { dayMinute: 390, nightMinute: 1260 });
  assert.deepEqual(sanitizeSchedule({ dayMinute: -5, nightMinute: 1500 }), DEFAULT_SCHEDULE);
  assert.deepEqual(sanitizeSchedule(null), DEFAULT_SCHEDULE);
});

test("with no stored value, the schedule alone decides the theme", () => {
  const schedule = { dayMinute: 8 * 60, nightMinute: 20 * 60 };
  // 09:00 Brussels winter = 08:00 UTC -> daytime.
  assert.equal(effectiveTheme(null, schedule, Date.parse("2026-01-15T08:00:00Z")), "light");
  // 21:00 Brussels winter = 20:00 UTC -> nighttime.
  assert.equal(effectiveTheme(null, schedule, Date.parse("2026-01-15T20:00:00Z")), "dark");
});

test("a manual choice sticks until the next scheduled boundary passes", () => {
  const schedule = { dayMinute: 8 * 60, nightMinute: 20 * 60 };
  // Forced dark at 10:00 Brussels (09:00 UTC), still daytime by the schedule.
  const stored = { value: "dark", updatedAt: Date.parse("2026-01-15T09:00:00Z") };
  // 30 minutes later, still before the night boundary: manual choice holds.
  assert.equal(effectiveTheme(stored, schedule, Date.parse("2026-01-15T09:30:00Z")), "dark");
  // Past the night boundary (20:00 Brussels = 19:00 UTC in winter): schedule reasserts (already dark here, same result).
  assert.equal(effectiveTheme(stored, schedule, Date.parse("2026-01-15T19:30:00Z")), "dark");
  // Past the following day boundary: schedule reasserts light, overriding the old manual dark.
  assert.equal(effectiveTheme(stored, schedule, Date.parse("2026-01-16T08:00:00Z")), "light");
});

test("night auto-switch: forcing light before the night boundary reverts once it passes", () => {
  const schedule = { dayMinute: 8 * 60, nightMinute: 20 * 60 };
  const stored = { value: "light", updatedAt: Date.parse("2026-01-15T10:00:00Z") }; // 11:00 Brussels
  // Before night boundary (19:00 UTC = 20:00 Brussels winter): manual light holds.
  assert.equal(effectiveTheme(stored, schedule, Date.parse("2026-01-15T18:30:00Z")), "light");
  // After the night boundary: schedule flips to dark.
  assert.equal(effectiveTheme(stored, schedule, Date.parse("2026-01-15T19:30:00Z")), "dark");
});

test("a custom schedule (night before day, e.g. dayMinute after midnight) is handled", () => {
  const schedule = { dayMinute: 6 * 60, nightMinute: 22 * 60 };
  assert.equal(effectiveTheme(null, schedule, Date.parse("2026-01-15T04:30:00Z")), "dark"); // 05:30 Brussels
  assert.equal(effectiveTheme(null, schedule, Date.parse("2026-01-15T05:30:00Z")), "light"); // 06:30 Brussels
});

test("the schedule works the same across the summer/winter DST boundary", () => {
  const schedule = { dayMinute: 8 * 60, nightMinute: 20 * 60 };
  // 05:30 UTC summer = 07:30 Brussels -> still night.
  assert.equal(effectiveTheme(null, schedule, Date.parse("2026-07-15T05:30:00Z")), "dark");
  // 06:30 UTC summer = 08:30 Brussels -> day.
  assert.equal(effectiveTheme(null, schedule, Date.parse("2026-07-15T06:30:00Z")), "light");
});
