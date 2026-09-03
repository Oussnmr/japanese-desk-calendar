import test from "node:test";
import assert from "node:assert/strict";

import {
  LIGHT_PRESETS,
  brightnessRawFromPercent,
  colorDataFromRgb,
  colorDpForValues,
  colorScaleForDp,
  commandsForPreset,
  normalizeLightStatus,
  rgbFromColorData,
  temperatureRawFromPercent,
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

test("color controls use the colour capability reported by this device", () => {
  assert.equal(colorDpForValues({ colour_data_v2: "{}" }), "colour_data_v2");
  assert.equal(colorDpForValues({ colour_data: "{}" }), "colour_data");
  assert.equal(colorDpForValues({}), null);
  assert.equal(colorScaleForDp("colour_data"), 255);
  assert.equal(colorScaleForDp("colour_data_v2"), 1000);
  assert.deepEqual(rgbFromColorData(colorDataFromRgb({ r: 255, g: 0, b: 0 }, 255), 255), { r: 255, g: 0, b: 0 });
  assert.deepEqual(rgbFromColorData(colorDataFromRgb({ r: 0, g: 0, b: 255 })), { r: 0, g: 0, b: 255 });
});

test("warmth maps 0 to warm and 100 to cool device temperature", () => {
  assert.equal(temperatureRawFromPercent(0), 0);
  assert.equal(temperatureRawFromPercent(100), 255);
});
