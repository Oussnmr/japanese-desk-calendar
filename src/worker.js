import {
  LIGHT_DPS, brightnessRawFromPercent, colorDataFromRgb, colorDpForValues,
  commandsForPreset, normalizeLightStatus, temperatureRawFromPercent,
} from "./light-model.js";
import { parseMawaqitPrayers } from "./prayer-model.js";

const REGION_HOSTS = {
  cn: "openapi.tuyacn.com",
  us: "openapi.tuyaus.com",
  "us-e": "openapi-ueaz.tuyaus.com",
  eu: "openapi.tuyaeu.com",
  "eu-w": "openapi-weaz.tuyaeu.com",
  in: "openapi.tuyain.com",
  sg: "openapi-sg.iotbing.com",
};

let tokenCache = null;
let prayerCache = null;
const encoder = new TextEncoder();
const PRAYER_URL = "https://mawaqit.net/fr/masjid-al-abidin-bruxelles-1000-belgium";
const PRAYER_CACHE_MS = 15 * 60 * 1000;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function configured(env) {
  return ["TUYA_API_REGION", "TUYA_API_KEY", "TUYA_API_SECRET", "TUYA_DEVICE_ID", "LIGHT_ACCESS_TOKEN"]
    .every((name) => Boolean(env[name]));
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

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hostFor(region) {
  return REGION_HOSTS[String(region).toLowerCase()] || REGION_HOSTS.eu;
}

async function tuyaRequest(env, path, { method = "GET", body = null, accessToken = null } = {}) {
  const timestamp = String(Date.now());
  const content = body ? JSON.stringify(body) : "";
  const headers = {};
  if (content) {
    headers["Content-type"] = "application/json";
    headers["Signature-Headers"] = "Content-type";
  }

  const signedHeaders = content ? "Content-type:application/json\n" : "";
  const prefix = accessToken
    ? `${env.TUYA_API_KEY}${accessToken}${timestamp}`
    : `${env.TUYA_API_KEY}${timestamp}`;
  const stringToSign = `${method}\n${await digest(content)}\n${signedHeaders}\n${path}`;
  const sign = await hmac(env.TUYA_API_SECRET, `${prefix}${stringToSign}`);
  const requestHeaders = {
    ...headers,
    client_id: env.TUYA_API_KEY,
    sign,
    t: timestamp,
    sign_method: "HMAC-SHA256",
    mode: "cors",
  };
  if (accessToken) requestHeaders.access_token = accessToken;
  else requestHeaders.secret = env.TUYA_API_SECRET;

  const response = await fetch(`https://${hostFor(env.TUYA_API_REGION)}${path}`, {
    method,
    headers: requestHeaders,
    body: content || undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.msg || "Tuya request failed");
  return payload.result;
}

async function accessToken(env, refresh = false) {
  if (!refresh && tokenCache?.expiresAt > Date.now()) return tokenCache.value;
  const result = await tuyaRequest(env, "/v1.0/token?grant_type=1");
  tokenCache = {
    value: result.access_token,
    expiresAt: Date.now() + Math.max(60, Number(result.expire_time || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

async function deviceRequest(env, path, options) {
  let token = await accessToken(env);
  try {
    return await tuyaRequest(env, path, { ...options, accessToken: token });
  } catch (error) {
    if (!/token invalid|token expired/i.test(error.message)) throw error;
    token = await accessToken(env, true);
    return tuyaRequest(env, path, { ...options, accessToken: token });
  }
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

async function setLightColor(env, color) {
  const result = await deviceRequest(env, `/v1.0/iot-03/devices/${env.TUYA_DEVICE_ID}/status`);
  const values = Object.fromEntries(result.map((item) => [item.code, item.value]));
  const colorDp = colorDpForValues(values);
  if (!colorDp) throw new Error("Light colour control is unsupported");
  return sendLightCommands(env, [
    { code: LIGHT_DPS.power, value: true },
    { code: LIGHT_DPS.workMode, value: "colour" },
    { code: colorDp, value: colorDataFromRgb(color) },
  ], (state) => state.on && state.workMode === "colour");
}

async function setLightBrightness(env, brightness) {
  if (!Number.isFinite(Number(brightness))) throw new Error("Invalid brightness");
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
    const value = parseMawaqitPrayers(await response.text());
    prayerCache = { value, expiresAt: Date.now() + PRAYER_CACHE_MS };
    return value;
  } catch (error) {
    if (prayerCache?.value) return { ...prayerCache.value, stale: true };
    throw error;
  }
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
    } catch {
      return json({ error: "Light service unavailable" }, 503);
    }
  },
};
