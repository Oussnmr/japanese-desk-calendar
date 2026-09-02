import test from "node:test";
import assert from "node:assert/strict";
import { parseMawaqitPrayers } from "../src/prayer-model.js";

const html = `<script>let confData = ${JSON.stringify({
  name: "Masjid AL-ABIDIN",
  calendar: [{}, {}, {}, {}, {}, {}, {}, {}, { "2": ["05:28", "06:58", "13:42", "17:28", "20:28", "21:58"] }],
  iqamaCalendar: [{}, {}, {}, {}, {}, {}, {}, {}, { "2": ["05:40", "14:00", "17:50", "20:28", "22:10"] }],
})}; let lang = 'fr';</script>`;

test("normalizes the five Al-Abidin prayers and iqamas", () => {
  assert.deepEqual(parseMawaqitPrayers(html, new Date("2026-09-02T12:00:00Z")).prayers, [
    { key: "fajr", label: "F", time: "05:28", iqama: "05:40" },
    { key: "dhuhr", label: "D", time: "13:42", iqama: "14:00" },
    { key: "asr", label: "A", time: "17:28", iqama: "17:50" },
    { key: "maghrib", label: "M", time: "20:28", iqama: "20:28" },
    { key: "isha", label: "I", time: "21:58", iqama: "22:10" },
  ]);
});

test("rejects an unavailable source", () => {
  assert.throws(() => parseMawaqitPrayers("<html></html>"), /not found/);
});
