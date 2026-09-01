# Japanese Desk Calendar

A small, dependency-free Japanese-inspired daily calendar designed for an iPad in landscape mode. It shows the current Brussels date and time, a monthly calendar, and current Open-Meteo weather.

## Architecture

Static HTML and CSS with three small vanilla JavaScript modules. A service worker caches local assets for offline opening; the last valid weather reading is stored in `localStorage`.

## Run locally

Serve the folder over HTTP (opening `index.html` directly will not enable the service worker):

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy with GitHub Pages

In the repository, open **Settings → Pages**, choose **Deploy from a branch**, then select **main** and **/(root)**. All project paths are relative and work below a repository subpath.

## Install on iPad

In Safari, open the deployed site, tap **Share → Add to Home Screen**, then launch it from the new icon. It opens standalone in landscape orientation.

The app requests a screen wake lock when the browser supports it, but iPadOS may release it due to system policy or power state. For a permanent desk display, you can also use **Settings → Display & Brightness → Auto-Lock → Never** while the iPad is powered.

## Notes

- Date and time always use `Europe/Brussels`, regardless of the device time zone.
- Weather refreshes every 20 minutes and gracefully falls back to the last valid reading.
- The calendar remains fully functional without weather or network access.
- The discreet sun/moon control switches themes and remembers the choice on the device.
