# Japanese Desk Calendar

A dependency-free Japanese editorial desk calendar for an iPad in landscape.
It displays Brussels date/time, Open-Meteo weather, a locally persisted day/night
preference, and secure control of one Tuya light.

## Final architecture

One Cloudflare Worker serves the static PWA and the same-origin HTTPS API:

```
iPad PWA → Cloudflare Worker → Cloudflare Tunnel → bridge/ (home PC) → Tuya local LAN → devices
```

The browser only calls the `/api/light/*` and `/api/plug/*` routes; the
Worker never talks to Tuya Cloud for device control. The personal control
token is installed once as an HttpOnly same-site cookie by visiting a
private setup URL on the iPad. See `HANDOVER.md` §2/§5 and `bridge/README.md`
for the full picture — this file is a quick pointer, not the source of truth.

`bridge/` (formerly `tools/lepro-light`) is load-bearing production
infrastructure, not an optional fallback: it must be running (Docker, on an
always-on home PC) for any device control to work at all.

## Development

```sh
npm run build
npm run check
```

`npm run build` creates the ignored `dist/` directory containing only public
assets. This deliberate allow-list prevents tooling, local `.env` files, and
unrelated font sources from being uploaded.

## Deploy

1. Log in once with `npx wrangler login` and register a `workers.dev` subdomain.
2. Set up `bridge/` first — see `bridge/README.md` (Tuya local keys, Docker Compose, Cloudflare Tunnel) — and confirm it over the tunnel before touching Worker secrets.
3. Put `BRIDGE_URL`/`BRIDGE_TOKEN`/device ids in `bridge/.env` locally, then run `node scripts/prepare-cloud-secrets.mjs` and upload its ignored output
   with `Get-Content -Raw tools/cloudflare/.cloudflare-secrets.json | npx wrangler secret bulk`.
4. Run `npm run deploy`.

After deployment, open the generated private `/setup/<personal-token>` URL on
the iPad once. It redirects to the calendar and authorizes only that browser.

## iPad use

In Safari, open the deployed HTTPS URL, choose **Share → Add to Home Screen**,
then launch it from the new icon. The manifest requests standalone landscape
display. Date/time always use `Europe/Brussels`; weather refreshes every 20
minutes and uses the latest cached reading if offline.

The screen wake lock is best-effort because iPadOS may release it due to power
or system policy. For an always-on desk display, use **Settings → Display &
Brightness → Auto-Lock → Never** while the iPad is powered.
