const PRAYERS = [
  ["fajr", "F", 0],
  ["dhuhr", "D", 2],
  ["asr", "A", 3],
  ["maghrib", "M", 4],
  ["isha", "I", 5],
];

function brusselsDateParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

export function parseMawaqitPrayers(html, date = new Date()) {
  const match = html.match(/let confData = (\{[\s\S]*?\});\s*let lang/);
  if (!match) throw new Error("Mawaqit data not found");
  const data = JSON.parse(match[1]);
  const { year, month, day } = brusselsDateParts(date);
  const dailyTimes = data.calendar?.[month - 1]?.[String(day)];
  const dailyIqama = data.iqamaCalendar?.[month - 1]?.[String(day)];
  if (!Array.isArray(dailyTimes) || dailyTimes.length < 6 || !Array.isArray(dailyIqama) || dailyIqama.length < 5) {
    throw new Error("Mawaqit daily schedule unavailable");
  }
  const prayers = PRAYERS.map(([key, label, timeIndex], iqamaIndex) => ({
    key, label, time: dailyTimes[timeIndex], iqama: dailyIqama[iqamaIndex],
  }));
  if (prayers.some(({ time, iqama }) => !/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(iqama))) {
    throw new Error("Invalid Mawaqit prayer time");
  }
  return {
    mosque: data.name || "Masjid AL-ABIDIN", mosqueId: 46267, source: "Mawaqit",
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    updatedAt: new Date().toISOString(), prayers,
  };
}
