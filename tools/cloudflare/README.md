# Cloudflare deployment notes

The Worker serves the calendar and the light API from one HTTPS origin. Tuya
credentials and the personal light token are Worker secrets; they must never be
added to browser JavaScript or committed to Git.

Light API:

- `GET /api/light/status`
- `POST /api/light/toggle`
- `POST /api/light/preset/chill`
- `POST /api/light/preset/bright`
- `POST /api/light/on` and `POST /api/light/off` remain compatibility endpoints.

`tools/lepro-light` remains the local debugging fallback. It is not used by the
deployed calendar.

Deployment is performed with `npm run deploy` after Cloudflare authentication
and after the secrets have been uploaded through Wrangler. The final iPad setup
is a one-time visit to the private `/setup/<personal-token>` URL, which stores
the token in an HttpOnly, same-site cookie. The browser never exposes the Tuya
credentials.
