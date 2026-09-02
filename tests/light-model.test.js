import test from "node:test";
import assert from "node:assert/strict";

import {
  LIGHT_PRESETS,
  brightnessRawFromPercent,
  commandsForPreset,
  normalizeLightStatus,
} from "../src/light-model.js";

test("CHILL converts 25 percent and app temperature 206 to device values", () => {
  assert.equal(brightnessRawFromPercent(25), 64);
  assert.deepEqual(LIGHT_PRESETS.chill, { brightness: 64, temperature: 206 });
});

test("BRIGHT uses maximum brightness and coolest white temperature", () => {
  assert.deepEqual(LIGHT_PRESETS.bright, { brightness: 255, temperature: 255 });
});

test("preset commands turn the lamp on and force white mode", () => {
  assert.deepEqual(commandsForPreset("chill"), [
    { code: "switch_led", value: true },
    { code: "work_mode", value: "white" },
    { code: "bright_value", value: 64 },
    { code: "temp_value", value: 206 },
  ]);
});

test("status normalization recognizes presets with Tuya rounding tolerance", () => {
  assert.equal(normalizeLightStatus({
    switch_led: true,
    work_mode: "white",
    bright_value: 66,
    temp_value: 204,
  }).preset, "chill");
  assert.equal(normalizeLightStatus({
    switch_led: false,
    work_mode: "white",
    bright_value: 64,
    temp_value: 206,
  }).preset, null);
});
