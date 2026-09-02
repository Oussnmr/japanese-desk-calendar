export const LIGHT_DPS = Object.freeze({
  power: "switch_led",
  workMode: "work_mode",
  brightness: "bright_value",
  temperature: "temp_value",
});

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

export const LIGHT_PRESETS = Object.freeze({
  chill: Object.freeze({ brightness: brightnessRawFromPercent(25), temperature: temperatureRawFromApp(206) }),
  bright: Object.freeze({ brightness: LIGHT_RANGES.brightness.max, temperature: LIGHT_RANGES.temperature.max }),
});

function near(value, target, tolerance) {
  return Number.isFinite(value) && Math.abs(value - target) <= tolerance;
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
  const state = {
    on: Boolean(values[LIGHT_DPS.power]),
    workMode: values[LIGHT_DPS.workMode] || null,
    brightnessRaw: Number.isFinite(brightnessRaw) ? brightnessRaw : null,
    temperatureRaw: Number.isFinite(temperatureRaw) ? temperatureRaw : null,
  };
  return {
    on: state.on,
    brightness: state.brightnessRaw === null ? null : brightnessPercentFromRaw(state.brightnessRaw),
    temperature: state.temperatureRaw === null ? null : temperatureAppFromRaw(state.temperatureRaw),
    workMode: state.workMode,
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
