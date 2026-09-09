# Local Tuya bridge

Controls all 5 Tuya devices (the "Plafonier" lamp + `led`/`lampe`/
`multiprises`/`projecteur` plugs) over the Tuya **local LAN protocol**
(`tinytuya`), not Tuya Cloud. This is what the Worker calls in production —
see `HANDOVER.md` §5 for the full architecture and why. Tuya Cloud is only
touched once, during setup, to fetch each device's `local_key`.

## One-time setup

1. Copy `.env.example` to `.env` and fill in `TUYA_API_REGION`/`TUYA_API_KEY`/
   `TUYA_API_SECRET` (the same three values already used as Worker secrets —
   see `tools/cloudflare/`) and a fresh `BRIDGE_TOKEN` (command to generate
   one is in `.env.example`).
2. `pip install -r requirements.txt` (or use a venv, as before).
3. `python -m tinytuya wizard`, run from this folder. Log in with the Tuya
   Cloud credentials from `.env` when prompted. **Say yes when it offers to
   scan/poll the local devices** — that step is what fills in each device's
   `ip` and `version`, which this bridge needs. This writes `devices.json`
   (and `snapshot.json`) here; both are gitignored, never commit them.
4. Open `devices.json` and sanity-check that every one of the 5 devices has
   non-empty `id`, `key`, `ip`, `version`, and a non-empty `mapping` (the
   DP index → code table, e.g. `"1": "switch_led"`). If `mapping` is empty
   for a device, the wizard's cloud lookup for that device's specification
   failed — re-run the wizard, or check that device's category is
   supported by `tinytuya`.
5. `docker compose up -d --build`.
6. **Test locally before touching anything else** (per the rollout order in
   `HANDOVER.md`):
   ```sh
   curl http://127.0.0.1:8787/healthz
   curl -H "Authorization: Bearer <BRIDGE_TOKEN>" http://127.0.0.1:8787/device/<device_id>/status
   curl -X POST -H "Authorization: Bearer <BRIDGE_TOKEN>" -H "Content-Type: application/json" \
        -d '{"commands":[{"code":"switch_led","value":true}]}' \
        http://127.0.0.1:8787/device/<device_id>/commands
   ```
   Confirm the physical device actually reacts and the returned `result`
   array has sane `code`/`value` pairs. **If a `commands` call fails with an
   error mentioning `set_multiple_values`**, your installed `tinytuya`
   version doesn't have that method - open an issue with me (or ask
   whichever assistant is on duty) to switch `send_commands()` in
   `bridge.py` to loop `device.set_value(index, value)` per DP instead.
7. Create the Cloudflare Tunnel (once): `cloudflared tunnel login`, then
   `cloudflared tunnel create jdc-bridge` from the Zero Trust dashboard
   (Networks → Tunnels → Create a tunnel → select Docker), which gives you
   the `CLOUDFLARE_TUNNEL_TOKEN` for `.env`. In the same dashboard flow, add
   a **Public Hostname**: pick a subdomain of your existing domain (e.g.
   `bridge.<your-domain>`) pointing at service `http://bridge:8787`.
8. `docker compose up -d` again (picks up the tunnel token), then confirm
   from *outside* your LAN:
   ```sh
   curl https://bridge.<your-domain>/healthz
   curl -H "Authorization: Bearer <BRIDGE_TOKEN>" https://bridge.<your-domain>/device/<device_id>/status
   ```
9. Only once both of those work: set the Worker secrets `BRIDGE_URL`
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
