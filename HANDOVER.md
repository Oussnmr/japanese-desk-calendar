# Japanese Desk Calendar — AI Handover

**Canonical handover for future agents. Read this file before changing the project.**

- Repository: `Oussnmr/japanese-desk-calendar`
- Production: `https://japanese-desk-calendar.oussama-nemri.workers.dev/`
- Deployment branch: `main`
- Current documented revision: `3dcd566` (`Add AI project handover`) plus shared editor profiles
- Primary device: iPad Air 4 in landscape, installed as a standalone PWA
- Product language/style: Japanese editorial desk calendar; minimal, high-contrast, tactile; not a SaaS dashboard.

## 1. Product in one paragraph

This is a dependency-free single-page calendar for Brussels. It shows the date, time, month, weather, Salah/Iqama times, a countdown to the next Iqama, a stopwatch, a light/dark theme, and secure controls for a Tuya smart lamp plus four Tuya smart plugs (`LED`, `LAMPE`, `MULTIPRISES`, `PROJECTEUR`). A built-in visual editor lets the owner select calendar sections directly and adjust their text, placement, scale, width, opacity, colour, rotation, images, and local profiles without editing code.

## 2. Architecture and runtime boundaries

```text
iPad PWA (static HTML/CSS/JS)
  ├─ Open-Meteo directly: weather
  └─ Same-origin Cloudflare Worker
       ├─ Mawaqit: Salah/Iqama schedule (public read-only endpoint)
       ├─ Tuya Cloud: lamp status and commands (authenticated endpoints)
       └─ Workers KV: shared editor profiles (authenticated endpoints)
```

The Cloudflare Worker also serves the built static files from `dist/` through the `ASSETS` binding. It is not a separate frontend and backend deployment.

Important boundaries:

- Tuya credentials **must remain Worker secrets**. Never place them in `index.html`, `js/`, a public endpoint, a committed `.env`, browser storage, or a screenshot.
- The visual editor draft, imported **images**, and the theme stay **local to each browser** (`localStorage`).
- **Editor profiles are shared across devices** through Workers KV, behind the same private token as the lamp. Layout, text and colours sync; images never do. Every `/api/profiles*` endpoint is authenticated — there is still no public write API.
- `/api/prayers` is public and read-only. Every `/api/light/*` endpoint requires the private setup cookie or `Authorization: Bearer <LIGHT_ACCESS_TOKEN>`.
- `dist/` is generated and ignored. Change source files, then run the build.

## 3. Repository map

| Path | Responsibility |
|---|---|
| [`index.html`](index.html) | Entire semantic UI, controls, editor markup, `data-editor-target` boundaries. |
| [`styles.css`](styles.css) | Layout, typography, responsive iPad styling, RGB wheel appearance, visual-editor transforms. |
| [`js/main.js`](js/main.js) | Client controller: clock/date, light UI/API, RGB interaction, editor, prayers/Iqama countdown, stopwatch, theme, PWA registration. |
| [`js/calendar.js`](js/calendar.js) | Renders the monthly mini-calendar and `past`/`current` day classes. |
| [`js/weather.js`](js/weather.js) | Open-Meteo request, label mapping, browser cache fallback. |
| [`src/worker.js`](src/worker.js) | Cloudflare Worker, Mawaqit proxy/cache, Tuya signing/auth/commands. |
| [`src/light-model.js`](src/light-model.js) | Device DP names, Tuya range conversion, HSV/RGB normalization, presets. |
| [`src/plug-model.js`](src/plug-model.js) | Detects a smart plug's boolean switch DP from its live status; normalizes on/off. |
| [`src/prayer-model.js`](src/prayer-model.js) | Parses Mawaqit page data into the five prayer/Iqama records. |
| [`src/profile-model.js`](src/profile-model.js) | Validates and clamps editor profiles before they reach or leave KV. |
| [`service-worker.js`](service-worker.js) | PWA network-first/offline cache. Bump its cache name when changing public assets. |
| [`scripts/build-static.mjs`](scripts/build-static.mjs) | Copies a strict public allow-list into `dist/`. |
| [`scripts/prepare-cloud-secrets.mjs`](scripts/prepare-cloud-secrets.mjs) | Creates ignored local Cloudflare secret material and private setup URL. |
| [`tools/lepro-light/`](tools/lepro-light/README.md) | Optional local Python Tuya bridge for diagnostics/fallback. Not used by the deployed Worker. |
| [`tests/`](tests) | Node tests for prayer parsing and Tuya light-model conversion. |
| [`wrangler.jsonc`](wrangler.jsonc) | Worker entrypoint and static asset binding. |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Runs checks, builds, then deploys every `main` push. |

## 4. Main UI and behaviour

### Calendar, date, time, weather

- All calendar date/time logic uses `Europe/Brussels`, independently of the device locale.
- The central day number is over the red Ensō brush image in `assets/enso-brush.png`.
- The monthly calendar renders Monday-first.
  - Current day: red circle, light text, `aria-current="date"`.
  - Days strictly earlier in the current month: red text only (`.mini-grid .past`).
  - Future days: normal ink text.
  - At midnight, `tick()` detects a date change and re-renders automatically.
- Weather is Open-Meteo for Brussels (`50.8503, 4.3517`), refreshed every 20 minutes. `jdc-weather-v1` provides local fallback when offline.
- The clock updates every second. Wake Lock is best-effort; iPadOS can revoke it.

### Salah and next-Iqama countdown

- `GET /api/prayers` reads Mawaqit for Masjid AL-ABIDIN and returns five records:
  `{ key, label, time, iqama }`, plus `tomorrowPrayers`.
- The Salah table shows label, prayer time, and its wait (`+minutes`).
- The red `NEXT IQAMA` block below it updates every second, e.g. `M · 01:21:52`.
- It counts down to the next current-day Iqama. After Isha it uses tomorrow's Fajr from `tomorrowPrayers`, not an estimated time.
- Mawaqit is cached in the Worker for 15 minutes; the browser refreshes it every 30 minutes.
- The countdown is a standalone editor target named **Next Iqama countdown**. The visible label is editable; the live numeric value is intentionally generated.

### Theme and stopwatch

- Theme button: toggles light/dark and persists `jdc-theme` locally.
- Stopwatch: `START` / `PAUSE` and `CLEAR`; the display is hidden while zero. The stopwatch display and controls are separate editor targets.

### Lamp controls

The left column has three round controls, all same diameter/axis:

| Visible control | Behaviour |
|---|---|
| `ON` / `OFF` | Toggles lamp power. |
| `CHILL` / `BRIGHT` | One control that switches between white presets. The label reflects the active preset when one is active. |
| `COLOR` | Opens the opaque RGB panel beside the button, aligned from the bottom of the button upward. |

Preset definitions in [`src/light-model.js`](src/light-model.js):

- `CHILL`: 35% brightness and 50% white temperature.
- `BRIGHT`: maximum device brightness and coolest white temperature.

RGB panel behaviour:

- The wheel uses standard HSV direction: red at top, then clockwise **yellow → green → cyan → blue → magenta → red**.
- Its CSS conic gradient and `applyWheelEvent()` maths are deliberately aligned. Do **not** reverse one without the other; a previous mismatch made the visual wheel disagree with the lamp colour.
- Circular handle reflects the selected real HSV colour.
- Saturation: 0–100% in colour mode.
- Intensity: 0–100%; controls HSV value in colour mode and brightness in white mode.
- Tone: 0–100%; yellow/warm → white/cool, switches to white mode.
- A colour action turns the lamp on and selects `work_mode = colour`; Tone turns it on and selects white mode.
- Sliders/wheel use a 140 ms debounce during dragging and send the final value on release. No `alert()` is used.
- Click outside, Escape, or clicking `COLOR` again closes the panel.

### Plug controls

`#plug-controls` (own editor target: **Plug controls**) holds one round button per Tuya smart plug in a compact 2-column grid, since the labels (`LED`, `LAMPE`, `MULTIPRISES`, `PROJECTEUR`) are longer than the lamp's. It is nested inside `#light-controls` and, like `.light-color-panel`, is `position: absolute` beside the ON/CHILL/COLOR column — this is deliberate: `.weekday-panel` is a narrow, height-constrained column, and any plug markup that took part in normal flow (a fourth stacked row, a sibling section, a taller `.light-presets`) pushed and misaligned everything above it. Absolute positioning keeps `.light-presets`'s own box pixel-identical to the pre-plug layout, so adding or removing plugs can never move the header, weekday text, prayer panel, or anything else in that column. Each plug button toggles independently: its own power/pending/unavailable state, its own polling. A plug button stays disabled and dimmed until its Worker secret is set (see §5); nothing else about the calendar is affected by a missing plug secret.

## 5. Tuya integration: exact contract

### Device capabilities and DP rules

Never invent a DP name. The current device model is defined in [`src/light-model.js`](src/light-model.js):

```text
power       = switch_led
work mode   = work_mode
brightness  = bright_value          (device range 25–255)
temperature = temp_value            (device range 0–255)
colour      = colour_data_v2 OR colour_data, detected from device status
```

Colour scale is detected per device capability:

- `colour_data_v2`: `s`/`v` scale is 1000.
- `colour_data`: `s`/`v` scale is 255.

Frontend values are normalized before sending: hue `0–359`, saturation `0–100`, brightness/intensity `0–100`, and warmth `0–100`. Worker code converts them into the real device DP range.

### Plugs (separate devices from the lamp)

The Tuya account also has plain on/off smart plugs (Led, Multiprises, Projecteur, and one confusingly named "Lampe" — see the naming warning below). Plugs are handled generically in [`src/plug-model.js`](src/plug-model.js): instead of hardcoding a guessed switch DP name, the Worker reads the device's live status and picks its boolean switch code, preferring `switch_1`/`switch` and otherwise matching `switch_N`. This satisfies "never invent a DP name" without a manual verification step per plug.

Each plug is wired through the `PLUGS` map in [`src/worker.js`](src/worker.js), keyed by the URL segment used in `/api/plug/<name>/*` and pointing at the Worker secret holding that device's Tuya id: `led` → `TUYA_DEVICE_ID_PLUG_LED`, `lampe` → `TUYA_DEVICE_ID_PLUG_LAMPE`, `multiprises` → `TUYA_DEVICE_ID_PLUG_MULTIPRISES`, `projecteur` → `TUYA_DEVICE_ID_PLUG_PROJECTEUR`. A plug route answers `503` until both the shared Tuya account secrets and that plug's device-id secret exist — same graceful-degradation pattern as `EDITOR_PROFILES`. All four are wired into the UI (§4's Plug controls section); add another line to `PLUGS` plus its secret to expose a further plug.

**Device naming warning:** in the Tuya console, the device named "Lampe" is actually a plug (`ANTELA SMERT PLUG`), not the RGB ceiling light the app controls. The lamp wired as `TUYA_DEVICE_ID` is the one named "Plafonier" (`Lampux-RGBceilinglight`). Don't rewire `TUYA_DEVICE_ID` based on the Tuya device name alone.

### Worker endpoints

| Method/path | Body | Notes |
|---|---|---|
| `GET /api/light/status` | — | Normalized state including `on`, `brightness`, `warmth`, `workMode`, `colorHsv`, capability, and current preset. |
| `POST /api/light/toggle` | — | Toggle power. |
| `POST /api/light/on` / `off` | — | Explicit power. |
| `POST /api/light/preset/chill` / `bright` | — | Turns lamp on, switches to white, applies preset. |
| `POST /api/light/color` | any subset of `{ hue, saturation, intensity }` | Turns lamp on, switches to colour, preserves omitted HSV fields. |
| `POST /api/light/brightness` | `{ brightness: 0..100 }` | Updates HSV intensity in colour mode; white brightness otherwise. |
| `POST /api/light/warmth` | `{ warmth: 0..100 }` | Turns lamp on, switches to white, sets temperature. |
| `GET /api/plug/<name>/status` | — | `{ on, supported }` for that plug. `503` if the plug isn't configured. |
| `POST /api/plug/<name>/toggle` | — | Toggle that plug. |
| `POST /api/plug/<name>/on` / `off` | — | Explicit plug power. `<name>` is `led`, `lampe`, `multiprises`, or `projecteur`. |
| `GET /api/prayers` | — | Public read-only Mawaqit schedule and tomorrow schedule. |
| `GET /api/profiles` | — | All shared editor profiles. Authenticated. |
| `PUT /api/profiles/<name>` | `{ overrides, text, colors }` | Creates or replaces one profile. Authenticated, sanitized, 64 KB maximum. |
| `DELETE /api/profiles/<name>` | — | Removes one profile. Authenticated and idempotent. |
| `GET /setup/<private-token>` | — | Installs `jdc_light` HttpOnly, Secure, SameSite=Strict cookie and redirects home. |

After each Tuya command, the Worker polls status up to six times (400 ms interval) and only returns after expected state is observed. This confirmation is important for the UI and should be preserved.

### Secrets and setup

Required KV namespace (shared profiles):

```text
EDITOR_PROFILES     → binding declared in wrangler.jsonc
```

Create it once with `npx wrangler kv namespace create EDITOR_PROFILES`, paste the id into [`wrangler.jsonc`](wrangler.jsonc) and uncomment the block. Until then `/api/profiles*` answers `503` and the editor silently keeps profiles local — the calendar never breaks because of a missing binding.

Required Cloudflare secrets:

```text
TUYA_API_REGION
TUYA_API_KEY
TUYA_API_SECRET
TUYA_DEVICE_ID
LIGHT_ACCESS_TOKEN
```

Optional Cloudflare secrets (one per extra plug; a route is `503` while its secret is unset):

```text
TUYA_DEVICE_ID_PLUG_LED
TUYA_DEVICE_ID_PLUG_LAMPE
TUYA_DEVICE_ID_PLUG_MULTIPRISES
TUYA_DEVICE_ID_PLUG_PROJECTEUR
```

For a new environment:

1. Keep the four Tuya values (plus any `TUYA_DEVICE_ID_PLUG_*` you want enabled) only in `tools/lepro-light/.env` locally.
2. Run `node scripts/prepare-cloud-secrets.mjs`.
3. Upload the generated ignored JSON with the command in [`README.md`](README.md).
4. Open the generated ignored `tools/cloudflare/setup-url.txt` once on the owner’s iPad.

Never commit the `.env`, generated secret JSON, setup URL, authorization header, or cookie value. The README’s older endpoint list is incomplete; this document and [`src/worker.js`](src/worker.js) are the current source of truth.

## 6. Visual editor

### Opening and closing

- The small black SVG pencil under the top-left masthead opens **Edit Calendar**.
- The panel is opaque, compact, and draggable by its header; do not reintroduce a text-only pencil glyph because the custom font rendered it incorrectly.
- Close with the `×` button or Escape.
- Undo/Redo use inline SVG icons. Keyboard: `Ctrl/Cmd+Z` undo; `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` redo.

### Selecting and modifying

While editor mode is open, tap an element on the calendar to select its closest `data-editor-target`. A select menu offers the same targets.

Every target supports:

- Horizontal / vertical translation (`-160` to `160` px)
- Scale (70–140%)
- Width (60–140%)
- Opacity (10–100%)
- Full rotation (`-180°` to `180°`, 360° total)
- Selected colour

Targets with a text binding also enable text editing. Global ink and paper colours affect the full calendar.

Current target list:

```text
Header, Daily Calendar, Year, Europe / Brussels, Header separator,
Weekday, Weekday Japanese, Weekday English, Weekday separator,
Today, Date line, Prayer calendar, Next Iqama countdown, Light controls, Plug controls,
Day number, Ensō/image, Day caption, Month, Month heading, Month separator,
Month calendar, Weather, Stopwatch controls, Stopwatch display,
Brussels / Belgium, Clock, Current Time, Clock separator, Clock band
```

### Images and profiles

- Images are stored only in localStorage and limited to 1.5 MB.
- Allowed import types: PNG, JPEG, WebP, SVG.
- Ensō recommendation: transparent square PNG/WebP/SVG, `1254 × 1254`.
- Full background recommendation: JPG/WebP, iPad 4:3.
- `DELETE IMAGE` removes the selected imported image from that browser’s local history and clears active references to it.
- The current draft is browser-local. `RESET ORIGINAL` returns to the code defaults.
- **Profiles are shared across every authorized device.** `SAVE PROFILE` writes locally and to KV; `DELETE PROFILE` removes the profile selected in `SAVED PROFILES`, locally and in KV, with no confirmation dialog (consistent with `DELETE IMAGE`, and `alert()`/`confirm()` are banned here).
- On load, `syncEditorProfiles()` fetches KV, merges it over the local map (server wins on a name clash, but local `assets` are preserved so images keep resolving), then pushes any local-only profile up. That is the one-time migration path for profiles created before sync existed.
- Only `overrides`, `text` and `colors` travel. `assets` is stripped client-side and again in [`src/profile-model.js`](src/profile-model.js).
- Every sync failure is non-fatal: `profileSyncAvailable` drops to `false`, the editor keeps working on `localStorage`, and the editor note says the profile stayed on this device.

Local storage keys:

```text
jdc-theme
jdc-weather-v1
jdc-calendar-editor-draft
jdc-calendar-editor-profiles
jdc-calendar-editor-images
```

### Editor implementation cautions

- Add a new editable section in three places: HTML `data-editor-target`, `EDITOR_TARGETS` in `js/main.js`, and the editor select in `index.html`.
- Preserve `--editor-base-transform` on elements that already have a native transform (day number, Ensō, stopwatch, vertical weekday text). The generic editor transform composes from this custom property.
- Ensō has `pointer-events: none` normally, but is enabled only with `body.editor-is-open` so the red brush can be selected directly without blocking ordinary use.
- The day caption has two spans: `.hero-caption-mark` is red Japanese; `.hero-caption-text` is ink Latin. Do not target all caption spans with the Japanese font or the English caption can disappear.
- `.weekday-panel` (the left column holding weekday text, prayers, today, and the lamp/plug buttons) is narrow and height-constrained; any new markup that takes part in normal flow there (a new stacked row, a new sibling section) pushes and misaligns everything else in that column. New controls in that column should be `position: absolute` inside an existing `position: relative` parent (see `.light-color-panel` and `.plug-controls`), not new flow content — that's what broke the layout the first time plugs were added.

## 7. iPad, accessibility, and PWA requirements

- Priority viewport: iPad Air 4 landscape. `manifest.webmanifest` requests `standalone` and `landscape`.
- The CSS has a compact fallback below 820 px or in portrait; validate landscape first after layout changes.
- Use pointer events, `touch-action`, visible focus styles, semantic buttons/labels, and `aria-pressed`/`aria-expanded` when extending controls.
- RGB wheel is keyboard accessible as a slider. Sliders and drag interactions are designed for touch.
- The PWA uses network-first responses with offline fallback. **Whenever public HTML, CSS, JS, fonts, icons, or assets change, increment `CACHE_NAME` in `service-worker.js`.** Current cache: `japanese-desk-calendar-v17`.
- A user with an already-open PWA may need one refresh/reopen after deploy to claim the new service worker.

## 8. Design system

- Light paper: `#f5f2ea`; dark paper: `#080807`; ink: near-black; accent: red.
- Key fonts come from `fonts/calendar-fonts.css`:
  - `NemriTechno`: Latin labels/values.
  - `NemriJPN-Brush`: Japanese accents.
  - `KatanaCalendar`: large numerals.
  - `ShipporiAntiqueB1`: Japanese text.
- Prefer thin rules, opaque paper panels, little or no shadow, and measured spacing.
- Avoid glass effects, heavy cards, generic dashboard widgets, translucent menus, or global CSS refactors.

## 9. Change history relevant to the current project

| Commit | What changed |
|---|---|
| `b364cb7` | Restored the stable Ensō brush-ring baseline. |
| `49867a4` | Redeployed that production state. |
| `1efd331` → `d2ef98b` | Added tactile RGB controls and real Tuya capability/DP conversion. |
| `2153238` | Merged Chill/Bright into one switching preset control. |
| `e3f722a` | Added RGB saturation and mode-aware intensity. |
| `6965285` → `6948fcd` | Added and expanded visual editor, direct selection, profiles, image controls, granular targets, RGB wheel refinement. |
| `84e422b` | Replaced broken font glyphs with SVG pencil/history icons, restored caption, made Ensō touch-selectable, extended rotation, aligned RGB visual direction. |
| `d21d6e3` | Made days earlier than today red in the mini-calendar. |
| `b36e0b8` | Added red live countdown to next Iqama and tomorrow-Fajr fallback. |
| `3dcd566` | Added this handover document. |
| `fbdc59b`–`7ff6fb9` | Added KV-backed shared editor profiles and a `DELETE PROFILE` control; documented two-assistant handoff. |
| `c5ebe46` | Added a second Tuya device type: the `LED` smart plug, with generic plug DP detection (`src/plug-model.js`) and `/api/plug/<name>/*`. |
| `5734dd5` | Added the `LAMPE`, `MULTIPRISES`, and `PROJECTEUR` plugs; moved plug buttons out of `#light-controls` into their own `#plug-controls` grid and editor target — this pushed and misaligned `.weekday-panel`'s other content because it took part in normal flow. |
| _current_ | Fixed that regression: `#plug-controls` is nested back inside `#light-controls` and made `position: absolute` (like `.light-color-panel`), so it no longer adds height to `.weekday-panel`'s flow. `.light-presets` itself is restored byte-for-byte to its pre-plug CSS. |

## 10. Development, testing, deployment

```sh
npm run check   # syntax checks plus Node tests
npm run build   # rebuilds ignored dist/
npm run deploy  # local Wrangler deploy; normally GitHub Actions deploys main
```

Line endings are normalized to LF in the repository by [`.gitattributes`](.gitattributes). This project is edited from more than one machine and more than one assistant; without it, a Windows checkout rewrites every file to CRLF and each side sees the whole tree as modified. Never commit a wholesale line-ending flip.

Normal contribution procedure:

1. Inspect the affected source and preserve unrelated user changes.
2. Modify the smallest relevant source files.
3. Run `npm run check`, `npm run build`, and `git diff --check`.
4. Verify light changes against the real reported DP capabilities; do not guess DPs.
5. Verify visual/touch changes at iPad landscape size, plus light/dark mode if colours/layout changed.
6. Increment PWA cache version when public assets changed.
7. Commit 1–3 logical commits, push to `main`; do not force-push or hard-reset.
8. Wait for the **Deploy Cloudflare Worker** GitHub Action to finish successfully, then check production with a cache-busting query string.

## 11. Known constraints and safe next steps

- The Worker uses small module-level caches for Tuya access token and Mawaqit data. They are performance caches only; never store request/user/editor state globally.
- The public prayer source is external. UI should fail gracefully: hide the prayer panel only when there is no prior data; preserve stale cached Worker data when possible.
- Tuya access is intentionally unavailable until the iPad has visited the private setup URL. A disabled light UI is expected when unauthenticated or unavailable.
- The local Python bridge is diagnostic/fallback only. Do not regress the hosted HTTPS Worker path into a browser-to-LAN request.
- Shared profiles were an explicit product decision: KV storage, the existing `LIGHT_ACCESS_TOKEN` gate, images kept local, automatic migration on first load. Layout and images remain browser-local. Do not widen `/api/profiles*` to unauthenticated access.
- Profiles live under a single KV key (`editor-profiles`) written read-modify-write. That is safe for one owner; two devices saving in the same second could drop one profile. Move to one key per profile if this ever becomes a multi-user product.
- For new features, choose a clear `data-editor-target` boundary early so the owner can later reposition or restyle it from the editor.

## 12. Working across two assistants

This repository is edited by two AI assistants in alternation (Claude and ChatGPT/Codex), never at the same time. The handoff rule: whoever finishes a turn leaves the working tree clean and pushed to `main` — no uncommitted or unpushed work when control passes to the other assistant. Before starting, check `git status` and `git log` to see what the other assistant left. `HANDOVER.md` must be updated in the same batch of commits as any change it describes, not as an afterthought — an outdated handover is worse than none, since the next assistant trusts it as the source of truth. `CLAUDE.md` and `AGENTS.md` at the repository root both point to this document and must stay identical to each other.

## 13. Quick orientation for the next agent

Before implementing a request, answer these questions:

1. Is it purely visual/client-side, or does it touch a Worker API or Tuya command?
2. Should it be individually selectable in Edit Calendar? If yes, register the target in all three editor locations.
3. Does it change a public asset? If yes, bump the service-worker cache name.
4. Does it alter lamp state? If yes, inspect status and actual supported DPs first; keep secrets server-side.
5. Could it affect iPad landscape touch targets, light/dark contrast, direct selection, or the existing desired Japanese editorial style?

Follow those answers, make the smallest safe change, test it, and deploy only after validation.
