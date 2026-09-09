# Local Tuya bridge

Controls all 5 Tuya devices (the "Plafonier" lamp + `led`/`lampe`/
`multiprises`/`projecteur` plugs) over the Tuya **local LAN protocol**
(`tinytuya`), not Tuya Cloud. This is what the Worker calls in production —
see `HANDOVER.md` §5 for the full architecture and why. Tuya Cloud is only
touched once, during setup, to fetch each device's `local_key`.

## One-time setup

### Getting each device's local_key (no Tuya Developer/IoT Core account needed)

`python -m tinytuya wizard` (the tinytuya-native setup path) needs a working
Tuya Cloud **IoT Core** API quota. That quota is shared with a separate,
easily-exhausted, one-time-only free "Cloud Develop Base Resource Trial"
pool — if that's already exhausted, the wizard fails with
`Code 28841004: 'IoT Core trial quota is exhausted.'` and there is no clean
way to re-subscribe. **This is what actually worked instead**, and needs no
Tuya developer project, Access ID, or Access Secret at all:

1. Run [`vineetchoudhary/tuya-local-key`](https://github.com/vineetchoudhary/tuya-local-key)
   locally, bound to localhost only (its web UI has **no authentication by
   default** — never expose this port beyond your own machine):
   ```sh
   docker run -d --name tuya-local-key -p 127.0.0.1:8000:8000 -v tuya-session:/data \
     ghcr.io/vineetchoudhary/tuya-local-key:latest
   ```
2. Open `http://127.0.0.1:8000`, log in by scanning the QR code with the
   Smart Life/Tuya Smart app on your phone (same official flow Home
   Assistant's own Tuya integration uses — no password ever entered here).
3. Once logged in, `curl http://127.0.0.1:8000/api/devices` returns every
   device's `id`, `local_key`, and (critically) a `local_strategy` object
   shaped `{"<dp index>": {"status_code": "<code>", ...}}` — exactly the
   index→code mapping this bridge needs, straight from Tuya's own device
   specification, no guessing.
4. Build `devices.json` from that response: for each device, write
   `{ "id", "key": <local_key>, "mapping": {index: status_code, ...}, "ip": null, "version": null }`.
   (There's no committed script for this step yet — it was done inline as a
   short Python one-liner; worth turning into a real script here if you're
   doing this again.)
5. **Stop and remove the `tuya-local-key` container** — its job is done,
   and its unauthenticated web UI is a real exposure if left running:
   `docker rm -f tuya-local-key`.
6. Fill in the real `ip`/`version` per device with a pure local network
   scan (no cloud, no credentials — just needs to run on the same LAN as
   the devices):
   ```sh
   python -c "import tinytuya; print(tinytuya.deviceScan(False, 15))"
   ```
   Match by `id` and copy `ip`/`version` into `devices.json`.
7. Sanity-check every one of the 5 entries in `devices.json` has non-empty
   `id`, `key`, `ip`, `version`, and a non-empty `mapping`.
8. `docker compose up -d --build bridge` (just the bridge service, not
   `cloudflared` yet).
9. **Test locally before touching the tunnel or the Worker** (per the
   rollout order in `HANDOVER.md`):
   ```sh
   curl http://127.0.0.1:8787/healthz
   curl -H "Authorization: Bearer <BRIDGE_TOKEN>" http://127.0.0.1:8787/device/<device_id>/status
   curl -X POST -H "Authorization: Bearer <BRIDGE_TOKEN>" -H "Content-Type: application/json" \
        -d '{"commands":[{"code":"switch_led","value":true}]}' \
        http://127.0.0.1:8787/device/<device_id>/commands
   ```
   Confirm the physical device actually reacts and the returned `result`
   array has sane `code`/`value` pairs. Verified against real hardware
   (one v3.3 lamp, three v3.4 plugs): reads work fine; if writes come back
   `{"success": false, "msg": "Unexpected Payload from Device"}`, that's
   `set_multiple_values()` failing on that firmware — already worked
   around in `send_commands()` (loops `set_value()` per DP instead), so
   this shouldn't recur, but if it does on a *new* device, that's the
   first thing to check.

   The lamp's `colour_data` DP (not `colour_data_v2`) is the legacy Type A
   14-digit `rrggbbhhhhssvv` local format. `light-model.js` detects, parses,
   and encodes it directly (alongside JSON and 12-digit Type B HSV). For
   status synchronization it trusts the leading RGB bytes, because this
   lamp has returned stale/inconsistent trailing hue bytes while in white
   mode. Red, green, and blue writes were verified against the real lamp on
   2026-09-09; the bridge returned each exact payload.
10. Create the Cloudflare Tunnel (once): `cloudflared tunnel login`, then
   `cloudflared tunnel create jdc-bridge` from the Zero Trust dashboard
   (Networks → Tunnels → Create a tunnel → select Docker), which gives you
   the `CLOUDFLARE_TUNNEL_TOKEN` for `.env`. In the same dashboard flow, add
   a **Public Hostname**: pick a subdomain of your existing domain (e.g.
   `bridge.<your-domain>`) pointing at service `http://bridge:8787`.
11. `docker compose up -d` again (picks up the tunnel token), then confirm
   from *outside* your LAN:
   ```sh
   curl https://bridge.<your-domain>/healthz
   curl -H "Authorization: Bearer <BRIDGE_TOKEN>" https://bridge.<your-domain>/device/<device_id>/status
   ```
12. Only once both of those work: set the Worker secrets `BRIDGE_URL`
   (`https://bridge.<your-domain>`) and `BRIDGE_TOKEN` (same value as here),
   then deploy. See `HANDOVER.md` for exactly what changes in `src/worker.js`.

## Moving to another machine (e.g. the M920q)

Install Docker, copy this whole `bridge/` folder including your real
`.env` and `devices.json` (both gitignored, so `git clone` alone won't bring
them - copy them separately, e.g. over the LAN or a USB stick), then
`docker compose up -d --build`. The Cloudflare Tunnel token isn't tied to a
machine, so nothing needs to change on the Cloudflare side.

## API

All routes except `/healthz` require `Authorization: Bearer <BRIDGE_TOKEN>`.

- `GET /healthz` - `{ "ok": true, "devices": <count> }`, no auth, for quick liveness checks.
- `GET /device/<id>/status` - `{ "success": true, "result": [{ "code", "value" }, ...] }`.
- `POST /device/<id>/commands` - body `{ "commands": [{ "code", "value" }, ...] }`, same response shape as status.

This mirrors Tuya Cloud's own `/v1.0/iot-03/devices/{id}/status` and
`.../commands` shapes on purpose, so `src/worker.js`'s existing DP
normalization (`light-model.js`, `plug-model.js`) needs no changes - only
`deviceRequest()`'s transport changes.
