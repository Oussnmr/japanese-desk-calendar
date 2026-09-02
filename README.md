# Japanese Desk Calendar

A dependency-free Japanese editorial desk calendar for an iPad in landscape.
It displays Brussels date/time, Open-Meteo weather, a locally persisted day/night
preference, and secure control of one Tuya light.

## Final architecture

One Cloudflare Worker serves the static PWA and the same-origin HTTPS API:

```
iPad PWA → Cloudflare Worker → Tuya Cloud → light
```

The browser only calls `GET /api/light/status`, `POST /api/light/on`, and
`POST /api/light/off`. Tuya credentials never leave the Worker secrets store.
The personal control token is installed once as an HttpOnly same-site cookie by
visiting a private setup URL on the iPad.

`tools/lepro-light` remains a local Python fallback for diagnostics. It is not
needed once the Cloudflare deployment is live.

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
2. Keep Tuya values only in `tools/lepro-light/.env` locally.
3. Run `node scripts/prepare-cloud-secrets.mjs`, then upload its ignored output
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
