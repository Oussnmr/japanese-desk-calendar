import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "tools/lepro-light/.env");
const target = resolve(root, "tools/cloudflare/.cloudflare-secrets.json");
const localConfig = resolve(root, "tools/cloudflare/.env");
const setupUrl = resolve(root, "tools/cloudflare/setup-url.txt");
const required = ["TUYA_API_REGION", "TUYA_API_KEY", "TUYA_API_SECRET", "TUYA_DEVICE_ID"];
const parse = (text) => Object.fromEntries(
  text.split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => line.split(/=(.*)/s).slice(0, 2).map((part) => part.trim())),
);

const values = parse(await readFile(source, "utf8"));
const existing = await readFile(localConfig, "utf8").then(parse).catch(() => ({}));
for (const key of required) {
  if (!values[key]) throw new Error(`Missing ${key} in the local Tuya configuration.`);
}

const secrets = {
  ...Object.fromEntries(required.map((key) => [key, values[key]])),
  LIGHT_ACCESS_TOKEN: existing.LIGHT_ACCESS_TOKEN || randomBytes(32).toString("base64url"),
};

await writeFile(localConfig, `${Object.entries(secrets).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
await writeFile(target, `${JSON.stringify(secrets)}\n`, "utf8");
const origin = process.env.CALENDAR_ORIGIN || "https://japanese-desk-calendar.oussama-nemri.workers.dev";
await writeFile(setupUrl, `${origin}/setup/${secrets.LIGHT_ACCESS_TOKEN}\n`, "utf8");
console.log("Prepared local Cloudflare secrets without printing their values.");
