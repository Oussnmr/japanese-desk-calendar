"""Minimal LAN bridge for one Tuya light. Secrets stay in the local .env file."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import tinytuya

ROOT = Path(__file__).resolve().parent
ALLOWED_ORIGIN = "https://oussnmr.github.io"


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


def cloud():
    required = ("TUYA_API_REGION", "TUYA_API_KEY", "TUYA_API_SECRET", "TUYA_DEVICE_ID")
    missing = [name for name in required if not CONFIG.get(name)]
    if missing:
        raise RuntimeError("Bridge not configured")
    return tinytuya.Cloud(
        apiRegion=CONFIG["TUYA_API_REGION"],
        apiKey=CONFIG["TUYA_API_KEY"],
        apiSecret=CONFIG["TUYA_API_SECRET"],
        apiDeviceID=CONFIG["TUYA_DEVICE_ID"],
    )


def power(value):
    response = cloud().sendcommand(
        CONFIG["TUYA_DEVICE_ID"],
        {"commands": [{"code": "switch_led", "value": value}]},
    )
    if not response.get("success"):
        raise RuntimeError("Tuya command was rejected")
    return {"on": value}


def status():
    response = cloud().getstatus(CONFIG["TUYA_DEVICE_ID"])
    if not response.get("success"):
        raise RuntimeError("Tuya status request was rejected")
    result = {item["code"]: item["value"] for item in response.get("result", [])}
    return {"on": bool(result.get("switch_led", result.get("switch_1", False)))}


class BridgeHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path != "/api/light/status":
            self.respond(404, {"error": "not found"})
            return
        try:
            self.respond(200, status())
        except RuntimeError:
            self.respond(503, {"error": "unavailable"})

    def do_POST(self):
        actions = {"/api/light/on": True, "/api/light/off": False}
        if self.path not in actions:
            self.respond(404, {"error": "not found"})
            return
        try:
            self.respond(200, power(actions[self.path]))
        except RuntimeError:
            self.respond(503, {"error": "unavailable"})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    port = int(CONFIG.get("BRIDGE_PORT", "8787"))
    host = CONFIG.get("BRIDGE_HOST", "127.0.0.1")
    print(f"Lepro bridge listening on {host}:{port}")
    ThreadingHTTPServer((host, port), BridgeHandler).serve_forever()
