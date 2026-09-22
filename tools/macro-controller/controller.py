"""SIKAI CASE one-layer controller for Japanese Desk Calendar.

The keyboard is configured to emit ordinary keys; this process listens globally
on the Windows PC and calls the existing authenticated Worker API. No bridge
token or device local_key is used here.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

try:
    import keyboard
except ImportError as exc:  # pragma: no cover - dependency check at startup
    raise SystemExit("Install dependencies with: py -m pip install -r requirements.txt") from exc


BASE_URL = os.environ.get("JDC_WORKER_URL", "https://japanese-desk-calendar.oussama-nemri.workers.dev").rstrip("/")
ACCESS_TOKEN = os.environ.get("JDC_LIGHT_ACCESS_TOKEN", "")
STEP = int(os.environ.get("JDC_KNOB_STEP", "5"))
ARM_WINDOW_SECONDS = 3.0


@dataclass
class LightState:
    brightness: int = 50
    warmth: int = 50
    hue: int = 0
    saturation: int = 100
    intensity: int = 50
    work_mode: str = "white"


state = LightState()
state_lock = threading.Lock()
armed_until = 0.0


def request(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    if not ACCESS_TOKEN:
        raise RuntimeError("JDC_LIGHT_ACCESS_TOKEN is not configured for this Windows user")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Authorization": f"Bearer {ACCESS_TOKEN}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=8) as response:
        result = json.loads(response.read().decode("utf-8"))
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(str(result["error"]))
    return result


def refresh_state() -> None:
    global state
    result = request("/api/light/status")
    with state_lock:
        state = LightState(
            brightness=int(result.get("brightness", state.brightness)),
            warmth=int(result.get("warmth", state.warmth)),
            hue=int((result.get("colorHsv") or {}).get("hue", state.hue)),
            saturation=int((result.get("colorHsv") or {}).get("saturation", state.saturation)),
            intensity=int((result.get("colorHsv") or {}).get("intensity", state.intensity)),
            work_mode=str(result.get("workMode", state.work_mode)),
        )


def clamp(value: int) -> int:
    return max(0, min(100, value))


def adjust_intensity(delta: int) -> None:
    refresh_state()
    with state_lock:
        if state.work_mode == "colour":
            state.intensity = clamp(state.intensity + delta)
            payload = {"intensity": state.intensity}
        else:
            state.brightness = clamp(state.brightness + delta)
            payload = {"brightness": state.brightness}
    request("/api/light/color" if "intensity" in payload else "/api/light/brightness", "POST", payload)


def adjust_tone_or_hue(delta: int) -> None:
    refresh_state()
    with state_lock:
        if state.work_mode == "colour":
            state.hue = (state.hue + delta) % 360
            payload = {"hue": state.hue}
            path = "/api/light/color"
        else:
            state.warmth = clamp(state.warmth + delta)
            payload = {"warmth": state.warmth}
            path = "/api/light/warmth"
    request(path, "POST", payload)


def toggle_light() -> None:
    request("/api/light/toggle", "POST")


def set_preset(name: str) -> None:
    request(f"/api/light/preset/{name}", "POST")


def toggle_plug(name: str) -> None:
    request(f"/api/plug/{name}/toggle", "POST")


def ns_scene() -> None:
    # Match the PWA's existing NS scene: turn the three scene plugs on and
    # the lamp off, unless all three plugs are already on, in which case turn
    # the three plugs off and leave the lamp unchanged.
    statuses = {name: request(f"/api/plug/{name}/status").get("on", False)
                for name in ("led", "lampe", "multiprises")}
    if all(statuses.values()):
        for name in statuses:
            request(f"/api/plug/{name}/off", "POST")
    else:
        for name in statuses:
            request(f"/api/plug/{name}/on", "POST")
        request("/api/light/off", "POST")


def all_off() -> None:
    request("/api/light/off", "POST")
    for name in ("led", "lampe", "multiprises", "projecteur"):
        request(f"/api/plug/{name}/off", "POST")


def arm_all_off() -> None:
    global armed_until
    armed_until = time.monotonic() + ARM_WINDOW_SECONDS
    print("ALL OFF armed for 3 seconds; press C to confirm")


def confirm_all_off() -> None:
    global armed_until
    if time.monotonic() <= armed_until:
        armed_until = 0
        all_off()
        print("ALL OFF executed")


def safe_action(action) -> None:
    try:
        action()
    except (OSError, urllib.error.URLError, RuntimeError, ValueError) as exc:
        print(f"Controller action failed: {exc}")


def install_hooks() -> None:
    # One layer: 1-9 are the physical grid, G/D are knob presses, and
    # bracket keys are the two rotation directions configured in MINI Keyboard.
    bindings = {
        "1": lambda: safe_action(toggle_light),
        "2": lambda: safe_action(lambda: set_preset("chill")),
        "3": lambda: safe_action(lambda: set_preset("bright")),
        "4": lambda: safe_action(lambda: toggle_plug("led")),
        "5": lambda: safe_action(lambda: toggle_plug("lampe")),
        "6": lambda: safe_action(lambda: toggle_plug("multiprises")),
        "7": lambda: safe_action(lambda: toggle_plug("projecteur")),
        "8": lambda: safe_action(ns_scene),
        "9": lambda: safe_action(confirm_all_off),
        "c": lambda: safe_action(toggle_light),
        "u": lambda: safe_action(arm_all_off),
        "l": lambda: safe_action(lambda: adjust_intensity(-STEP)),
        "r": lambda: safe_action(lambda: adjust_intensity(STEP)),
        "g": lambda: safe_action(lambda: adjust_tone_or_hue(-STEP)),
        "d": lambda: safe_action(lambda: adjust_tone_or_hue(STEP)),
    }
    for key, callback in bindings.items():
        keyboard.on_release_key(key, lambda _event, callback=callback: callback())


def main() -> None:
    print(f"Japanese Desk Calendar controller: {BASE_URL}")
    print("One layer active. Press Ctrl+C in this window to stop.")
    install_hooks()
    keyboard.wait()


if __name__ == "__main__":
    main()
