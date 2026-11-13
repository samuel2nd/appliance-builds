# RTSPmv

A software multiviewer for RTSP/RTSPS cameras. Add streams in a web page, pick a grid, route
cameras to tiles from the page or from Bitfocus Companion. Runs on Linux and Windows.

- Any RTSP/RTSPS source, mixed vendors
- Layouts: 1, 2, 2×2, 3-over-2, 3×2, 1 big + 5, 3×3, 1 big + 7, 4×3, 4×4
- Instant routing: swaps move tiles, streams don't reconnect
- Presets (layout + routing)
- Per-tile labels, NO SIGNAL detection, stats overlay (codec, res, fps, drops)
- View the MV from any browser on the network: `http://<host>:8090/mv`

Streams are pulled by [go2rtc](https://github.com/AlexxIT/go2rtc) and decoded by the browser
(hardware decode: Firefox on Linux via VA-API, Edge/Chrome on Windows).

## Linux (tested on Debian 13 with GNOME)

```bash
./linux/install.sh              # add --autostart to open the MV fullscreen at login
```

Installs to `~/.local/share/rtspmv`, downloads go2rtc, runs a background user service, and adds
**RTSPmv Multiviewer** and **RTSPmv Settings** to the app menu. Needs `python3` and Firefox
(Debian's default). Logs: `journalctl --user -u rtspmv -f`.

For an unattended box: enable automatic login (GNOME Settings › System › Users) and install with
`--autostart`.

### Appliance mode (unattended show box)

```bash
./linux/install.sh --autostart   # MV fullscreen at login + watchdog that reopens it
./linux/appliance.sh             # no screen blank/lock, no auto-updates, auto-login
./linux/appliance.sh --check     # report only;  --undo puts desktop defaults back
```

The kiosk watchdog (`rtspmv-kiosk` user service) reopens the MV within ~4 s if Firefox
crashes or the window is closed. To use the desktop, run **RTSPmv Hide MV (maintenance)**;
**RTSPmv Multiviewer** brings it back.

## Windows (not yet tested)

Release build: unzip `RTSPmv-windows-x64`, run `RTSPmv.exe --open`.

From source: install Python 3, put `go2rtc.exe`
([releases](https://github.com/AlexxIT/go2rtc/releases), `go2rtc_win64.zip`) in a `bin` folder next to
`rtspmv.py`, then run `windows\RTSPmv.bat`. `windows\RTSPmv-Fullscreen.bat` opens the MV in Edge
kiosk mode (Alt+F4 to exit). To start at login, put a shortcut in `shell:startup`.

## Using it

- **Settings:** `http://127.0.0.1:8090/settings`
- **MV:** `http://<host>:8090/mv`. Keys: **F** fullscreen, **S** stats, **G** settings. Double-click toggles fullscreen.

## Companion / HTTP API

GET (or POST) to `http://<host>:8090/api/...` with Companion's Generic HTTP module. Tiles are
numbered left→right, top→bottom.

| Request | Action |
|---|---|
| `/api/route?tile=1&cam=cam2` | Camera to tile (swaps if already on screen) |
| `/api/swap?a=1&b=2` | Swap two tiles |
| `/api/clear?tile=3` | Blank a tile |
| `/api/layout?name=3over2` | Change layout: 1x1, 2x1, 2x2, 3over2, 3x2, 1big5, 3x3, 1big7, 4x3, 4x4 |
| `/api/preset?name=show` | Recall preset |
| `/api/preset/save?name=show` | Save current as preset |
| `/api/reconnect?tile=2` | Re-pull one tile's camera |
| `/api/restart` | Restart the stream engine and reload the MV |
| `/api/state` | Current state (JSON), including NO SIGNAL tiles (`down`) |

## Ports

| Port | Use |
|---|---|
| 8090/tcp | RTSPmv MV, API, and streams |
| 8555/tcp+udp | go2rtc WebRTC media |

The Linux installer opens these automatically if ufw is active.

Open these on the host firewall if viewing the MV from other machines.

## Security

- Settings and camera editing only from the RTSPmv computer itself (addressed as `127.0.0.1`/`localhost`), or from the network with the optional remote password.
- Web pages opened in a browser on the box can't change settings or read camera addresses (same-site, POST-only admin requests; DNS-rebinding guard).
- Camera addresses must be `rtsp://`, `rtsps://`, `rtmp://` or `http(s)://`; command-type sources are refused.
- Camera addresses never leave the box. The config is readable only by its owner (`600`).
- The stream engine (go2rtc) listens only on the box, behind a per-run password.
- The routing API (route, layouts, presets, reconnect, restart) is open on the network by design, for Companion. Keep port 8090 on a trusted production network.
- The remote password travels over plain HTTP. Only use it on a trusted network.

## Notes

- **H.265** cameras play in Edge/Chrome on Windows with a capable GPU; Firefox on Linux generally
  won't. Use H.264 (or substreams) for those.
- Editing a camera restarts the stream engine, so all tiles blip for a second or two.
- Settings and camera editing work only on the RTSPmv computer itself, unless a remote password is set (Settings > Network access). Camera addresses are never sent to the network.
- Config lives in `~/.config/rtspmv` (Linux) or `%APPDATA%\RTSPmv` (Windows).
