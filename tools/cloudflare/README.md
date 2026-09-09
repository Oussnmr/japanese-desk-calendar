# Cloudflare deployment notes

The Worker serves the calendar and the light API from one HTTPS origin. It no
longer holds Tuya Cloud credentials — device control goes through `bridge/`
(a home-network service, see `bridge/README.md`) over a Cloudflare Tunnel.
The Worker's own secrets are `BRIDGE_URL`, `BRIDGE_TOKEN`, the Tuya device ids,
and the personal light token; none of these must ever be added to browser
JavaScript or committed to Git.

Light API:

- `GET /api/light/status`
- `POST /api/light/toggle`
- `POST /api/light/preset/chill`
- `POST /api/light/preset/bright`
- `POST /api/light/on` and `POST /api/light/off` remain compatibility endpoints.

`bridge/` (formerly `tools/lepro-light`) is now load-bearing production
infrastructure, not a fallback — the deployed calendar depends on it being up.

Deployment is performed with `npm run deploy` after Cloudflare authentication
and after the secrets have been uploaded through Wrangler. The final iPad setup
is a one-time visit to the private `/setup/<personal-token>` URL, which stores
the token in an HttpOnly, same-site cookie. The browser never exposes Tuya
credentials or the bridge token.
