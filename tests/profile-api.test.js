import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";

const TOKEN = "test-access-token";

function kvStub(initial = null) {
  let value = initial === null ? null : JSON.stringify(initial);
  return {
    async get(key, type) {
      if (value === null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, next) { value = next; },
    read() { return value === null ? null : JSON.parse(value); },
  };
}

function environment(store) {
  return { LIGHT_ACCESS_TOKEN: TOKEN, EDITOR_PROFILES: store, ASSETS: { fetch: async () => new Response("asset") } };
}

function call(path, { method = "GET", token = TOKEN, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  return new Request(`https://calendar.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

test("profiles require the private token", async () => {
  const response = await worker.fetch(call("/api/profiles", { token: "" }), environment(kvStub()));
  assert.equal(response.status, 401);
});

test("a missing KV binding degrades to 503 instead of breaking the calendar", async () => {
  const response = await worker.fetch(call("/api/profiles"), { LIGHT_ACCESS_TOKEN: TOKEN });
  assert.equal(response.status, 503);
});

test("a profile can be saved, listed and deleted", async () => {
  const store = kvStub();
  const env = environment(store);

  const saved = await worker.fetch(call("/api/profiles/ipad night", {
    method: "PUT",
    body: { overrides: { year: { x: 12, color: "#11100E" } }, colors: { ink: "#11100e" }, assets: { enso: "data:image/png;base64,AAA" } },
  }), env);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).name, "IPAD NIGHT");

  const listed = await (await worker.fetch(call("/api/profiles"), env)).json();
  assert.deepEqual(Object.keys(listed.profiles), ["IPAD NIGHT"]);
  assert.equal(listed.profiles["IPAD NIGHT"].overrides.year.x, 12);
  assert.equal("assets" in listed.profiles["IPAD NIGHT"], false, "images must never reach the server");

  const deleted = await (await worker.fetch(call("/api/profiles/IPAD NIGHT", { method: "DELETE" }), env)).json();
  assert.deepEqual(deleted, { name: "IPAD NIGHT", deleted: true });
  assert.deepEqual(store.read(), {});
});

test("deleting an unknown profile is idempotent", async () => {
  const response = await worker.fetch(call("/api/profiles/GHOST", { method: "DELETE" }), environment(kvStub({})));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: "GHOST", deleted: false });
});

test("an unusable profile name is rejected", async () => {
  const response = await worker.fetch(call("/api/profiles/***", { method: "PUT", body: {} }), environment(kvStub()));
  assert.equal(response.status, 400);
});

test("other routes are untouched by the profile handler", async () => {
  const response = await worker.fetch(call("/anything", { token: "" }), environment(kvStub()));
  assert.equal(await response.text(), "asset");
});
