# SIKAI CASE controller

This optional Windows process lets a SIKAI CASE macro keyboard control the
existing authenticated Japanese Desk Calendar routes while the calendar is
shown on an iPad. It calls the Worker only; it never talks to the bridge and
never contains a bridge token or a Tuya `local_key`.

## One-layer mapping

Configure the SIKAI software so the active layer emits these keys:

| Control | Key | Action |
|---|---:|---|
| KEY1 | `1` | Plafonnier toggle |
| KEY2 | `2` | CHILL |
| KEY3 | `3` | BRIGHT |
| KEY4 | `4` | LED toggle |
| KEY5 | `5` | LAMPE toggle |
| KEY6 | `6` | MULTIPRISES toggle |
| KEY7 | `7` | PROJECTEUR toggle |
| KEY8 | `8` | NS scene |
| KEY9 | `9` | Confirm ALL OFF, only after K2 press |
| K1 Centre | `g` | Plafonnier toggle |
| K2 Centre | `d` | Arm ALL OFF for 3 seconds |
| K1 Left/Right | `[` / `]` | Intensity down/up |
| K2 Left/Right | `-` / `=` | Warmth down/up in white, hue down/up in colour |

The controller reacts on key release and ignores key repeat from a held key.
ALL OFF requires K2 Centre, then KEY9 within three seconds. KEY9 alone does
nothing. Values are read from `/api/light/status` before relative adjustments
and clamped to the device's 0–100 range.

## Run on the M920q

Install Python 3.11 or newer and the dependency:

```powershell
py -m pip install -r requirements.txt
```

Set `JDC_WORKER_URL` if using a different Worker hostname and set
`JDC_LIGHT_ACCESS_TOKEN` in the Windows user's protected environment before
starting the controller. Do not put the token in this repository or in the
Sikai keyboard macro configuration. Then run:

```powershell
py controller.py
```

The token must be the same existing personal access token accepted by the
Worker. The controller does not create or weaken any authentication path.
