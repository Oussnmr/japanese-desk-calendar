// { dateKey, minuteOfDay } of `ms` as observed in Europe/Brussels, DST-aware via Intl.
export function brusselsMinuteInfo(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { dateKey: `${map.year}-${map.month}-${map.day}`, minuteOfDay: Number(map.hour) * 60 + Number(map.minute) };
}

export const DEFAULT_SCHEDULE = Object.freeze({ dayMinute: 8 * 60, nightMinute: 20 * 60 });

export function sanitizeSchedule(value) {
  const dayMinute = Number(value?.dayMinute);
  const nightMinute = Number(value?.nightMinute);
  const valid = (minute) => Number.isInteger(minute) && minute >= 0 && minute < 24 * 60;
  return {
    dayMinute: valid(dayMinute) ? dayMinute : DEFAULT_SCHEDULE.dayMinute,
    nightMinute: valid(nightMinute) ? nightMinute : DEFAULT_SCHEDULE.nightMinute,
  };
}

// Which side of the daily day/night schedule `minuteOfDay` falls on. Handles
// either ordering of the two boundaries (day-then-night or night-then-day).
function zoneAt(minuteOfDay, dayMinute, nightMinute) {
  if (dayMinute === nightMinute) return "light";
  if (dayMinute < nightMinute) return minuteOfDay >= dayMinute && minuteOfDay < nightMinute ? "light" : "dark";
  return minuteOfDay >= nightMinute && minuteOfDay < dayMinute ? "dark" : "light";
}

// True if a day or night boundary fell strictly after `updated` and at/before
// `now`. A day-difference is treated as "yes" without walking every date in
// between - close enough for a personal calendar, and avoids reconstructing
// absolute timestamps (and their DST offsets) for each boundary.
function boundaryCrossed(updated, now, dayMinute, nightMinute) {
  if (updated.dateKey !== now.dateKey) return true;
  const crossed = (boundary) => boundary > updated.minuteOfDay && boundary <= now.minuteOfDay;
  return crossed(dayMinute) || crossed(nightMinute);
}

// The shared theme follows a daily day/night schedule (see DEFAULT_SCHEDULE),
// but a manual choice is honoured until the next scheduled boundary actually
// passes - toggling the button mid-day isn't instantly overridden.
export function effectiveTheme(stored, schedule = DEFAULT_SCHEDULE, nowMs = Date.now()) {
  const { dayMinute, nightMinute } = sanitizeSchedule(schedule);
  const now = brusselsMinuteInfo(nowMs);
  const scheduledNow = zoneAt(now.minuteOfDay, dayMinute, nightMinute);
  if (stored?.value !== "dark" && stored?.value !== "light") return scheduledNow;
  const updated = brusselsMinuteInfo(stored.updatedAt || 0);
  if (boundaryCrossed(updated, now, dayMinute, nightMinute)) return scheduledNow;
  return stored.value;
}
