# Japanese Desk Calendar — AI Handover

**Canonical handover for future agents. Read this file before changing the project.**

- Repository: `Oussnmr/japanese-desk-calendar`
- Production: `https://japanese-desk-calendar.oussama-nemri.workers.dev/`
- Deployment branch: `main`
- Current documented revision: `3dcd566` (`Add AI project handover`) plus shared editor profiles
- Primary device: iPad Air 4 in landscape, installed as a standalone PWA
- Product language/style: Japanese editorial desk calendar; minimal, high-contrast, tactile; not a SaaS dashboard.

## ✅ Tuya Cloud migration: complete and live (2026-09-09)

Device control moved fully off Tuya Cloud, is deployed, and has been verified end-to-end against real hardware. Summary for anyone who wasn't following along (see change history for the commit-by-commit trail):

- `bridge/` runs on the owner's home PC (Docker Compose: `bridge` + `cloudflared`), reached at `https://bridge.nemri.uk` through a Cloudflare Tunnel.
- **`nemri.uk` is a small dedicated domain bought specifically for this** (via Cloudflare Registrar, so it was an active zone immediately) — deliberately *not* the owner's e-commerce domain, to avoid any risk of an unrelated nameserver change taking down their actual storefront. If the bridge's public hostname ever needs to change, this is why: don't casually point it at a domain that runs something else important.
- `BRIDGE_URL`/`BRIDGE_TOKEN` are set as Worker secrets and confirmed live (`/api/light/status` now returns `401 Unauthorized` for an unauthenticated request instead of `503 not configured`). `TUYA_API_KEY`/`SECRET`/`REGION` were deleted from the Worker's secrets — confirmed unused, since `deviceRequest()` no longer talks to Tuya Cloud at all.
- How `local_key` was actually obtained, since Tuya Cloud's IoT Core quota was exhausted at the time (both the normal quota *and* a separate one-time-only trial resource pool underneath it — re-subscribing is blocked, "You have subscribed to the trial edition before"): [`vineetchoudhary/tuya-local-key`](https://github.com/vineetchoudhary/tuya-local-key) (QR-code login, the same official flow Home Assistant's Tuya integration uses — no developer account, no Access ID/Secret, no Tuya Cloud quota touched at all) for `local_key` + the DP index→code `local_strategy` mapping, then a pure local `tinytuya.deviceScan()` (no cloud) for each device's LAN `ip`/`version`. Full steps are in `bridge/README.md`'s "One-time setup" — that's the primary documented path now; plain `tinytuya wizard` stays as a fallback for whoever has working IoT Core quota.
- Found and fixed against real hardware: `tinytuya`'s `set_multiple_values()` returned "Unexpected Payload from Device" on the v3.3 lamp. `send_commands()` in `bridge.py` loops individual `set_value()` calls instead — verified on the lamp (v3.3) and all 4 plugs (v3.4).
- **Performance work on `bridge.py`, and two bugs it caused — read this before "optimising" the bridge again.** The original code opened a brand-new local-protocol connection (TCP + Tuya session handshake) *per request*, which made colour changes feel slow since one change does several sequential device round-trips. Three changes, in the order they were made, with the two mistakes kept here on purpose:
  1. **Persistent connections** (kept): `tuya_device()` caches one `tinytuya.Device` per device id (`set_socketPersistent(True)`), with a one-time reconnect-and-retry when a cached connection goes stale. Repeat status reads went ~200ms → ~70-80ms locally.
  2. **`nowait=True` on writes — REVERTED, it was broken.** It looked like a win (writes ~90-170ms instead of 235-1000ms) and appeared to work when tested one command at a time. It is *incompatible with persistent connections*: `nowait=True` fires the command without reading the device's reply, so that reply stays queued on the socket and every subsequent read returns the *previous* message. Symptom: one colour change works, the next silently does nothing, responses come back partial (`[{"switch_led": ...}]` only) or carry the *previous* colour, and it drifts further out of sync with each call. `send_commands()` uses `nowait=False`.
  3. **Per-device locking** (kept, and needed): this is a `ThreadingHTTPServer`, so two overlapping requests for the same device (a colour drag landing on the previous command's confirm-poll) shared one socket across threads and corrupted it. `DEVICE_LOCKS` holds one `threading.RLock` per device — same device serialises, different devices still run in parallel. `RLock`, not `Lock`, because `send_commands()` ends by calling `status_as_result()` which takes the same lock on the same thread.
  4. **Skipping no-op writes** (kept): every colour change from the Worker sends `switch_led=true` + `work_mode=colour` + `colour_data=X`, and each write costs a full ACK round trip — but mid-drag the first two are already true. `send_commands()` reads current state first and skips DPs already holding the requested value, turning a 3-write change into a 1-write one. Colour changes measured ~350-535ms locally, ~500-680ms through the tunnel, with correct (non-partial, non-stale) responses across rapid mixed colour/CHILL/BRIGHT sequences.
- Occasional transient `"Unexpected Payload from Device"` errors on an otherwise-working device (observed once on a status read, gone on immediate retry) appear to just be how this local protocol behaves sometimes — not treated as a bug; the Worker's existing 503-on-failure + the client's own polling already absorb this the same way they've always absorbed any transient device error.

**One open gap, not yet fixed**: the lamp's `colour_data` DP returns a raw hex string over the local protocol (`"ff00fb012dffff"`), not the JSON `{"h","s","v"}` shape `light-model.js`'s `hsvFromColorData()` expects (which matches Tuya *Cloud's* shape for this DP). On/off, presets, brightness, and warmth are unaffected; the RGB colour wheel specifically may not work correctly for this lamp until someone decodes that hex packing.

## 1. Product in one paragraph

This is a dependency-free single-page calendar for Brussels. It shows the date, time, month, weather, Salah/Iqama times, a countdown to the next Iqama, a stopwatch, a light/dark theme, and secure controls for a Tuya smart lamp plus four Tuya smart plugs (`LED`, `LAMPE`, `MULTIPRISES`, `PROJECTEUR`). A built-in visual editor lets the owner select calendar sections directly and adjust their text, placement, scale, width, opacity, colour, rotation, images, and local profiles without editing code.

## 2. Architecture and runtime boundaries

```text
iPad PWA (static HTML/CSS/JS)
  ├─ Open-Meteo directly: weather
  └─ Same-origin Cloudflare Worker
       ├─ Mawaqit: Salah/Iqama schedule (public read-only endpoint)
       ├─ Home bridge (Cloudflare Tunnel): lamp + plug status and commands (authenticated)
       └─ Workers KV: shared editor profiles, theme (authenticated endpoints)

Home bridge (bridge/, Docker, runs on an always-on home PC)
  └─ Tuya LOCAL LAN protocol (tinytuya) — NOT Tuya Cloud — to the 5 devices
```

The Cloudflare Worker also serves the built static files from `dist/` through the `ASSETS` binding. It is not a separate frontend and backend deployment.

Device control does **not** go through Tuya Cloud in normal operation — it goes through `bridge/` on the owner's home network, reached over a Cloudflare Tunnel. This was a deliberate architecture change (see §11 and change history): Tuya Cloud's free "IoT Core" API quota was exhausted once, breaking every device button on every client simultaneously until manually renewed, and the owner chose to trade that dependency for one on their own home PC + internet + tunnel instead. Tuya Cloud is still touched, but only once (or rarely) per device, to fetch its `local_key` — see `bridge/README.md`.

Important boundaries:

- The bridge's `BRIDGE_TOKEN` and the Worker's `BRIDGE_URL`/`BRIDGE_TOKEN` secrets **must remain Worker/bridge secrets**. Never place them in `index.html`, `js/`, a public endpoint, a committed `.env`, browser storage, or a screenshot. Same rule for each device's `local_key` in `bridge/devices.json` (gitignored, never committed).
- The visual editor draft and imported **images** stay **local to each browser** (`localStorage`).
- **Editor profiles are shared across devices** through Workers KV, behind the same private token as the lamp. Layout, text and colours sync; images never do. Every `/api/profiles*` endpoint is authenticated — there is still no public write API.
- **The light/dark theme is shared across devices** the same way, through `/api/theme` (see §4). Each device also keeps a local `jdc-theme` cache so it still has a theme offline or before the first sync.
- `/api/prayers` is public and read-only. Every `/api/light/*`, `/api/plug/*`, and `/api/theme` endpoint requires the private setup cookie or `Authorization: Bearer <LIGHT_ACCESS_TOKEN>`.
- `dist/` is generated and ignored. Change source files, then run the build.

## 3. Repository map

| Path | Responsibility |
|---|---|
| [`index.html`](index.html) | Entire semantic UI, controls, editor markup, `data-editor-target` boundaries. |
| [`styles.css`](styles.css) | Layout, typography, responsive iPad styling, RGB wheel appearance, visual-editor transforms. |
| [`js/main.js`](js/main.js) | Client controller: clock/date, light UI/API, RGB interaction, editor, prayers/Iqama countdown, stopwatch, theme, PWA registration. |
| [`js/calendar.js`](js/calendar.js) | Renders the monthly mini-calendar and `past`/`current` day classes. |
| [`js/weather.js`](js/weather.js) | Open-Meteo request, label mapping, browser cache fallback. |
| [`src/worker.js`](src/worker.js) | Cloudflare Worker: Mawaqit proxy/cache, auth, and a thin authenticated proxy to the home bridge (no Tuya Cloud signing anymore). |
| [`src/light-model.js`](src/light-model.js) | Device DP names, Tuya range conversion, HSV/RGB normalization, presets. |
| [`src/plug-model.js`](src/plug-model.js) | Detects a smart plug's boolean switch DP from its live status; normalizes on/off. |
| [`src/prayer-model.js`](src/prayer-model.js) | Parses Mawaqit page data into the five prayer/Iqama records. |
| [`src/profile-model.js`](src/profile-model.js) | Validates and clamps editor profiles before they reach or leave KV. |
| [`src/theme-model.js`](src/theme-model.js) | Computes the shared light/dark theme from a configurable daily day/night schedule, DST-aware. |
| [`service-worker.js`](service-worker.js) | PWA network-first/offline cache. Bump its cache name when changing public assets. |
| [`scripts/build-static.mjs`](scripts/build-static.mjs) | Copies a strict public allow-list into `dist/`. |
| [`scripts/prepare-cloud-secrets.mjs`](scripts/prepare-cloud-secrets.mjs) | Creates ignored local Cloudflare secret material and private setup URL. |
| [`bridge/`](bridge/README.md) | **Load-bearing production infrastructure**, not a diagnostic tool: the local Tuya bridge the Worker calls for every device status/command, over a Cloudflare Tunnel. Runs on an always-on home PC via Docker Compose. |
| [`tests/`](tests) | Node tests for prayer parsing, Tuya light-model conversion, profiles, and the theme auto-switch. |
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
- `.weekday-panel .rule` (the **Weekday separator** editor target, meant to sit between the weekday text and "TODAY") is `display: none` by default: in normal flow it lands right where `.prayer-panel`'s absolutely positioned iqama countdown ends, reading as a stray red bar under the prayer time. Re-enabling it (e.g. via the editor) will reintroduce that overlap unless the two are given non-conflicting positions first.

### Theme and stopwatch

- Theme button: toggles light/dark, persists `jdc-theme` locally, and (when sync is available) `PUT`s the new value to `/api/theme` so every other device picks it up.
- On load and every `THEME_REFRESH_MS` (15s), `js/main.js` calls `GET /api/theme` and applies whatever it returns — this is how a toggle (or a schedule edit) on one device reaches the others. 15s is a deliberate compromise: this is a single-owner app with a handful of devices, so polling that often is cheap, and it makes cross-device sync and the scheduled switch both feel closer to instant without needing push infrastructure (no WebSocket/Durable Object — plain polling was judged simple enough for this app's scale).
- **Day/night schedule:** two editable times live in the settings popup (§4), `DAY` and `NIGHT` — the hour each mode should start, every day. The Worker never runs a background job for this — `effectiveTheme()` in [`src/theme-model.js`](src/theme-model.js) computes the schedule-driven theme on every `GET /api/theme`, DST-aware via `Intl` (Europe/Brussels). A manual toggle is honoured until the *next* scheduled boundary (day or night) actually passes, then the schedule reasserts itself — so nudging the theme mid-day doesn't get instantly overridden, but it also doesn't silently stick forever. Defaults are `08:00` (day) / `20:00` (night) until the owner changes them. This logic is covered by `tests/theme-model.test.js`, including both DST sides and a custom (night-before-day) schedule.
- The schedule is stored in the same `EDITOR_PROFILES` KV namespace, key `theme-schedule` (`{ dayMinute, nightMinute }`, minutes since midnight). `PUT /api/theme` accepts `{ theme }`, `{ schedule }`, or both in one call; `GET /api/theme` always returns `{ theme, schedule }`.
- The shared value lives in the same `EDITOR_PROFILES` KV namespace as editor profiles, under the key `theme` (`{ value, updatedAt }`) — no new KV binding needed. `/api/theme` is gated by `LIGHT_ACCESS_TOKEN` exactly like `/api/profiles`; without the binding or the token it degrades to `503` and each device just keeps using its local `jdc-theme` value, same graceful-degradation pattern as everywhere else.
- Stopwatch: `START` / `PAUSE` and `CLEAR`; the display is hidden while zero. The stopwatch display and controls are separate editor targets.

### Lamp and device controls

The left column (`#light-controls`) has four round controls, all same diameter/axis:

| Visible control | Behaviour |
|---|---|
| `ON` / `OFF` | Toggles the Plafonier lamp's power. |
| `NS` | A scene button: turns `led`, `lampe`, and `multiprises` on together (and also turns the Plafonier lamp off), or turns those three plugs off together if all three are already on (the lamp is left as-is on the off path). Does not touch `projecteur`. Purely client-side (`js/main.js`): it calls the same `/api/plug/<name>/on|off` and `/api/light/off` endpoints as the individual buttons, in parallel — no dedicated "scene" concept exists in the Worker. |
| `CHILL` / `BRIGHT` | One control that switches between white presets. The label reflects the active preset when one is active. |
| gear icon (`#settings-toggle`) | Opens `#settings-panel`, an opaque popup listing every device individually. |

`#settings-panel` holds seven controls in a 3-column grid: one round toggle per device (`PLAFONIER`, `LED`, `LAMPE`, `MULTIPRISES`, `PROJECTEUR` — five total), an `ALL OFF` button that turns all five off at once, and `COLOR`, which opens the RGB panel described below as a popup nested inside the settings popup. `PLAFONIER` there is a second button mirroring `#light-power`'s state (both call `/api/light/toggle`; `showLightState()` updates both in lockstep) — everything else in the panel is the exact same buttons/state objects the plugs already used before this popup existed, just relocated in the DOM. Opening `COLOR` does not add a Worker call; it only reveals the already-existing `.light-color-panel`. Below that grid, `.settings-schedule` holds the two `<input type="time">` fields (`DAY`, `NIGHT`) that edit the shared theme schedule described in the next section.

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
- Click outside `#light-controls`, Escape, or clicking `COLOR` again closes the RGB panel. The same click-outside/Escape handling also closes `#settings-panel`; closing settings also force-closes the nested colour panel so it doesn't silently stay open behind a re-opened settings popup.

### Why the settings popup is `position: absolute`

`.weekday-panel` (the column holding weekday text, prayers, today, and `#light-controls`) is narrow and height-constrained. Both `#settings-panel` and `.light-color-panel` are nested inside `#light-controls` and are `position: absolute`, anchored beside the ON/NS/CHILL/gear column, so neither ever adds height to `.weekday-panel`'s flow. This is deliberate, learned the hard way: an earlier attempt at plug controls used a sibling section that participated in normal flow, and it pushed and misaligned the weekday text, prayer panel, and today/date line above it (see the change history). Any new device control added to this column should follow the same absolute-overlay pattern, not add flow content.

One consequence: because `.settings-devices button` and `.light-presets > button` are dimmed by different mechanisms (see next paragraph), the container-level pending/unavailable classes on `#light-controls` only cascade to its **direct** child buttons (`.light-presets.is-pending > button`, note the `>`). Devices nested inside `#settings-panel` (the five toggles) manage their own `is-pending`/`is-unavailable` classes individually in `js/main.js`, exactly like the plug buttons always have — this avoids the lamp's own pending/unavailable state incorrectly dimming plugs that are independently fine (they share Tuya account secrets but not the `TUYA_DEVICE_ID` secret specifically, so one can be broken while the other works).

## 5. Tuya integration: exact contract

The Worker never talks to Tuya Cloud for device status/commands anymore — `deviceRequest()` in [`src/worker.js`](src/worker.js) forwards to the home bridge (`bridge/`, see §2 and `bridge/README.md`) over a Cloudflare Tunnel, authenticated with `BRIDGE_TOKEN`. It deliberately keeps the same Tuya-Cloud-shaped call sites (`/v1.0/iot-03/devices/<id>/status|commands`) and the same `{ success, result: [{code, value}] }` response shape, so everything below this line — DP names, HSV math, presets, the plug switch-DP detection — is unaffected by *how* the bytes get to the device; only the transport changed.

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

Each plug is wired through the `PLUGS` map in [`src/worker.js`](src/worker.js), keyed by the URL segment used in `/api/plug/<name>/*` and pointing at the Worker secret holding that device's Tuya id: `led` → `TUYA_DEVICE_ID_PLUG_LED`, `lampe` → `TUYA_DEVICE_ID_PLUG_LAMPE`, `multiprises` → `TUYA_DEVICE_ID_PLUG_MULTIPRISES`, `projecteur` → `TUYA_DEVICE_ID_PLUG_PROJECTEUR`. A plug route answers `503` until both the shared Tuya account secrets and that plug's device-id secret exist — same graceful-degradation pattern as `EDITOR_PROFILES`. All four are wired into the UI, individually inside `#settings-panel` (§4) and three of them (`led`/`lampe`/`multiprises`) also combined under the `NS` scene button; add another line to `PLUGS` plus its secret to expose a further plug.

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
| `GET /api/theme` | — | `{ theme, schedule: { dayMinute, nightMinute } }`. `theme` is already resolved through the day/night schedule. Authenticated. |
| `PUT /api/theme` | `{ theme? }`, `{ schedule? }`, or both | Sets the manual theme and/or the schedule; returns the same shape as `GET`. Authenticated. |
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
BRIDGE_URL           https://bridge.<domain> — the Cloudflare Tunnel public hostname (see bridge/README.md)
BRIDGE_TOKEN         must equal the bridge's own BRIDGE_TOKEN (bridge/.env)
TUYA_DEVICE_ID       Tuya device id for the lamp ("Plafonier") — an identifier, not a credential; the actual Tuya account credentials never leave bridge/.env
LIGHT_ACCESS_TOKEN
```

`TUYA_API_REGION`/`TUYA_API_KEY`/`TUYA_API_SECRET` are **not** Worker secrets — deleted from the Worker, confirmed unused. They only matter locally, in `bridge/.env`, and only if you're using the `tinytuya wizard` fallback setup path (the primary path, `tuya-local-key`, needs no Tuya credentials of any kind — see `bridge/README.md`).

Optional Cloudflare secrets (one per extra plug; a route is `503` while its secret is unset):

```text
TUYA_DEVICE_ID_PLUG_LED
TUYA_DEVICE_ID_PLUG_LAMPE
TUYA_DEVICE_ID_PLUG_MULTIPRISES
TUYA_DEVICE_ID_PLUG_PROJECTEUR
```

For a new environment:

1. Set up `bridge/` first — see `bridge/README.md` in full (tinytuya wizard, Docker Compose, Cloudflare Tunnel, local + public curl checks) — and confirm it answers over the tunnel *before* touching the Worker.
2. Put `BRIDGE_URL`, `BRIDGE_TOKEN`, `TUYA_DEVICE_ID`, and any `TUYA_DEVICE_ID_PLUG_*` you want enabled into `bridge/.env` locally (same file, dual purpose: the bridge itself only reads `BRIDGE_TOKEN`/`BRIDGE_PORT`/`BRIDGE_HOST`; the device ids and `BRIDGE_URL` are there only for the next step).
3. Run `node scripts/prepare-cloud-secrets.mjs`.
4. Upload the generated ignored JSON with the command in [`README.md`](README.md).
5. Open the generated ignored `tools/cloudflare/setup-url.txt` once on the owner's iPad.

Never commit `bridge/.env`, `bridge/devices.json`, the generated secret JSON, setup URL, authorization header, or cookie value. The README's older endpoint list is incomplete; this document, [`src/worker.js`](src/worker.js), and `bridge/README.md` are the current source of truth.

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
Today, Date line, Prayer calendar, Next Iqama countdown, Light controls,
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
- The PWA uses network-first responses with offline fallback. **Whenever public HTML, CSS, JS, fonts, icons, or assets change, increment `CACHE_NAME` in `service-worker.js`.** Current cache: `japanese-desk-calendar-v22`.
- A user with an already-open PWA may need one refresh/reopen after deploy to claim the new service worker.

## 8. Design system

- Light paper: `#f5f2ea`; dark paper: `#080807`; ink: near-black; accent: red.
- Key fonts come from `fonts/calendar-fonts.css`:
  - `NemriTechno`: Latin labels/values.
  - `NemriJPN-Brush`: Japanese accents.
  - `KatanaCalendar`: large numerals.
  - `ShipporiAntiqueB1`: Japanese text.
- Prefer thin rules, opaque paper panels, little or no shadow, and measured spacing. Exception: `.settings-panel` and `.light-color-panel` do carry a real `box-shadow` — both are already 100% opaque (`background: var(--paper)`, no alpha), but floating directly over same-coloured content with only a 1px border read as "transparent" with no shadow. Keep the shadow subtle; don't add one to panels that aren't floating over other content.
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
| `e13281c` | Fixed that regression: `#plug-controls` is nested back inside `#light-controls` and made `position: absolute` (like `.light-color-panel`), so it no longer adds height to `.weekday-panel`'s flow. `.light-presets` itself is restored byte-for-byte to its pre-plug CSS. |
| `f1b924a` | Reworked the home screen to 4 buttons (`ON`, `NS` scene, `CHILL`, gear) plus a 7-control `#settings-panel` popup (5 device toggles, `ALL OFF`, `COLOR` nested-popup). No Worker/endpoint changes — `NS` and `ALL OFF` are pure client-side orchestration over the existing `/api/light/*` and `/api/plug/<name>/*` endpoints. Also fixed a latent bug where plug button dimming classes (`is-pending`/`is-unavailable`, set on the button by `js/main.js`) never matched their CSS selectors (written against a container class instead). |
| `697afa7` | `NS` "on" now also turns the lamp off. Hid `.weekday-panel .rule` (Weekday separator), which was overlapping the prayer countdown and reading as a stray red bar under the prayer time. |
| `9c00f3f` | Theme is now shared across devices via `GET`/`PUT /api/theme` (KV, same `EDITOR_PROFILES` namespace as profiles), polled every 60s. Added a daily auto-switch to light at 08:00 Europe/Brussels, computed on read in [`src/theme-model.js`](src/theme-model.js) (no cron), with DST-aware tests. |
| `f1ecb40` | Generalized the single 08:00 flip into a full editable day/night schedule (`DAY`/`NIGHT` time inputs in the settings popup, `theme-schedule` KV key). Shortened the sync poll from 60s to 15s so toggles and schedule edits reach other devices closer to instantly. |
| `04c8c4b` | Gave `#settings-toggle` a real settings glyph (three sliders with knobs) — the previous circle-plus-8-spokes icon read as a sun. Added a subtle `box-shadow` to `.settings-panel`/`.light-color-panel`: both were already opaque but, floating over same-coloured content with only a 1px border, looked "transparent". |
| `13752f2` | Tuya Cloud's free "IoT Core" quota was exhausted, breaking every device button at once. Rather than just renewing it, moved device control off Tuya Cloud entirely: `bridge/` (renamed from `tools/lepro-light/`) now controls all 5 devices over the Tuya **local LAN protocol** on the owner's home PC, reached by the Worker through a Cloudflare Tunnel. `src/worker.js`'s `deviceRequest()` now proxies to the bridge (`BRIDGE_URL`/`BRIDGE_TOKEN` secrets) instead of signing Tuya Cloud requests; `TUYA_API_REGION/KEY/SECRET` are no longer Worker secrets. See §2, §5, §11, and `bridge/README.md`. |
| `9afe859` | Got the bridge fully working against real hardware, without ever needing a working Tuya Cloud quota: `local_key`/DP mapping via `tuya-local-key`'s QR-login flow, LAN `ip`/`version` via a local `tinytuya.deviceScan()`. Fixed `send_commands()` in `bridge.py` (`set_multiple_values` failed on the lamp; loops `set_value` now, verified on all 5 devices). Still open: the lamp's `colour_data` DP is raw hex over local protocol, not the JSON shape `light-model.js` expects. |
| `33218e4` | Cloudflare Tunnel created (`bridge.nemri.uk`, a small dedicated domain bought via Cloudflare Registrar specifically to avoid touching the owner's e-commerce domain's DNS), Worker secrets `BRIDGE_URL`/`BRIDGE_TOKEN` set and confirmed live, `TUYA_API_KEY`/`SECRET`/`REGION` deleted from the Worker (confirmed unused). Migration off Tuya Cloud is complete end-to-end. |
| `6051125` | Bridge performance: persistent per-device connections + `nowait=True` writes. **The `nowait=True` half of this commit was wrong** and its HANDOVER note claimed it was hardware-verified when it had only been tested one command at a time — see the next entry. |
| _current_ | Fixed what `6051125` broke, after the owner reported colour changes working once then silently failing: reverted `nowait=True` (it leaves the device's reply queued on the persistent socket, desyncing every later read), added per-device `RLock`s (the threading server was sharing one socket across concurrent requests for the same device), and added skipping of no-op writes (the real win: a colour change is 1 write instead of 3). Corrected the misleading note in the section at the top of this document. |

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

- The Worker uses a small module-level cache for Mawaqit data (performance only; never store request/user/editor state globally).
- The public prayer source is external. UI should fail gracefully: hide the prayer panel only when there is no prior data; preserve stale cached Worker data when possible.
- Tuya access is intentionally unavailable until the iPad has visited the private setup URL. A disabled light UI is expected when unauthenticated or unavailable.
- **Device control now has a real single point of failure at home**: `bridge/` on the owner's PC, their home internet, and the Cloudflare Tunnel all have to be up for any lamp/plug button to work — this was a deliberate trade (see §2, §11's change history) made specifically to stop depending on Tuya Cloud's "IoT Core" quota, which had run out and broken every device button at once. If device control breaks again, check `bridge/README.md`'s `/healthz` endpoint and the tunnel status *before* assuming it's a code or Tuya Cloud problem — it's now much more likely to be "is the home PC/bridge container actually running."
- `bridge/` is load-bearing production infrastructure now, not a diagnostic fallback — see `bridge/README.md` for setup, Docker Compose, and the migration note for moving it to another always-on machine.
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
