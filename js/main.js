import { renderMonthCalendar } from "./calendar.js";
import { loadWeather, weatherLabel } from "./weather.js";

const TIME_ZONE = "Europe/Brussels";
const WEATHER_REFRESH_MS = 20 * 60 * 1000;
const LIGHT_REFRESH_MS = 30 * 1000;
const PRAYER_REFRESH_MS = 30 * 60 * 1000;
const THEME_KEY = "jdc-theme";
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
    "light-controls", "light-power", "light-chill", "light-bright", "light-status",
    "stopwatch", "stopwatch-toggle", "stopwatch-clear",
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

function showLightState(state, available = true) {
  lightState = state;
  lightAvailable = available;
  const on = available && Boolean(state?.on);
  const disabled = !available || lightPending;
  elements["light-power"].textContent = on ? "OFF" : "ON";
  elements["light-power"].setAttribute("aria-label", on ? "Turn light off" : "Turn light on");
  elements["light-power"].setAttribute("aria-pressed", String(on));
  elements["light-chill"].setAttribute("aria-pressed", String(on && state?.preset === "chill"));
  elements["light-bright"].setAttribute("aria-pressed", String(on && state?.preset === "bright"));
  for (const id of ["light-power", "light-chill", "light-bright"]) elements[id].disabled = disabled;
  elements["light-controls"].classList.toggle("is-unavailable", !available);
  elements["light-status"].textContent = available ? "" : "—";
}

function setLightPending(pending) {
  lightPending = pending;
  elements["light-controls"].classList.toggle("is-pending", pending);
  elements["light-controls"].setAttribute("aria-busy", String(pending));
  showLightState(lightState, lightAvailable);
}

async function requestLight(path) {
  const response = await fetch(path, {
    method: path === "/api/light/status" ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Bridge unavailable");
  return response.json();
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
elements["theme-toggle"].addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});
elements["light-power"].addEventListener("click", () => commandLight("/api/light/toggle"));
elements["light-chill"].addEventListener("click", () => commandLight("/api/light/preset/chill"));
elements["light-bright"].addEventListener("click", () => commandLight("/api/light/preset/bright"));
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
