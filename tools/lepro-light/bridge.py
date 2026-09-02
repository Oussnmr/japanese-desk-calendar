"""LAN bridge for one Tuya light, also serving the calendar for same-origin iPad use."""

import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import tinytuya

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
ALLOWED_ORIGIN = "https://oussnmr.github.io"
STATIC_ROOT_FILES = {"index.html", "styles.css", "manifest.webmanifest", "service-worker.js"}
STATIC_DIRS = {"js", "icons", "fonts"}


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


def static_file_for(request_path):
    """Resolve only the public calendar assets; never expose tools/ or .env."""
    path = unquote(urlsplit(request_path).path)
    if path == "/":
        relative = Path("index.html")
    else:
        relative = Path(path.lstrip("/"))

    if not relative.parts or ".." in relative.parts:
        return None

    first = relative.parts[0]
    allowed = (len(relative.parts) == 1 and first in STATIC_ROOT_FILES) or first in STATIC_DIRS
    if not allowed:
        return None

    candidate = (PROJECT_ROOT / relative).resolve()
    if PROJECT_ROOT != candidate and PROJECT_ROOT not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


class BridgeHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def respond_file(self, file_path):
        body = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        if file_path.suffix in {".js", ".css", ".html", ".webmanifest"}:
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/light/status":
            try:
                self.respond_json(200, status())
            except RuntimeError:
                self.respond_json(503, {"error": "unavailable"})
            return

        file_path = static_file_for(self.path)
        if file_path:
            self.respond_file(file_path)
            return

        self.respond_json(404, {"error": "not found"})

    def do_POST(self):
        path = urlsplit(self.path).path
        actions = {"/api/light/on": True, "/api/light/off": False}
        if path not in actions:
            self.respond_json(404, {"error": "not found"})
            return
        try:
            self.respond_json(200, power(actions[path]))
        except RuntimeError:
            self.respond_json(503, {"error": "unavailable"})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    port = int(CONFIG.get("BRIDGE_PORT", "8787"))
    host = CONFIG.get("BRIDGE_HOST", "127.0.0.1")
    print(f"Japanese Desk Calendar + Lepro bridge: http://{host}:{port}/")
    ThreadingHTTPServer((host, port), BridgeHandler).serve_forever()
