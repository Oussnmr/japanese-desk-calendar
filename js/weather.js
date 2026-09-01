const ENDPOINT = new URL("https://api.open-meteo.com/v1/forecast");
ENDPOINT.search = new URLSearchParams({
  latitude: "50.8503",
  longitude: "4.3517",
  current: "temperature_2m,weather_code,wind_speed_10m",
  daily: "temperature_2m_max,temperature_2m_min",
  temperature_unit: "celsius",
  wind_speed_unit: "kmh",
  timezone: "Europe/Brussels",
  forecast_days: "1",
}).toString();

const CACHE_KEY = "jdc-weather-v1";

export function weatherLabel(code) {
  if (code === 0) return "CLEAR";
  if ([1, 2].includes(code)) return "FAIR";
  if (code === 3) return "CLOUDY";
  if ([45, 48].includes(code)) return "FOG";
  if (code >= 51 && code <= 67) return "RAIN";
  if (code >= 71 && code <= 77) return "SNOW";
  if (code >= 80 && code <= 82) return "SHOWERS";
  if (code >= 85 && code <= 86) return "SNOW";
  if (code >= 95) return "THUNDER";
  return "VARIABLE";
}

function normalize(payload) {
  const weather = {
    temperature: payload.current?.temperature_2m,
    code: payload.current?.weather_code,
    wind: payload.current?.wind_speed_10m,
    high: payload.daily?.temperature_2m_max?.[0],
    low: payload.daily?.temperature_2m_min?.[0],
    observedAt: payload.current?.time,
    savedAt: Date.now(),
  };
  if (Object.values(weather).slice(0, 5).some((value) => !Number.isFinite(value))) {
    throw new Error("Incomplete weather response");
  }
  return weather;
}

function readCachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    return cached && Number.isFinite(cached.temperature) ? cached : null;
  } catch {
    return null;
  }
}

export async function loadWeather() {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
    const weather = normalize(await response.json());
    localStorage.setItem(CACHE_KEY, JSON.stringify(weather));
    return { weather, cached: false };
  } catch (error) {
    const cached = readCachedWeather();
    if (cached) return { weather: cached, cached: true };
    throw error;
  }
}
