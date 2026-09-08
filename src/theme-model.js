// { dateKey, hour } of `ms` as observed in Europe/Brussels, DST-aware via Intl.
export function brusselsDateInfo(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { dateKey: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour) };
}

export const THEME_AUTO_LIGHT_HOUR = 8;

// The shared theme auto-flips dark -> light once it's past THEME_AUTO_LIGHT_HOUR
// in Brussels, unless it was set dark at/after that hour today (a fresh manual
// choice made after the flip time is honoured, not immediately reverted).
export function effectiveTheme(stored, nowMs = Date.now()) {
  const value = stored?.value === "dark" ? "dark" : "light";
  if (value !== "dark") return value;
  const now = brusselsDateInfo(nowMs);
  if (now.hour < THEME_AUTO_LIGHT_HOUR) return "dark";
  const setAt = brusselsDateInfo(stored.updatedAt || 0);
  if (setAt.dateKey !== now.dateKey || setAt.hour < THEME_AUTO_LIGHT_HOUR) return "light";
  return "dark";
}
