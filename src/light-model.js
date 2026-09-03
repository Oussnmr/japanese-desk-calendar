export const LIGHT_DPS = Object.freeze({
  power: "switch_led",
  workMode: "work_mode",
  brightness: "bright_value",
  temperature: "temp_value",
});

// The device reports which of these colour capabilities it exposes in its
// status. Keep that choice server-side instead of assuming one fixed DP.
export const COLOR_DPS = Object.freeze(["colour_data_v2", "colour_data"]);

export const LIGHT_RANGES = Object.freeze({
  brightness: Object.freeze({ min: 25, max: 255 }),
  temperature: Object.freeze({ min: 0, max: 255 }),
});

const PRESET_TOLERANCE = Object.freeze({ brightness: 3, temperature: 3 });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function brightnessRawFromPercent(percent) {
  const { min, max } = LIGHT_RANGES.brightness;
  return clamp(Math.round((Number(percent) / 100) * max), min, max);
}

export function brightnessPercentFromRaw(raw) {
  return Math.round((Number(raw) / LIGHT_RANGES.brightness.max) * 100);
}

export function temperatureRawFromApp(value) {
  const { min, max } = LIGHT_RANGES.temperature;
  return clamp(Math.round(min + (Number(value) / 255) * (max - min)), min, max);
}

export function temperatureAppFromRaw(raw) {
  const { min, max } = LIGHT_RANGES.temperature;
  return Math.round(((Number(raw) - min) / (max - min)) * 255);
}

export function temperatureRawFromPercent(percent) {
  return temperatureRawFromApp(Math.min(255, Math.max(0, Math.round((Number(percent) / 100) * 255))));
}

export function temperaturePercentFromRaw(raw) {
  return Math.min(100, Math.max(0, Math.round((temperatureAppFromRaw(raw) / 255) * 100)));
}

export const LIGHT_PRESETS = Object.freeze({
  chill: Object.freeze({ brightness: brightnessRawFromPercent(35), temperature: temperatureRawFromPercent(50) }),
  bright: Object.freeze({ brightness: LIGHT_RANGES.brightness.max, temperature: LIGHT_RANGES.temperature.max }),
});

function near(value, target, tolerance) {
  return Number.isFinite(value) && Math.abs(value - target) <= tolerance;
}

function hueToRgb(hue) {
  const segment = 1 - Math.abs((hue / 60) % 2 - 1);
  if (hue < 60) return [1, segment, 0];
  if (hue < 120) return [segment, 1, 0];
  if (hue < 180) return [0, 1, segment];
  if (hue < 240) return [0, segment, 1];
  if (hue < 300) return [segment, 0, 1];
  return [1, 0, segment];
}

export function colorDpForValues(values) {
  return COLOR_DPS.find((code) => Object.hasOwn(values, code)) || null;
}

export function colorScaleForDp(code) {
  return code === "colour_data_v2" ? 1000 : 255;
}

function hsvToRgb({ hue, saturation, intensity }) {
  const chroma = intensity * saturation;
  const match = intensity - chroma;
  const base = hueToRgb(((hue % 360) + 360) % 360);
  return Object.fromEntries(["r", "g", "b"].map((key, index) => [key, Math.round((base[index] * chroma + match) * 255)]));
}

export function hsvFromColorData(value, scale = 1000) {
  try {
    const color = typeof value === "string" ? JSON.parse(value) : value;
    const hue = Number(color?.h);
    const saturation = Number(color?.s) / scale;
    const valuePart = Number(color?.v) / scale;
    if (![hue, saturation, valuePart].every(Number.isFinite)) return null;
    return { hue: Math.round(hue), saturation: Math.round(saturation * 100), intensity: Math.round(valuePart * 100) };
  } catch {
    return null;
  }
}

export function rgbFromColorData(value, scale = 1000) {
  const hsv = hsvFromColorData(value, scale);
  return hsv ? hsvToRgb({ hue: hsv.hue, saturation: hsv.saturation / 100, intensity: hsv.intensity / 100 }) : null;
}

export function colorDataFromHsv({ hue, saturation, intensity }, scale = 1000) {
  const normalizedHue = ((Math.round(Number(hue)) % 360) + 360) % 360;
  const normalizedSaturation = Math.min(100, Math.max(0, Number(saturation)));
  const normalizedIntensity = Math.min(100, Math.max(0, Number(intensity)));
  if (![normalizedHue, normalizedSaturation, normalizedIntensity].every(Number.isFinite)) throw new Error("Expected HSV values");
  return JSON.stringify({
    h: normalizedHue,
    s: Math.max(1, Math.round((normalizedSaturation / 100) * scale)),
    v: Math.max(1, Math.round((normalizedIntensity / 100) * scale)),
  });
}

export function colorDataFromRgb({ r, g, b }, scale = 1000) {
  const channels = [r, g, b].map((channel) => Math.min(255, Math.max(0, Math.round(Number(channel)))));
  if (!channels.every(Number.isFinite)) throw new Error("Expected RGB values");
  const [red, green, blue] = channels.map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return colorDataFromHsv({ hue, saturation: (maximum ? delta / maximum : 0) * 100, intensity: maximum * 100 }, scale);
}

export function presetForState({ on, workMode, brightnessRaw, temperatureRaw }) {
  if (!on || workMode !== "white") return null;
  for (const [name, preset] of Object.entries(LIGHT_PRESETS)) {
    if (near(brightnessRaw, preset.brightness, PRESET_TOLERANCE.brightness)
      && near(temperatureRaw, preset.temperature, PRESET_TOLERANCE.temperature)) return name;
  }
  return null;
}

export function normalizeLightStatus(values) {
  const brightnessRaw = Number(values[LIGHT_DPS.brightness]);
  const temperatureRaw = Number(values[LIGHT_DPS.temperature]);
  const colorDp = colorDpForValues(values);
  const state = {
    on: Boolean(values[LIGHT_DPS.power]),
    workMode: values[LIGHT_DPS.workMode] || null,
    brightnessRaw: Number.isFinite(brightnessRaw) ? brightnessRaw : null,
    temperatureRaw: Number.isFinite(temperatureRaw) ? temperatureRaw : null,
  };
  const colorHsv = colorDp ? hsvFromColorData(values[colorDp], colorScaleForDp(colorDp)) : null;
  return {
    on: state.on,
    brightness: state.brightnessRaw === null ? null : brightnessPercentFromRaw(state.brightnessRaw),
    warmth: state.temperatureRaw === null ? null : temperaturePercentFromRaw(state.temperatureRaw),
    workMode: state.workMode,
    color: colorHsv ? hsvToRgb({ hue: colorHsv.hue, saturation: colorHsv.saturation / 100, intensity: colorHsv.intensity / 100 }) : null,
    colorHsv,
    colorSupported: Boolean(colorDp),
    preset: presetForState(state),
  };
}

export function commandsForPreset(name) {
  const preset = LIGHT_PRESETS[name];
  if (!preset) throw new Error("Unknown light preset");
  return [
    { code: LIGHT_DPS.power, value: true },
    { code: LIGHT_DPS.workMode, value: "white" },
    { code: LIGHT_DPS.brightness, value: preset.brightness },
    { code: LIGHT_DPS.temperature, value: preset.temperature },
  ];
}
