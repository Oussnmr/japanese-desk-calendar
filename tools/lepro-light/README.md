# Lepro light bridge

This local bridge keeps Tuya Cloud credentials in `.env` and exposes only:

- `GET /api/light/status`
- `POST /api/light/on`
- `POST /api/light/off`

Run locally with:

```powershell
.\.venv\Scripts\python.exe .\bridge.py
```

The calendar uses a per-device bridge address because the hosted site must not publish a private LAN address.

To configure the calendar on one device without publishing a LAN address, open the
calendar once with `?bridge=http://PC-LAN-IP:8787`. The address is then stored only
in that browser's local storage.
