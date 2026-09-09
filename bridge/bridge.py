"""LAN bridge for all 5 Tuya devices (lamp + 4 plugs), reached through a
Cloudflare Tunnel by the Worker. Talks to devices over the Tuya LOCAL
protocol (tinytuya), never Tuya Cloud, so day-to-day operation does not
consume the Tuya Cloud "IoT Core" API quota.

Setup (one-time, see README.md): produce `devices.json` here, containing
each device's local_key, LAN ip, protocol version, and DP (data point)
index-to-code mapping - either via `python -m tinytuya wizard` (needs a
working Tuya IoT Core Cloud quota) or, if that quota is exhausted, via the
`tuya-local-key` tool (no developer account needed at all - see README).
This bridge only ever reads that file; it never calls Tuya Cloud itself.

Every request must carry `Authorization: Bearer <BRIDGE_TOKEN>` - unlike the
old same-origin-LAN version of this file, this one is reachable from the
public internet through the tunnel.
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import tinytuya

ROOT = Path(__file__).resolve().parent
DEVICES_FILE = ROOT / "devices.json"
STATUS_CACHE_MS = 800  # de-dupe status bursts (e.g. several clients polling within the same second)


def load_env():
    values = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    return {**values, **os.environ}


CONFIG = load_env()
BRIDGE_TOKEN = CONFIG.get("BRIDGE_TOKEN", "")


def normalize_mapping(raw_mapping):
    """tinytuya wizard output nests dp info as {"<index>": {"code": ..., ...}}
    in some versions and as a flat {"<index>": "<code>"} in others - accept
    either shape and always produce {"<index>": "<code>"}."""
    mapping = {}
    for index, info in (raw_mapping or {}).items():
        if isinstance(info, dict):
            code = info.get("code")
        else:
            code = info
        if code:
            mapping[str(index)] = str(code)
    return mapping


def load_devices():
    if not DEVICES_FILE.exists():
        raise RuntimeError(f"{DEVICES_FILE.name} not found - run the one-time setup in README.md")
    entries = json.loads(DEVICES_FILE.read_text(encoding="utf-8"))
    devices = {}
    for entry in entries:
        device_id = entry.get("id")
        local_key = entry.get("key")
        ip = entry.get("ip")
        version = str(entry.get("version") or "3.3")
        mapping = normalize_mapping(entry.get("mapping"))
        if not (device_id and local_key and ip and mapping):
            continue
        devices[device_id] = {
            "id": device_id,
            "key": local_key,
            "ip": ip,
            "version": version,
            "mapping": mapping,
            "mapping_reverse": {code: index for index, code in mapping.items()},
        }
    return devices


DEVICES = load_devices()
STATUS_CACHE = {}


def tuya_device(entry):
    return tinytuya.Device(entry["id"], entry["ip"], entry["key"], version=entry["version"])


def index_for_code(entry, code):
    index = entry["mapping_reverse"].get(code)
    if index is None:
        raise RuntimeError(f"Device {entry['id']} has no DP mapped to code {code!r}")
    return index


def raw_status(entry, use_cache=True):
    cached = STATUS_CACHE.get(entry["id"])
    now = time.monotonic() * 1000
    if use_cache and cached and now - cached["at"] < STATUS_CACHE_MS:
        return cached["dps"]
    result = tuya_device(entry).status()
    dps = result.get("dps")
    if dps is None:
        raise RuntimeError(f"Local status request failed for device {entry['id']}: {result}")
    STATUS_CACHE[entry["id"]] = {"at": now, "dps": dps}
    return dps


def status_as_result(entry):
    dps = raw_status(entry)
    return [{"code": entry["mapping"][index], "value": value} for index, value in dps.items() if index in entry["mapping"]]


def send_commands(entry, commands):
    # set_multiple_values() gets "Unexpected Payload from Device" on at least
    # the v3.3 lamp - confirmed against real hardware that individual
    # set_value() calls work reliably across all 5 devices instead.
    device = tuya_device(entry)
    for item in commands:
        index = index_for_code(entry, item["code"])
        response = device.set_value(index, item["value"], nowait=False)
        if isinstance(response, dict) and response.get("Error"):
            raise RuntimeError(response["Error"])
    STATUS_CACHE.pop(entry["id"], None)  # force a fresh read on the next status() call
    return status_as_result(entry)


class BridgeHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        header = self.headers.get("Authorization", "")
        return bool(BRIDGE_TOKEN) and header == f"Bearer {BRIDGE_TOKEN}"

    def device_from_path(self, path):
        parts = path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "device" or parts[2] not in ("status", "commands"):
            return None, None
        return DEVICES.get(parts[1]), parts[2]

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/healthz":
            self.respond_json(200, {"ok": True, "devices": len(DEVICES)})
            return
        if not self.authorized():
            self.respond_json(401, {"error": "unauthorized"})
            return
        entry, action = self.device_from_path(path)
        if not entry or action != "status":
            self.respond_json(404, {"error": "not found"})
            return
        try:
            self.respond_json(200, {"success": True, "result": status_as_result(entry)})
        except RuntimeError as error:
            self.respond_json(503, {"success": False, "msg": str(error)})

    def do_POST(self):
        if not self.authorized():
            self.respond_json(401, {"error": "unauthorized"})
            return
        entry, action = self.device_from_path(urlsplit(self.path).path)
        if not entry or action != "commands":
            self.respond_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            self.respond_json(200, {"success": True, "result": send_commands(entry, body.get("commands", []))})
        except (RuntimeError, ValueError, json.JSONDecodeError) as error:
            self.respond_json(503, {"success": False, "msg": str(error)})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    if not BRIDGE_TOKEN:
        raise SystemExit("BRIDGE_TOKEN is not set in .env - refusing to start unauthenticated")
    port = int(CONFIG.get("BRIDGE_PORT", "8787"))
    host = CONFIG.get("BRIDGE_HOST", "0.0.0.0")
    print(f"Loaded {len(DEVICES)} device(s) from {DEVICES_FILE.name}")
    print(f"Local Tuya bridge listening on http://{host}:{port}/")
    ThreadingHTTPServer((host, port), BridgeHandler).serve_forever()
