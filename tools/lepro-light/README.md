# Lepro light bridge

This local bridge keeps Tuya Cloud credentials in `.env` and exposes only:

- `GET /api/light/status`
- `POST /api/light/on`
- `POST /api/light/off`

Run locally with:

```powershell
.\.venv\Scripts\python.exe .\bridge.py
```

It intentionally has no calendar integration: the hosted HTTPS calendar cannot reliably call a local HTTP service from iPad Safari.
