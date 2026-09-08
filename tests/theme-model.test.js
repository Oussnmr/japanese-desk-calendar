import test from "node:test";
import assert from "node:assert/strict";

import { brusselsDateInfo, effectiveTheme } from "../src/theme-model.js";

test("brusselsDateInfo reads the correct local hour across DST", () => {
  // Winter (CET, UTC+1): 06:30 UTC is 07:30 Brussels.
  assert.deepEqual(brusselsDateInfo(Date.parse("2026-01-15T06:30:00Z")), { dateKey: "2026-01-15", hour: 7 });
  // Summer (CEST, UTC+2): 05:30 UTC is 07:30 Brussels.
  assert.deepEqual(brusselsDateInfo(Date.parse("2026-07-15T05:30:00Z")), { dateKey: "2026-07-15", hour: 7 });
});

test("light stays light regardless of time", () => {
  assert.equal(effectiveTheme({ value: "light", updatedAt: 0 }, Date.parse("2026-01-15T09:00:00Z")), "light");
  assert.equal(effectiveTheme(null, Date.parse("2026-01-15T09:00:00Z")), "light");
});

test("dark stays dark before the 8am Brussels flip", () => {
  const stored = { value: "dark", updatedAt: Date.parse("2026-01-14T20:00:00Z") };
  // 06:30 UTC winter = 07:30 Brussels, still before 8.
  assert.equal(effectiveTheme(stored, Date.parse("2026-01-15T06:30:00Z")), "dark");
});

test("dark set yesterday flips to light after 8am Brussels", () => {
  const stored = { value: "dark", updatedAt: Date.parse("2026-01-14T20:00:00Z") };
  // 08:00 UTC winter = 09:00 Brussels.
  assert.equal(effectiveTheme(stored, Date.parse("2026-01-15T08:00:00Z")), "light");
});

test("dark set earlier today before 8am flips to light once it's past 8am", () => {
  const stored = { value: "dark", updatedAt: Date.parse("2026-01-15T05:00:00Z") }; // 06:00 Brussels
  assert.equal(effectiveTheme(stored, Date.parse("2026-01-15T08:00:00Z")), "light"); // 09:00 Brussels
});

test("a manual dark choice made after 8am today is honoured, not reverted", () => {
  const stored = { value: "dark", updatedAt: Date.parse("2026-01-15T07:30:00Z") }; // 08:30 Brussels
  assert.equal(effectiveTheme(stored, Date.parse("2026-01-15T09:00:00Z")), "dark"); // 10:00 Brussels
});

test("the flip works the same across the summer/winter DST boundary", () => {
  const storedYesterday = { value: "dark", updatedAt: Date.parse("2026-07-14T20:00:00Z") };
  // 06:00 UTC summer = 08:00 Brussels (CEST, UTC+2) -> already past the flip hour.
  assert.equal(effectiveTheme(storedYesterday, Date.parse("2026-07-15T06:00:00Z")), "light");
  // 05:30 UTC summer = 07:30 Brussels -> still before the flip hour.
  assert.equal(effectiveTheme(storedYesterday, Date.parse("2026-07-15T05:30:00Z")), "dark");
});
