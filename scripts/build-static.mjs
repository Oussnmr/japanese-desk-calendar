import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const files = ["index.html", "styles.css", "manifest.webmanifest", "service-worker.js"];
const directories = ["icons", "js"];
const fontFiles = ["calendar-fonts.css", "NemriTechno-Regular.ttf", "NemriJPN-Brush.ttf"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  ...files.map((file) => cp(resolve(root, file), resolve(output, file))),
  ...directories.map((directory) => cp(resolve(root, directory), resolve(output, directory), { recursive: true })),
  ...fontFiles.map((file) => cp(resolve(root, "fonts", file), resolve(output, "fonts", file))),
]);
