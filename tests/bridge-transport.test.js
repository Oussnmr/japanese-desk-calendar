import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";

const ACCESS_TOKEN = "test-access-token";

function environment() {
  return {
    LIGHT_ACCESS_TOKEN: ACCESS_TOKEN,
    BRIDGE_URL: "https://bridge.test",
    BRIDGE_TOKEN: "test-bridge-token",
    TUYA_DEVICE_ID: "lamp-id",
    TUYA_DEVICE_ID_PLUG_LED: "plug-id",
    ASSETS: { fetch: async () => new Response("asset") },
  };
}

function request(path, method = "GET") {
  return new Request(`https://calendar.test${path}`, {
    method,
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
}

test("plug bridge calls use transient connections while lamp calls stay persistent", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let plugOn = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), headers: new Headers(options.headers) });
    if (String(url).includes("plug-id") && options.method === "POST") {
      plugOn = JSON.parse(options.body).commands[0].value;
    }
    const result = String(url).includes("plug-id")
      ? [{ code: "switch_1", value: plugOn }]
      : [{ code: "switch_led", value: false }];
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const plugResponse = await worker.fetch(request("/api/plug/led/on", "POST"), environment());
    const lampResponse = await worker.fetch(request("/api/light/status"), environment());
    assert.equal(plugResponse.status, 200);
    assert.equal(lampResponse.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 4);
  for (const call of calls.slice(0, 3)) {
    assert.equal(call.headers.get("x-tuya-transient"), "1");
  }
  assert.equal(calls[3].headers.get("x-tuya-transient"), null);
});
