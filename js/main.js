import { renderMonthCalendar } from "./calendar.js";
import { loadWeather, weatherLabel } from "./weather.js";

const TIME_ZONE = "Europe/Brussels";
const WEATHER_REFRESH_MS = 20 * 60 * 1000;
const LIGHT_REFRESH_MS = 30 * 1000;
const PRAYER_REFRESH_MS = 30 * 60 * 1000;
const THEME_KEY = "jdc-theme";
const EDITOR_DRAFT_KEY = "jdc-calendar-editor-draft";
const EDITOR_PROFILES_KEY = "jdc-calendar-editor-profiles";
const WEEKDAYS_JA = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const WEEKDAYS_EN = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS_EN = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const elements = Object.fromEntries(
  [
    "year", "weekday-ja", "weekday-en", "date-small", "hero-date", "day-number", "month-number", "prayer-panel", "prayer-list",
    "month-en", "mini-calendar", "clock", "weather-temp", "weather-condition",
    "weather-high", "weather-low", "weather-wind", "weather-status", "theme-toggle",
    "light-controls", "light-power", "light-chill", "light-color", "light-color-panel", "light-color-wheel", "light-color-handle", "light-color-hex", "light-saturation", "light-saturation-value", "light-intensity", "light-intensity-value", "light-warmth", "light-warmth-value", "light-status",
    "stopwatch", "stopwatch-toggle", "stopwatch-clear",
    "calendar-editor-toggle", "calendar-editor", "calendar-editor-close", "editor-target", "editor-text", "editor-x", "editor-x-value", "editor-y", "editor-y-value", "editor-scale", "editor-scale-value", "editor-width", "editor-width-value", "editor-profile-name", "editor-save-profile", "editor-reset", "editor-profile-list",
  ].map((id) => [id, document.getElementById(id)]),
);

let currentDateKey = "";
let wakeLock = null;
let stopwatchElapsed = 0;
let stopwatchStartedAt = null;
let stopwatchTimer = null;
let lightState = null;
let lightAvailable = false;
let lightPending = false;
let colorPanelOpen = false;
let colorRequestTimer = null;
let colorRequestInFlight = false;
let colorRequestQueued = null;
let colorControls = { hue: 0, saturation: 100, intensity: 100 };
let editorOpen = false;
let editorState = { overrides: {}, text: {} };

const EDITOR_TARGETS = {
  masthead: { selector: '[data-editor-target="masthead"]', textId: "edition-title" },
  weekday: { selector: '[data-editor-target="weekday"]' },
  hero: { selector: '[data-editor-target="hero"]' },
  caption: { selector: '[data-editor-target="caption"]', textId: "hero-caption-text" },
  month: { selector: '[data-editor-target="month"]' },
  weather: { selector: '[data-editor-target="weather"]' },
  footer: { selector: '[data-editor-target="footer"]', textId: "location-detail" },
};
const editorDefaults = { x: 0, y: 0, scale: 100, width: 100 };

function storedJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function editorValues(target) {
  const values = editorState.overrides[target] || {};
  return { ...editorDefaults, ...values };
}

function updateEditorProfileList() {
  const profiles = storedJson(EDITOR_PROFILES_KEY, {});
  const current = elements["editor-profile-list"].value;
  elements["editor-profile-list"].replaceChildren(new Option("CHOOSE A PROFILE", ""));
  for (const name of Object.keys(profiles).sort((left, right) => left.localeCompare(right))) {
    elements["editor-profile-list"].add(new Option(name, name));
  }
  elements["editor-profile-list"].value = profiles[current] ? current : "";
}

function applyEditorState() {
  const sheet = document.querySelector(".calendar-sheet");
  for (const [name, target] of Object.entries(EDITOR_TARGETS)) {
    const node = document.querySelector(target.selector);
    if (!node) continue;
    const values = editorValues(name);
    node.style.setProperty("--editor-x", `${values.x}px`);
    node.style.setProperty("--editor-y", `${values.y}px`);
    node.style.setProperty("--editor-scale", String(values.scale / 100));
    node.style.setProperty("--editor-width", `${values.width}%`);
    if (target.textId) {
      const textNode = document.getElementById(target.textId);
      if (textNode) {
        if (!textNode.dataset.originalText) textNode.dataset.originalText = textNode.textContent;
        textNode.textContent = editorState.text[name] ?? textNode.dataset.originalText;
      }
    }
  }
  sheet.classList.toggle("editor-active", Object.keys(editorState.overrides).length > 0);
}

function saveEditorDraft() {
  try { localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(editorState)); } catch {}
}

function updateEditorFields() {
  const target = elements["editor-target"].value;
  const values = editorValues(target);
  elements["editor-x"].value = values.x;
  elements["editor-y"].value = values.y;
  elements["editor-scale"].value = values.scale;
  elements["editor-width"].value = values.width;
  elements["editor-x-value"].textContent = values.x;
  elements["editor-y-value"].textContent = values.y;
  elements["editor-scale-value"].textContent = `${values.scale}%`;
  elements["editor-width-value"].textContent = `${values.width}%`;
  const textId = EDITOR_TARGETS[target].textId;
  const textNode = textId ? document.getElementById(textId) : null;
  elements["editor-text"].disabled = !textNode;
  elements["editor-text"].value = textNode ? (editorState.text[target] ?? textNode.dataset.originalText ?? textNode.textContent) : "";
}

function setEditorOpen(open) {
  editorOpen = open;
  elements["calendar-editor"].hidden = !open;
  elements["calendar-editor-toggle"].setAttribute("aria-expanded", String(open));
  if (open) {
    updateEditorProfileList();
    updateEditorFields();
    elements["editor-target"].focus({ preventScroll: true });
  }
}

function updateEditorValue(key, value) {
  const target = elements["editor-target"].value;
  editorState.overrides[target] = { ...editorValues(target), [key]: Number(value) };
  applyEditorState();
  saveEditorDraft();
  updateEditorFields();
}

function resetEditor() {
  editorState = { overrides: {}, text: {} };
  try { localStorage.removeItem(EDITOR_DRAFT_KEY); } catch {}
  applyEditorState();
  updateEditorFields();
}

function saveEditorProfile() {
  const name = elements["editor-profile-name"].value.trim().toUpperCase();
  if (!name) {
    elements["editor-profile-name"].focus({ preventScroll: true });
    return;
  }
  const profiles = storedJson(EDITOR_PROFILES_KEY, {});
  profiles[name] = structuredClone(editorState);
  try { localStorage.setItem(EDITOR_PROFILES_KEY, JSON.stringify(profiles)); } catch {}
  elements["editor-profile-name"].value = "";
  updateEditorProfileList();
  elements["editor-profile-list"].value = name;
}

function loadEditorProfile(name) {
  const profile = storedJson(EDITOR_PROFILES_KEY, {})[name];
  if (!profile) return;
  editorState = {
    overrides: profile.overrides && typeof profile.overrides === "object" ? profile.overrides : {},
    text: profile.text && typeof profile.text === "object" ? profile.text : {},
  };
  applyEditorState();
  saveEditorDraft();
  updateEditorFields();
}

function showLightState(state, available = true) {
  lightState = state;
  lightAvailable = available;
  const on = available && Boolean(state?.on);
  const disabled = !available || lightPending;
  elements["light-power"].textContent = on ? "OFF" : "ON";
  elements["light-power"].setAttribute("aria-label", on ? "Turn light off" : "Turn light on");
  elements["light-power"].setAttribute("aria-pressed", String(on));
  const activePreset = on && ["chill", "bright"].includes(state?.preset) ? state.preset : null;
  elements["light-chill"].textContent = (activePreset || "chill").toUpperCase();
  elements["light-chill"].setAttribute("aria-pressed", String(Boolean(activePreset)));
  elements["light-chill"].setAttribute("aria-label", activePreset
    ? `Switch from ${activePreset.toUpperCase()} to ${activePreset === "chill" ? "BRIGHT" : "CHILL"}`
    : "Set CHILL light profile");
  elements["light-color"].setAttribute("aria-pressed", String(on && state?.workMode === "colour"));
  elements["light-color"].disabled = disabled || !state?.colorSupported;
  for (const id of ["light-power", "light-chill"]) elements[id].disabled = disabled;
  if (state?.colorHsv) setColorControls(state.colorHsv);
  if (Number.isFinite(state?.brightness) && state?.workMode !== "colour") setRangeValue("light-intensity", state.brightness);
  if (Number.isFinite(state?.warmth)) setRangeValue("light-warmth", state.warmth);
  elements["light-controls"].classList.toggle("is-unavailable", !available);
  elements["light-status"].textContent = available ? "" : "—";
}

function setLightPending(pending) {
  lightPending = pending;
  elements["light-controls"].classList.toggle("is-pending", pending);
  elements["light-controls"].setAttribute("aria-busy", String(pending));
  showLightState(lightState, lightAvailable);
}

async function requestLight(path, body = null) {
  const response = await fetch(path, {
    method: path === "/api/light/status" ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "Bridge unavailable");
  return payload;
}

function setRangeValue(id, value) {
  const rounded = Math.round(value);
  elements[id].value = String(rounded);
  elements[`${id}-value`].textContent = `${rounded}%`;
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function rgbForHue(hue, saturation = 100, intensity = 100) {
  const chroma = (saturation / 100) * (intensity / 100);
  const match = (intensity / 100) - chroma;
  const segment = 1 - Math.abs((hue / 60) % 2 - 1);
  let rgb = [chroma, chroma * segment, 0];
  if (hue >= 60 && hue < 120) rgb = [chroma * segment, chroma, 0];
  else if (hue >= 120 && hue < 180) rgb = [0, chroma, chroma * segment];
  else if (hue >= 180 && hue < 240) rgb = [0, chroma * segment, chroma];
  else if (hue >= 240 && hue < 300) rgb = [chroma * segment, 0, chroma];
  else if (hue >= 300) rgb = [chroma, 0, chroma * segment];
  return Object.fromEntries(["r", "g", "b"].map((key, index) => [key, Math.round((rgb[index] + match) * 255)]));
}

function setColorControls(next) {
  colorControls = {
    hue: Math.round(Number(next.hue) || 0) % 360,
    saturation: Math.min(100, Math.max(0, Math.round(Number(next.saturation) || 0))),
    intensity: Math.min(100, Math.max(0, Math.round(Number(next.intensity) || 0))),
  };
  const { hue, saturation, intensity } = colorControls;
  const color = rgbForHue(hue, saturation, intensity);
  const radius = Math.max(0, elements["light-color-wheel"].clientWidth / 2 - 8);
  const radians = (hue - 90) * Math.PI / 180;
  elements["light-color-wheel"].setAttribute("aria-valuenow", String(Math.round(hue)));
  elements["light-color-wheel"].setAttribute("aria-valuetext", rgbToHex(color));
  elements["light-color-hex"].textContent = rgbToHex(color);
  elements["light-color-handle"].style.transform = `translate(calc(-50% + ${Math.cos(radians) * radius}px), calc(-50% + ${Math.sin(radians) * radius}px))`;
  elements["light-color-handle"].style.background = rgbToHex(color);
  setRangeValue("light-saturation", saturation);
  setRangeValue("light-intensity", intensity);
}

function setColorPanel(open, focus = false) {
  colorPanelOpen = open;
  elements["light-color-panel"].hidden = !open;
  elements["light-color"].setAttribute("aria-expanded", String(open));
  if (open && focus) elements["light-color-wheel"].focus({ preventScroll: true });
}

function queueColorCommand(path, body, immediate = false) {
  colorRequestQueued = { path, body };
  window.clearTimeout(colorRequestTimer);
  if (immediate) void flushColorCommand();
  else colorRequestTimer = window.setTimeout(() => void flushColorCommand(), 140);
}

async function flushColorCommand() {
  if (colorRequestInFlight || !colorRequestQueued) return;
  const command = colorRequestQueued;
  colorRequestQueued = null;
  colorRequestInFlight = true;
  try {
    showLightState(await requestLight(command.path, command.body));
  } catch (error) {
    elements["light-controls"].dataset.lightError = error instanceof Error ? error.message : "Bridge unavailable";
    elements["light-status"].textContent = "—";
  } finally {
    colorRequestInFlight = false;
    if (colorRequestQueued) void flushColorCommand();
  }
}

function applyWheelEvent(event, final = false) {
  const bounds = elements["light-color-wheel"].getBoundingClientRect();
  const angle = (Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI + 450) % 360;
  setColorControls({ ...colorControls, hue: angle });
  queueColorCommand("/api/light/color", { hue: Math.round(angle) }, final);
}

async function refreshLight(preserveOnError = false) {
  if (lightPending) return false;
  try {
    showLightState(await requestLight("/api/light/status"));
    return true;
  } catch {
    if (!preserveOnError) showLightState(null, false);
    return false;
  }
}

async function commandLight(path) {
  if (lightPending) return;
  const previousState = lightState;
  const previousAvailable = lightAvailable;
  setLightPending(true);
  try {
    showLightState(await requestLight(path));
    await new Promise((resolve) => setTimeout(resolve, 500));
    setLightPending(false);
    await refreshLight(true);
  } catch {
    showLightState(previousState, previousAvailable);
  } finally {
    setLightPending(false);
  }
}

function applyTheme(theme, persist = false) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  elements["theme-toggle"].setAttribute("aria-pressed", String(isDark));
  elements["theme-toggle"].setAttribute("aria-label", isDark ? "Enable light mode" : "Enable dark mode");
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#080807" : "#f5f2ea";
  if (persist) {
    try { localStorage.setItem(THEME_KEY, isDark ? "dark" : "light"); } catch {}
  }
}

function brusselsDateParts(date = new Date()) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

function renderDate(parts, animate = false) {
  const { year, month, day, weekday } = parts;
  const weekdayEn = WEEKDAYS_EN[weekday];
  elements.year.textContent = year;
  elements["weekday-ja"].textContent = WEEKDAYS_JA[weekday];
  elements["weekday-en"].textContent = weekdayEn;
  elements["weekday-en"].dataset.label = weekdayEn;
  elements["date-small"].textContent = `${day} · ${MONTHS_EN[month - 1]}`;
  elements["day-number"].textContent = day;
  const digitCount = String(day).length;
  elements["hero-date"].dataset.digits = digitCount;
  elements["day-number"].dataset.digits = digitCount;
  elements["month-number"].textContent = month;
  elements["month-en"].textContent = MONTHS_EN[month - 1];
  renderMonthCalendar(elements["mini-calendar"], year, month, day);

  if (animate) {
    elements["day-number"].classList.remove("date-changed");
    requestAnimationFrame(() => elements["day-number"].classList.add("date-changed"));
  }
}

function renderClock(value) {
  elements.clock.replaceChildren(...[...value].map((character) => {
    const slot = document.createElement("span");
    slot.className = character === ":" ? "clock-slot clock-separator" : "clock-slot";
    slot.textContent = character;
    return slot;
  }));
  elements.clock.dateTime = value;
}

function tick() {
  const now = new Date();
  const parts = brusselsDateParts(now);
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  renderClock(timeFormatter.format(now));
  if (dateKey !== currentDateKey) {
    renderDate(parts, currentDateKey !== "");
    currentDateKey = dateKey;
  }
}

function formatStopwatch(milliseconds) {
  const tenths = Math.floor(milliseconds / 100) % 10;
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const prefix = hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` : String(minutes).padStart(2, "0");
  return `${prefix}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function stopwatchValue() {
  return stopwatchElapsed + (stopwatchStartedAt === null ? 0 : performance.now() - stopwatchStartedAt);
}

function renderStopwatch() {
  const value = stopwatchValue();
  elements.stopwatch.textContent = formatStopwatch(value);
  elements.stopwatch.dateTime = `PT${Math.floor(value / 1000)}S`;
  elements.stopwatch.hidden = value === 0;
  elements["stopwatch-clear"].disabled = value === 0;
}

function setStopwatchRunning(running) {
  if (running) {
    stopwatchStartedAt = performance.now();
    stopwatchTimer = window.setInterval(renderStopwatch, 100);
  } else {
    stopwatchElapsed = stopwatchValue();
    stopwatchStartedAt = null;
    window.clearInterval(stopwatchTimer);
    stopwatchTimer = null;
  }
  elements["stopwatch-toggle"].textContent = running ? "PAUSE" : "START";
  elements["stopwatch-toggle"].setAttribute("aria-pressed", String(running));
  elements["stopwatch-toggle"].setAttribute("aria-label", running ? "Pause stopwatch" : "Start stopwatch");
  renderStopwatch();
}

function toggleStopwatch() {
  setStopwatchRunning(stopwatchStartedAt === null);
}

function clearStopwatch() {
  if (stopwatchStartedAt !== null) setStopwatchRunning(false);
  stopwatchElapsed = 0;
  renderStopwatch();
}

function showWeather({ weather, cached }) {
  const rounded = (value) => `${Math.round(value)}°`;
  elements["weather-temp"].textContent = rounded(weather.temperature);
  elements["weather-condition"].textContent = weatherLabel(weather.code);
  elements["weather-high"].textContent = rounded(weather.high);
  elements["weather-low"].textContent = rounded(weather.low);
  elements["weather-wind"].textContent = `${Math.round(weather.wind)} km/h`;
  elements["weather-status"].textContent = cached ? "LAST AVAILABLE READING" : "UPDATED · BRUSSELS";
  const weatherMain = document.querySelector(".weather-main");
  weatherMain.classList.remove("updated");
  requestAnimationFrame(() => weatherMain.classList.add("updated"));
}

async function refreshWeather() {
  try {
    showWeather(await loadWeather());
  } catch {
    elements["weather-status"].textContent = "WEATHER TEMPORARILY UNAVAILABLE";
  }
}

async function refreshPrayers() {
  try {
    const response = await fetch("/api/prayers", { cache: "no-store" });
    if (!response.ok) throw new Error("Prayer times unavailable");
    const { prayers } = await response.json();
    const rows = prayers.map(({ label, time, iqama }) => {
      const [timeHours, timeMinutes] = time.split(":").map(Number);
      const [iqamaHours, iqamaMinutes] = iqama.split(":").map(Number);
      const prayerMinutes = timeHours * 60 + timeMinutes;
      const iqamaTotal = iqamaHours * 60 + iqamaMinutes;
      const waitMinutes = (iqamaTotal - prayerMinutes + 1440) % 1440;
      const row = document.createElement("div");
      for (const value of [label, time, `+${waitMinutes}`]) {
        const span = document.createElement("span");
        span.textContent = value;
        row.append(span);
      }
      return row;
    });
    elements["prayer-list"].replaceChildren(...rows);
    elements["prayer-panel"].hidden = false;
  } catch {
    if (!elements["prayer-list"].children.length) elements["prayer-panel"].hidden = true;
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; }, { once: true });
  } catch {
    wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !wakeLock) requestWakeLock();
});

applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const savedEditorDraft = storedJson(EDITOR_DRAFT_KEY, {});
editorState = {
  overrides: savedEditorDraft.overrides && typeof savedEditorDraft.overrides === "object" ? savedEditorDraft.overrides : {},
  text: savedEditorDraft.text && typeof savedEditorDraft.text === "object" ? savedEditorDraft.text : {},
};
applyEditorState();
elements["theme-toggle"].addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});
elements["calendar-editor-toggle"].addEventListener("click", () => setEditorOpen(!editorOpen));
elements["calendar-editor-close"].addEventListener("click", () => {
  setEditorOpen(false);
  elements["calendar-editor-toggle"].focus({ preventScroll: true });
});
elements["editor-target"].addEventListener("change", updateEditorFields);
for (const [id, key] of [["editor-x", "x"], ["editor-y", "y"], ["editor-scale", "scale"], ["editor-width", "width"]]) {
  elements[id].addEventListener("input", () => updateEditorValue(key, elements[id].value));
}
elements["editor-text"].addEventListener("input", () => {
  const target = elements["editor-target"].value;
  if (!EDITOR_TARGETS[target].textId) return;
  editorState.text[target] = elements["editor-text"].value;
  applyEditorState();
  saveEditorDraft();
});
elements["editor-save-profile"].addEventListener("click", saveEditorProfile);
elements["editor-reset"].addEventListener("click", resetEditor);
elements["editor-profile-list"].addEventListener("change", () => loadEditorProfile(elements["editor-profile-list"].value));
elements["light-power"].addEventListener("click", () => commandLight("/api/light/toggle"));
elements["light-chill"].addEventListener("click", () => {
  const nextPreset = lightState?.preset === "chill" ? "bright" : "chill";
  commandLight(`/api/light/preset/${nextPreset}`);
});
elements["light-color"].addEventListener("click", async () => {
  const open = !colorPanelOpen;
  setColorPanel(open, open);
  if (open) await refreshLight(true);
});
for (const [id, path, key] of [["light-saturation", "/api/light/color", "saturation"], ["light-intensity", "/api/light/brightness", "brightness"], ["light-warmth", "/api/light/warmth", "warmth"]]) {
  elements[id].addEventListener("input", () => {
    const value = Number(elements[id].value);
    setRangeValue(id, value);
    if (id === "light-saturation") setColorControls({ ...colorControls, saturation: value });
    if (id === "light-intensity" && lightState?.workMode === "colour") setColorControls({ ...colorControls, intensity: value });
    queueColorCommand(path, { [key]: Number(elements[id].value) });
  });
  elements[id].addEventListener("change", () => queueColorCommand(path, { [key]: Number(elements[id].value) }, true));
}
elements["light-color-wheel"].addEventListener("pointerdown", (event) => {
  elements["light-color-wheel"].setPointerCapture(event.pointerId);
  applyWheelEvent(event);
});
elements["light-color-wheel"].addEventListener("pointermove", (event) => {
  if (elements["light-color-wheel"].hasPointerCapture(event.pointerId)) applyWheelEvent(event);
});
for (const type of ["pointerup", "pointercancel"]) {
  elements["light-color-wheel"].addEventListener(type, (event) => {
    if (elements["light-color-wheel"].hasPointerCapture(event.pointerId)) {
      applyWheelEvent(event, true);
      elements["light-color-wheel"].releasePointerCapture(event.pointerId);
    }
  });
}
elements["light-color-wheel"].addEventListener("keydown", (event) => {
  const current = Number(elements["light-color-wheel"].getAttribute("aria-valuenow") || 0);
  const step = event.shiftKey ? 15 : 3;
  if (!["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const hue = event.key === "Home" ? 0 : event.key === "End" ? 359 : (current + (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step) + 360) % 360;
  setColorControls({ ...colorControls, hue });
  queueColorCommand("/api/light/color", { hue }, true);
});
document.addEventListener("pointerdown", (event) => {
  if (colorPanelOpen && !elements["light-controls"].contains(event.target)) setColorPanel(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && colorPanelOpen) {
    setColorPanel(false);
    elements["light-color"].focus({ preventScroll: true });
    return;
  }
  if (event.key === "Escape" && editorOpen) {
    setEditorOpen(false);
    elements["calendar-editor-toggle"].focus({ preventScroll: true });
  }
});
elements["stopwatch-toggle"].addEventListener("click", toggleStopwatch);
elements["stopwatch-clear"].addEventListener("click", clearStopwatch);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

tick();
setInterval(tick, 1000);
refreshWeather();
setInterval(refreshWeather, WEATHER_REFRESH_MS);
refreshPrayers();
setInterval(refreshPrayers, PRAYER_REFRESH_MS);
refreshLight();
setInterval(refreshLight, LIGHT_REFRESH_MS);
requestWakeLock();
