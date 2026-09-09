import {
  LIGHT_DPS, brightnessRawFromPercent, colorDataFromHsv, colorDpForValues, colorScaleForDp,
  commandsForPreset, hsvFromColorData, normalizeLightStatus, temperatureRawFromPercent,
} from "./light-model.js";
import { parseMawaqitPrayers } from "./prayer-model.js";
import { normalizeProfileName, profileTooLarge, sanitizeProfile, sanitizeProfileMap } from "./profile-model.js";
import { findPlugSwitchCode, normalizePlugStatus } from "./plug-model.js";
import { effectiveTheme, sanitizeSchedule } from "./theme-model.js";

let prayerCache = null;
const PRAYER_URL = "https://mawaqit.net/fr/masjid-al-abidin-bruxelles-1000-belgium";
const PRAYER_CACHE_MS = 15 * 60 * 1000;
const PROFILES_KEY = "editor-profiles";
const THEME_KEY = "theme";
const THEME_SCHEDULE_KEY = "theme-schedule";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function bridgeConfigured(env) {
  return ["BRIDGE_URL", "BRIDGE_TOKEN", "LIGHT_ACCESS_TOKEN"].every((name) => Boolean(env[name]));
}

function configured(env) {
  return bridgeConfigured(env) && Boolean(env.TUYA_DEVICE_ID);
}

// Each entry maps a URL segment (/api/plug/<name>/...) to the Worker secret
// holding that device's Tuya id. Add a line here plus the matching secret to
// wire up another plug; the route stays disabled (503) until both exist.
const PLUGS = Object.freeze({
  led: "TUYA_DEVICE_ID_PLUG_LED",
  lampe: "TUYA_DEVICE_ID_PLUG_LAMPE",
  multiprises: "TUYA_DEVICE_ID_PLUG_MULTIPRISES",
  projecteur: "TUYA_DEVICE_ID_PLUG_PROJECTEUR",
});

function plugDeviceId(env, name) {
  const secretName = PLUGS[name];
  return secretName ? env[secretName] || null : null;
}

function equalSecrets(left = "", right = "") {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function cookie(request, name) {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function authorized(request, env) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const session = cookie(request, "jdc_light") || "";
  return (bearer.length > 0 && equalSecrets(bearer, env.LIGHT_ACCESS_TOKEN))
    || (session.length > 0 && equalSecrets(session, env.LIGHT_ACCESS_TOKEN));
}

// Talks to the local Tuya bridge (see bridge/README.md) over the tunnel,
// never to Tuya Cloud directly. `path` keeps the Tuya-Cloud-shaped form
// callers already use (/v1.0/iot-03/devices/<id>/status|commands) purely so
// none of them needed to change when this stopped being Tuya Cloud -
// only the device id and the status/commands suffix are actually used.
async function deviceRequest(env, path, { method = "GET", body = null } = {}) {
  const match = path.match(/\/devices\/([^/]+)\/(status|commands)$/);
  if (!match) throw new Error(`Unsupported device path: ${path}`);
  const [, deviceId, action] = match;
  const response = await fetch(`${env.BRIDGE_URL}/device/${deviceId}/${action}`, {
    method,
    headers: {
      authorization: `Bearer ${env.BRIDGE_TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.msg || "Bridge request failed");
  return payload.result;
}

async function lightStatus(env) {
  const result = await deviceRequest(env, `/v1.0/iot-03/devices/${env.TUYA_DEVICE_ID}/status`);
  const values = Object.fromEntries(result.map((item) => [item.code, item.value]));
  return normalizeLightStatus(values);
}

async function sendLightCommands(env, commands, confirmed) {
  await deviceRequest(env, `/v1.0/iot-03/devices/${env.TUYA_DEVICE_ID}/commands`, {
    method: "POST",
    body: { commands },
  });
  let state = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    state = await lightStatus(env);
    if (confirmed(state)) return state;
  }
  throw new Error("Light state confirmation timed out");
}

async function setLight(env, on) {
  return sendLightCommands(
    env,
    [{ code: LIGHT_DPS.power, value: on }],
    (state) => state.on === on,
  );
}

async function toggleLight(env) {
  const state = await lightStatus(env);
  return setLight(env, !state.on);
}

async function setLightPreset(env, name) {
  return sendLightCommands(env, commandsForPreset(name), (state) => state.preset === name);
}

async function setLightColor(env, controls) {
  const result = await deviceRequest(env, `/v1.0/iot-03/devices/${env.TUYA_DEVICE_ID}/status`);
  const values = Object.fromEntries(result.map((item) => [item.code, item.value]));
  const colorDp = colorDpForValues(values);
  if (!colorDp) throw new Error("Light colour control is unsupported");
  const current = hsvFromColorData(values[colorDp], colorScaleForDp(colorDp)) || { hue: 0, saturation: 100, intensity: 100 };
  const color = {
    hue: controls.hue === undefined ? current.hue : controls.hue,
    saturation: controls.saturation === undefined ? current.saturation : controls.saturation,
    intensity: controls.intensity === undefined ? current.intensity : controls.intensity,
  };
  return sendLightCommands(env, [
    { code: LIGHT_DPS.power, value: true },
    { code: LIGHT_DPS.workMode, value: "colour" },
    { code: colorDp, value: colorDataFromHsv(color, colorScaleForDp(colorDp)) },
  ], (state) => state.on && state.workMode === "colour");
}

async function setLightBrightness(env, brightness) {
  if (!Number.isFinite(Number(brightness))) throw new Error("Invalid brightness");
  const result = await deviceRequest(env, `/v1.0/iot-03/devices/${env.TUYA_DEVICE_ID}/status`);
  const values = Object.fromEntries(result.map((item) => [item.code, item.value]));
  const colorDp = colorDpForValues(values);
  const current = colorDp ? hsvFromColorData(values[colorDp], colorScaleForDp(colorDp)) : null;
  if (values[LIGHT_DPS.workMode] === "colour" && colorDp && current) {
    return sendLightCommands(env, [
      { code: LIGHT_DPS.power, value: true },
      { code: LIGHT_DPS.workMode, value: "colour" },
      { code: colorDp, value: colorDataFromHsv({ ...current, intensity: brightness }, colorScaleForDp(colorDp)) },
    ], (state) => state.on && state.workMode === "colour" && Math.abs(Number(state.colorHsv?.intensity) - Number(brightness)) <= 2);
  }
  const raw = brightnessRawFromPercent(brightness);
  return sendLightCommands(env, [
    { code: LIGHT_DPS.power, value: true },
    { code: LIGHT_DPS.brightness, value: raw },
  ], (state) => state.on && Math.abs(Number(state.brightness) - Number(brightness)) <= 2);
}

async function setLightWarmth(env, warmth) {
  if (!Number.isFinite(Number(warmth))) throw new Error("Invalid warmth");
  const raw = temperatureRawFromPercent(warmth);
  return sendLightCommands(env, [
    { code: LIGHT_DPS.power, value: true },
    { code: LIGHT_DPS.workMode, value: "white" },
    { code: LIGHT_DPS.temperature, value: raw },
  ], (state) => state.on && state.workMode === "white" && Math.abs(Number(state.warmth) - Number(warmth)) <= 2);
}

async function plugValues(env, deviceId) {
  const result = await deviceRequest(env, `/v1.0/iot-03/devices/${deviceId}/status`);
  return Object.fromEntries(result.map((item) => [item.code, item.value]));
}

async function plugStatus(env, deviceId) {
  return normalizePlugStatus(await plugValues(env, deviceId));
}

async function setPlug(env, deviceId, on) {
  const switchCode = findPlugSwitchCode(await plugValues(env, deviceId));
  if (!switchCode) throw new Error("Plug switch is unsupported");
  await deviceRequest(env, `/v1.0/iot-03/devices/${deviceId}/commands`, {
    method: "POST",
    body: { commands: [{ code: switchCode, value: on }] },
  });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const state = await plugStatus(env, deviceId);
    if (state.on === on) return state;
  }
  throw new Error("Plug state confirmation timed out");
}

async function togglePlug(env, deviceId) {
  const state = await plugStatus(env, deviceId);
  return setPlug(env, deviceId, !state.on);
}

async function requestJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Error("Invalid request");
  return body;
}

async function prayerTimes() {
  if (prayerCache?.expiresAt > Date.now()) return prayerCache.value;
  try {
    const response = await fetch(PRAYER_URL, { headers: { accept: "text/html" } });
    if (!response.ok) throw new Error("Mawaqit request failed");
    const html = await response.text();
    const value = parseMawaqitPrayers(html);
    try {
      value.tomorrowPrayers = parseMawaqitPrayers(html, new Date(Date.now() + 24 * 60 * 60 * 1000)).prayers;
    } catch {
      value.tomorrowPrayers = [];
    }
    prayerCache = { value, expiresAt: Date.now() + PRAYER_CACHE_MS };
    return value;
  } catch (error) {
    if (prayerCache?.value) return { ...prayerCache.value, stale: true };
    throw error;
  }
}

function profileStore(env) {
  return env.EDITOR_PROFILES || null;
}

async function readProfiles(env) {
  const store = profileStore(env);
  if (!store) return {};
  return sanitizeProfileMap(await store.get(PROFILES_KEY, "json"));
}

async function writeProfiles(env, profiles) {
  await profileStore(env).put(PROFILES_KEY, JSON.stringify(profiles));
}

async function readTheme(env) {
  return profileStore(env)?.get(THEME_KEY, "json") ?? null;
}

async function writeTheme(env, value) {
  await profileStore(env).put(THEME_KEY, JSON.stringify({ value, updatedAt: Date.now() }));
}

async function readThemeSchedule(env) {
  return profileStore(env)?.get(THEME_SCHEDULE_KEY, "json") ?? null;
}

async function writeThemeSchedule(env, schedule) {
  await profileStore(env).put(THEME_SCHEDULE_KEY, JSON.stringify(sanitizeSchedule(schedule)));
}

async function themePayload(env) {
  const schedule = sanitizeSchedule(await readThemeSchedule(env));
  return { theme: effectiveTheme(await readTheme(env), schedule), schedule };
}

async function handleTheme(request, env) {
  if (!env.LIGHT_ACCESS_TOKEN) return json({ error: "Theme sync is not configured" }, 503);
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (!profileStore(env)) return json({ error: "Theme storage is not bound" }, 503);

  if (request.method === "GET") return json(await themePayload(env));

  if (request.method === "PUT") {
    const body = await requestJson(request);
    if (body.theme !== undefined) {
      if (body.theme !== "dark" && body.theme !== "light") return json({ error: "Invalid theme" }, 400);
      await writeTheme(env, body.theme);
    }
    if (body.schedule !== undefined) await writeThemeSchedule(env, body.schedule);
    return json(await themePayload(env));
  }

  return json({ error: "Not found" }, 404);
}

async function handleProfiles(request, env, url) {
  if (!env.LIGHT_ACCESS_TOKEN) return json({ error: "Profile sync is not configured" }, 503);
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (!profileStore(env)) return json({ error: "Profile storage is not bound" }, 503);

  if (url.pathname === "/api/profiles" && request.method === "GET") {
    return json({ profiles: await readProfiles(env) });
  }

  const name = normalizeProfileName(decodeURIComponent(url.pathname.slice("/api/profiles/".length)));
  if (!name) return json({ error: "Invalid profile name" }, 400);

  if (request.method === "PUT") {
    const profile = sanitizeProfile(await requestJson(request));
    if (profileTooLarge(profile)) return json({ error: "Profile too large" }, 413);
    const profiles = await readProfiles(env);
    profiles[name] = profile;
    await writeProfiles(env, sanitizeProfileMap(profiles));
    return json({ name, profile });
  }

  if (request.method === "DELETE") {
    const profiles = await readProfiles(env);
    const existed = name in profiles;
    if (existed) {
      delete profiles[name];
      await writeProfiles(env, profiles);
    }
    return json({ name, deleted: existed });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/setup/")) {
      if (!configured(env)) return json({ error: "Light service is not configured" }, 503);
      const token = decodeURIComponent(url.pathname.slice("/setup/".length));
      if (!equalSecrets(token, env.LIGHT_ACCESS_TOKEN)) return new Response("Not found", { status: 404 });
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `jdc_light=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`,
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/api/prayers" && request.method === "GET") {
      try {
        return json(await prayerTimes(), 200, { "cache-control": "public, max-age=300" });
      } catch {
        return json({ error: "Prayer times unavailable" }, 503);
      }
    }

    if (url.pathname === "/api/profiles" || url.pathname.startsWith("/api/profiles/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET, PUT, DELETE, OPTIONS" } });
      try {
        return await handleProfiles(request, env, url);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Profile service unavailable";
        console.error(JSON.stringify({ event: "profile_api_error", path: url.pathname, message }));
        return json({ error: message }, 503);
      }
    }

    if (url.pathname === "/api/theme") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET, PUT, OPTIONS" } });
      try {
        return await handleTheme(request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Theme service unavailable";
        console.error(JSON.stringify({ event: "theme_api_error", path: url.pathname, message }));
        return json({ error: message }, 503);
      }
    }

    const plugMatch = url.pathname.match(/^\/api\/plug\/([a-z0-9-]+)\/(status|toggle|on|off)$/);
    if (plugMatch) {
      const [, name, action] = plugMatch;
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS" } });
      const deviceId = plugDeviceId(env, name);
      if (!bridgeConfigured(env) || !deviceId) return json({ error: "Plug is not configured" }, 503);
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      try {
        if (action === "status" && request.method === "GET") return json(await plugStatus(env, deviceId));
        if (action === "toggle" && request.method === "POST") return json(await togglePlug(env, deviceId));
        if (action === "on" && request.method === "POST") return json(await setPlug(env, deviceId, true));
        if (action === "off" && request.method === "POST") return json(await setPlug(env, deviceId, false));
        return json({ error: "Not found" }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Plug service unavailable";
        console.error(JSON.stringify({ event: "plug_api_error", path: url.pathname, message }));
        return json({ error: message }, 503);
      }
    }

    if (!url.pathname.startsWith("/api/light/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS" } });
    if (!configured(env)) return json({ error: "Light service is not configured" }, 503);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);

    try {
      if (url.pathname === "/api/light/status" && request.method === "GET") return json(await lightStatus(env));
      if (url.pathname === "/api/light/toggle" && request.method === "POST") return json(await toggleLight(env));
      if (url.pathname === "/api/light/preset/chill" && request.method === "POST") return json(await setLightPreset(env, "chill"));
      if (url.pathname === "/api/light/preset/bright" && request.method === "POST") return json(await setLightPreset(env, "bright"));
      if (url.pathname === "/api/light/on" && request.method === "POST") return json(await setLight(env, true));
      if (url.pathname === "/api/light/off" && request.method === "POST") return json(await setLight(env, false));
      if (url.pathname === "/api/light/color" && request.method === "POST") return json(await setLightColor(env, await requestJson(request)));
      if (url.pathname === "/api/light/brightness" && request.method === "POST") {
        const { brightness } = await requestJson(request);
        return json(await setLightBrightness(env, brightness));
      }
      if (url.pathname === "/api/light/warmth" && request.method === "POST") {
        const { warmth } = await requestJson(request);
        return json(await setLightWarmth(env, warmth));
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Light service unavailable";
      console.error(JSON.stringify({ event: "light_api_error", path: url.pathname, message }));
      return json({ error: message }, 503);
    }
  },
};
