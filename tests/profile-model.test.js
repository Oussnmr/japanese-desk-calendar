import test from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_LIMITS,
  normalizeProfileName,
  profileTooLarge,
  sanitizeProfile,
  sanitizeProfileMap,
} from "../src/profile-model.js";

test("profile names are uppercased, trimmed and stripped of unusable characters", () => {
  assert.equal(normalizeProfileName("  desk night <b>  "), "DESK NIGHT B");
  assert.equal(normalizeProfileName("ipad_2026-a.1"), "IPAD_2026-A.1");
  assert.equal(normalizeProfileName("***"), "");
  assert.equal(normalizeProfileName(42), "");
  assert.equal(normalizeProfileName("X".repeat(60)).length, PROFILE_LIMITS.nameLength);
});

test("layout values are clamped to the editor ranges and colours must be hex", () => {
  const profile = sanitizeProfile({
    overrides: {
      year: { x: 999, y: -999, scale: 5, width: 500, opacity: 0, rotation: 400, color: "#E52B1A" },
      day: { color: "red" },
    },
  });
  assert.deepEqual(profile.overrides.year, {
    color: "#e52b1a", x: 160, y: -160, scale: 70, width: 140, opacity: 10, rotation: 180,
  });
  assert.deepEqual(profile.overrides.day, {
    color: "", x: 0, y: 0, scale: 100, width: 100, opacity: 100, rotation: 0,
  });
});

test("images are never synced and unknown fields are dropped", () => {
  const profile = sanitizeProfile({
    overrides: {},
    text: { year: "2026", caption: 12 },
    colors: { ink: "#11100e", paper: "not-a-colour", extra: "#fff" },
    assets: { enso: "data:image/png;base64,AAAA" },
    injected: true,
  });
  assert.deepEqual(Object.keys(profile).sort(), ["colors", "overrides", "text"]);
  assert.deepEqual(profile.text, { year: "2026" });
  assert.deepEqual(profile.colors, { ink: "#11100e" });
});

test("text bindings are capped in length", () => {
  const profile = sanitizeProfile({ text: { caption: "A".repeat(500) } });
  assert.equal(profile.text.caption.length, PROFILE_LIMITS.textLength);
});

test("the profile map is keyed by normalized names and bounded in count", () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (value, index) => [`PROFILE ${index}`, {}]));
  assert.equal(Object.keys(sanitizeProfileMap(many)).length, PROFILE_LIMITS.profileCount);
  assert.deepEqual(Object.keys(sanitizeProfileMap({ " desk ": {}, "***": {} })), ["DESK"]);
  assert.deepEqual(sanitizeProfileMap(null), {});
});

test("oversized profiles are rejected before they reach storage", () => {
  assert.equal(profileTooLarge(sanitizeProfile({ text: { year: "2026" } })), false);
  const huge = { text: Object.fromEntries(Array.from({ length: 80 }, (value, index) => [`t${index}`, "A".repeat(160)])) };
  assert.equal(profileTooLarge({ ...sanitizeProfile(huge), padding: "B".repeat(PROFILE_LIMITS.bytes) }), true);
});
