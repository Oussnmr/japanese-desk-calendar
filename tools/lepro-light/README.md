# Lepro light bridge

This local bridge keeps Tuya Cloud credentials in `.env`, controls the light, and also serves the existing calendar so the iPad can use one HTTP origin on the home LAN.

API:

- `GET /api/light/status`
- `POST /api/light/toggle`
- `POST /api/light/on`
- `POST /api/light/off`
- `POST /api/light/preset/chill`
- `POST /api/light/preset/bright`

Run locally from this folder with:

```powershell
.\.venv\Scripts\python.exe .\bridge.py
```

For access from another device on the LAN, `BRIDGE_HOST` in the local `.env` must bind to the LAN (for example `0.0.0.0`). Keep `.env` local; it is ignored by Git.

With the current PC address, open this on the iPad while connected to the same Wi-Fi:

```text
http://192.168.129.57:8787/
```

The calendar and light API are then same-origin, so the LIGHT controls use relative `/api/light/...` requests rather than an HTTPS GitHub Pages page calling an HTTP LAN service.

GitHub Pages remains usable as the normal hosted calendar. Its light control may remain unavailable on Safari because of HTTPS-to-HTTP local-network restrictions.
