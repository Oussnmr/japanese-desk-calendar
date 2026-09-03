"""LAN bridge for one Tuya light, also serving the calendar for same-origin iPad use."""

import json
import mimetypes
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import tinytuya

ROOT = Path(__file__).resolve().parent
ALLOWED_ORIGIN = "https://oussnmr.github.io"
STATIC_ROOT_FILES = {"index.html", "styles.css", "manifest.webmanifest", "service-worker.js"}
STATIC_DIRS = {"js", "icons", "fonts", "assets"}
POWER_DP = "switch_led"
MODE_DP = "work_mode"
BRIGHTNESS_DP = "bright_value"
TEMPERATURE_DP = "temp_value"
COLOR_DPS = ("colour_data_v2", "colour_data")
BRIGHTNESS_MAX = 255
CHILL_BRIGHTNESS = round(BRIGHTNESS_MAX * 0.35)
CHILL_TEMPERATURE = round(255 * 0.50)
BRIGHT_TEMPERATURE = 255
PRESET_TOLERANCE = 3


def find_project_root():
    """Find the calendar root robustly instead of assuming a fixed parent depth."""
    for candidate in (ROOT, *ROOT.parents):
        if (candidate / "index.html").is_file() and (candidate / "js").is_dir():
            return candidate.resolve()
    raise RuntimeError("Calendar project root not found")


PROJECT_ROOT = find_project_root()


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


def send_commands(commands, confirmed):
    response = cloud().sendcommand(
        CONFIG["TUYA_DEVICE_ID"],
        {"commands": commands},
    )
    if not response.get("success"):
        raise RuntimeError("Tuya command was rejected")
    state = None
    for _attempt in range(6):
        time.sleep(0.4)
        state = status()
        if confirmed(state):
            return state
    raise RuntimeError("Light state confirmation timed out")


def power(value):
    return send_commands(
        [{"code": POWER_DP, "value": value}],
        lambda state: state["on"] is value,
    )


def apply_preset(name):
    presets = {
        "chill": (CHILL_BRIGHTNESS, CHILL_TEMPERATURE),
        "bright": (BRIGHTNESS_MAX, BRIGHT_TEMPERATURE),
    }
    if name not in presets:
        raise RuntimeError("Unknown preset")
    brightness, temperature = presets[name]
    return send_commands(
        [
            {"code": POWER_DP, "value": True},
            {"code": MODE_DP, "value": "white"},
            {"code": BRIGHTNESS_DP, "value": brightness},
            {"code": TEMPERATURE_DP, "value": temperature},
        ],
        lambda state: state["preset"] == name,
    )


def percent_raw(value):
    if not isinstance(value, (int, float)):
        raise RuntimeError("Invalid percentage")
    return max(0, min(100, round(value)))


def color_data(color, scale):
    try:
        red, green, blue = (max(0, min(255, round(float(color[key])))) / 255 for key in ("r", "g", "b"))
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("Invalid RGB color") from None
    maximum, minimum = max(red, green, blue), min(red, green, blue)
    delta = maximum - minimum
    hue = 0
    if delta:
        if maximum == red:
            hue = 60 * ((green - blue) / delta % 6)
        elif maximum == green:
            hue = 60 * ((blue - red) / delta + 2)
        else:
            hue = 60 * ((red - green) / delta + 4)
    return json.dumps({"h": round(hue), "s": round((delta / maximum if maximum else 0) * scale), "v": round(maximum * scale)})


def color_code(values):
    return next((code for code in COLOR_DPS if code in values), None)


def color_scale(code):
    return 1000 if code == "colour_data_v2" else 255


def rgb_from_color_data(value, scale):
    try:
        color = json.loads(value) if isinstance(value, str) else value
        hue, saturation, brightness = float(color["h"]) % 360, float(color["s"]) / scale, float(color["v"]) / scale
        chroma = brightness * saturation
        match = brightness - chroma
        segment = chroma * (1 - abs((hue / 60) % 2 - 1))
        if hue < 60:
            base = (chroma, segment, 0)
        elif hue < 120:
            base = (segment, chroma, 0)
        elif hue < 180:
            base = (0, chroma, segment)
        elif hue < 240:
            base = (0, segment, chroma)
        elif hue < 300:
            base = (segment, 0, chroma)
        else:
            base = (chroma, 0, segment)
        return dict(zip(("r", "g", "b"), (round((channel + match) * 255) for channel in base)))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def apply_color(color):
    response = cloud().getstatus(CONFIG["TUYA_DEVICE_ID"])
    values = {item["code"]: item["value"] for item in response.get("result", [])}
    code = color_code(values)
    if not code:
        raise RuntimeError("Color control unsupported")
    return send_commands(
        [{"code": POWER_DP, "value": True}, {"code": MODE_DP, "value": "colour"}, {"code": code, "value": color_data(color, color_scale(code))}],
        lambda state: state["on"] and state["workMode"] == "colour",
    )


def apply_brightness(value):
    raw = max(25, round(percent_raw(value) / 100 * BRIGHTNESS_MAX))
    return send_commands(
        [{"code": POWER_DP, "value": True}, {"code": BRIGHTNESS_DP, "value": raw}],
        lambda state: state["on"] and state["brightness"] is not None and abs(state["brightness"] - percent_raw(value)) <= 2,
    )


def apply_warmth(value):
    raw = round(percent_raw(value) / 100 * 255)
    return send_commands(
        [{"code": POWER_DP, "value": True}, {"code": MODE_DP, "value": "white"}, {"code": TEMPERATURE_DP, "value": raw}],
        lambda state: state["on"] and state["workMode"] == "white" and abs(state["warmth"] - percent_raw(value)) <= 2,
    )


def status():
    response = cloud().getstatus(CONFIG["TUYA_DEVICE_ID"])
    if not response.get("success"):
        raise RuntimeError("Tuya status request was rejected")
    result = {item["code"]: item["value"] for item in response.get("result", [])}
    on = bool(result.get(POWER_DP, False))
    brightness_raw = result.get(BRIGHTNESS_DP)
    temperature = result.get(TEMPERATURE_DP)
    mode = result.get(MODE_DP)
    selected_color_dp = color_code(result)
    preset = None
    if on and mode == "white" and isinstance(brightness_raw, (int, float)) and isinstance(temperature, (int, float)):
        if abs(brightness_raw - CHILL_BRIGHTNESS) <= PRESET_TOLERANCE and abs(temperature - CHILL_TEMPERATURE) <= PRESET_TOLERANCE:
            preset = "chill"
        elif abs(brightness_raw - BRIGHTNESS_MAX) <= PRESET_TOLERANCE and abs(temperature - BRIGHT_TEMPERATURE) <= PRESET_TOLERANCE:
            preset = "bright"
    brightness = round(brightness_raw / BRIGHTNESS_MAX * 100) if isinstance(brightness_raw, (int, float)) else None
    return {
        "on": on,
        "brightness": brightness,
        "warmth": round(temperature / 255 * 100) if isinstance(temperature, (int, float)) else None,
        "temperature": temperature,
        "workMode": mode,
        "color": rgb_from_color_data(result[selected_color_dp], color_scale(selected_color_dp)) if selected_color_dp else None,
        "colorSupported": bool(selected_color_dp),
        "preset": preset,
    }


def static_file_for(request_path):
    """Resolve only the public calendar assets; never expose tools/ or .env."""
    path = unquote(urlsplit(request_path).path)
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
        path = unquote(urlsplit(self.path).path)

        # Keep the entry page explicit. This avoids URL/path edge cases on Windows
        # and guarantees that the LAN root always serves the calendar itself.
        if path in {"", "/"}:
            self.respond_file(PROJECT_ROOT / "index.html")
            return

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
        presets = {"/api/light/preset/chill": "chill", "/api/light/preset/bright": "bright"}
        controls = {"/api/light/color", "/api/light/brightness", "/api/light/warmth"}
        if path not in actions and path not in presets and path != "/api/light/toggle" and path not in controls:
            self.respond_json(404, {"error": "not found"})
            return
        try:
            if path == "/api/light/toggle":
                self.respond_json(200, power(not status()["on"]))
            elif path in presets:
                self.respond_json(200, apply_preset(presets[path]))
            elif path in controls:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                if path == "/api/light/color":
                    self.respond_json(200, apply_color(payload))
                elif path == "/api/light/brightness":
                    self.respond_json(200, apply_brightness(payload.get("brightness")))
                else:
                    self.respond_json(200, apply_warmth(payload.get("warmth")))
            else:
                self.respond_json(200, power(actions[path]))
        except (RuntimeError, ValueError, json.JSONDecodeError):
            self.respond_json(503, {"error": "unavailable"})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    port = int(CONFIG.get("BRIDGE_PORT", "8787"))
    host = CONFIG.get("BRIDGE_HOST", "127.0.0.1")
    print(f"Serving calendar from: {PROJECT_ROOT}")
    print(f"Japanese Desk Calendar + Lepro bridge: http://{host}:{port}/")
    ThreadingHTTPServer((host, port), BridgeHandler).serve_forever()
