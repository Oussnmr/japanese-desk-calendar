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
import threading
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
CONNECTIONS = {}  # device id -> persistent tinytuya.Device, reused across requests
# This is a ThreadingHTTPServer, so two overlapping requests for the same
# device (a colour drag landing on top of the previous command's confirm
# poll, say) would otherwise use the same socket from two threads at once
# and corrupt it - which showed up as "one colour change works, the next
# does nothing". One lock per device: same device serialises, different
# devices still run in parallel.
# RLock, not Lock: send_commands() ends by calling status_as_result(), which
# takes the same lock again on the same thread.
DEVICE_LOCKS = {device_id: threading.RLock() for device_id in DEVICES}


def tuya_device(entry, fresh=False, transient=False):
    # Opening a new local-protocol connection per request (TCP + the Tuya
    # session handshake, especially on v3.4) is the main reason RGB/plug
    # commands felt slow through the bridge - each command used to do
    # several sequential device round-trips (read current state, send,
    # confirm), every one paying that handshake cost again. Keep one
    # persistent connection per device instead and only reconnect if it's
    # gone stale.
    if fresh or transient:
        previous = CONNECTIONS.pop(entry["id"], None)
        if previous is not None:
            previous.close()
    if transient:
        device = tinytuya.Device(entry["id"], entry["ip"], entry["key"], version=entry["version"])
        device.set_socketPersistent(False)
        return device
    device = CONNECTIONS.get(entry["id"])
    if device is None:
        device = tinytuya.Device(entry["id"], entry["ip"], entry["key"], version=entry["version"])
        device.set_socketPersistent(True)
        CONNECTIONS[entry["id"]] = device
    return device


def device_status(entry, transient=False, fresh=False):
    device = tuya_device(entry, fresh=fresh, transient=transient)
    try:
        return device.status()
    finally:
        if transient:
            device.close()


def device_set_value(entry, index, value, transient=False, fresh=False):
    device = tuya_device(entry, fresh=fresh, transient=transient)
    try:
        response = device.set_value(index, value, nowait=False)
        if transient and isinstance(response, dict) and ("Err" in response or "Error" in response):
            raise RuntimeError("Tuya refused the device command")
        return response
    finally:
        if transient:
            device.close()


def index_for_code(entry, code):
    index = entry["mapping_reverse"].get(code)
    if index is None:
        raise RuntimeError(f"Device {entry['id']} has no DP mapped to code {code!r}")
    return index


def raw_status(entry, use_cache=True, transient=False):
    if transient:
        use_cache = False
    cached = STATUS_CACHE.get(entry["id"])
    now = time.monotonic() * 1000
    if use_cache and cached and now - cached["at"] < STATUS_CACHE_MS:
        return cached["dps"]
    with DEVICE_LOCKS[entry["id"]]:
        try:
            result = device_status(entry, transient=transient)
            dps = result.get("dps")
        except Exception:
            dps = None
        if dps is None:
            # The persistent connection may have gone stale (device rebooted,
            # brief network hiccup) - retry once with a fresh one before giving up.
            result = device_status(entry, transient=transient, fresh=True)
            dps = result.get("dps")
        if dps is None:
            raise RuntimeError(f"Local status request failed for device {entry['id']}: {result}")
        STATUS_CACHE[entry["id"]] = {"at": now, "dps": dps}
        return dps


def status_as_result(entry, transient=False):
    dps = raw_status(entry, transient=transient)
    return [{"code": entry["mapping"][index], "value": value} for index, value in dps.items() if index in entry["mapping"]]


def send_commands(entry, commands, transient=False, direct=False):
    # set_multiple_values() gets "Unexpected Payload from Device" on at least
    # the v3.3 lamp - confirmed against real hardware that individual
    # set_value() calls work reliably across all 5 devices instead.
    #
    # nowait must stay False on a persistent connection: nowait=True fires the
    # command without reading the device's reply, so that reply stays queued in
    # the socket and every later read gets the *previous* message instead. That
    # showed up exactly as "one colour change works, the next does nothing" -
    # partial/stale dps coming back, drifting further out of sync each call.
    with DEVICE_LOCKS[entry["id"]]:
        if direct:
            # Authenticated local controller: one explicit lamp value per call.
            # The TinyTuya call still waits for its ACK, but an immediately
            # following status can be stale and must not hold up the next key.
            if transient or len(commands) != 1 or commands[0].get("code") not in {"switch_led", "bright_value", "temp_value"}:
                raise ValueError("Direct mode requires one lamp power or white-control value")
            item = commands[0]
            index = index_for_code(entry, item["code"])
            response = device_set_value(entry, index, item["value"])
            if isinstance(response, dict) and ("Err" in response or "Error" in response):
                raise RuntimeError("Tuya refused the device command")
            STATUS_CACHE.pop(entry["id"], None)
            return []  # No claim that a fresh physical status was observed.
        # Skip DPs that already hold the requested value. Every colour change
        # from the Worker sends switch_led=true + work_mode=colour +
        # colour_data=X, and each write costs a full ACK round trip - but while
        # dragging the wheel the first two are already true, so this turns a
        # 3-write change into a 1-write one.
        try:
            current = raw_status(entry, transient=transient)
        except RuntimeError:
            current = {}
        for item in commands:
            index = index_for_code(entry, item["code"])
            if not transient and index in current and current[index] == item["value"]:
                continue
            try:
                device_set_value(entry, index, item["value"], transient=transient)
            except Exception:
                if transient:
                    # The write may have reached the device. Let the client
                    # verify the state before deciding whether to retry.
                    raise
                # Persistent connection may have gone stale - one retry with a fresh one.
                device_set_value(entry, index, item["value"], fresh=True)
        STATUS_CACHE.pop(entry["id"], None)  # force a fresh read on the next status() call
        return status_as_result(entry, transient=transient)


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
            transient = self.headers.get("X-Tuya-Transient") == "1"
            self.respond_json(200, {"success": True, "result": status_as_result(entry, transient=transient)})
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
            transient = self.headers.get("X-Tuya-Transient") == "1"
            direct = self.headers.get("X-Tuya-Direct") == "1"
            self.respond_json(200, {"success": True, "result": send_commands(entry, body.get("commands", []), transient=transient, direct=direct)})
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
