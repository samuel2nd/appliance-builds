#!/usr/bin/env python3
"""RTSPmv - browser-based RTSP/RTSPS multiviewer with an HTTP routing API.

Streams are ingested by go2rtc and played in the browser (WebRTC/MSE,
hardware decoded by the browser). This server manages go2rtc, stores
cameras/layouts/presets, serves the MV and settings pages, and exposes a
simple HTTP API for Bitfocus Companion.

Runs on Windows and Linux with only the Python standard library.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.4.0"
FROZEN = getattr(sys, "frozen", False)
RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.dirname(sys.executable) if FROZEN else RES_DIR
STATIC_DIR = os.path.join(RES_DIR, "static")
IS_WIN = os.name == "nt"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def data_dir():
    d = os.environ.get("RTSPMV_DATA")
    if not d:
        if IS_WIN:
            d = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "RTSPmv")
        else:
            d = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "rtspmv")
    os.makedirs(d, exist_ok=True)
    if not IS_WIN:
        os.chmod(d, 0o700)  # holds camera credentials
    return d


def write_private(path, text):
    """Write a file readable only by this user (camera URLs carry credentials)."""
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    if not IS_WIN:
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)


# ---------------------------------------------------------------- layouts
# Tiles are [row, col, rowspan, colspan], 1-based, numbered in list order.

def _grid(cols, rows):
    return [[r, c, 1, 1] for r in range(1, rows + 1) for c in range(1, cols + 1)]


LAYOUTS = {
    "1x1": {"label": "1", "cols": 1, "rows": 1, "tiles": _grid(1, 1)},
    "2x1": {"label": "2 side by side", "cols": 2, "rows": 1, "tiles": _grid(2, 1)},
    "2x2": {"label": "2 × 2", "cols": 2, "rows": 2, "tiles": _grid(2, 2)},
    "3over2": {"label": "3 over 2", "cols": 6, "rows": 2,
            "tiles": [[1, 1, 1, 2], [1, 3, 1, 2], [1, 5, 1, 2], [2, 1, 1, 3], [2, 4, 1, 3]]},
    "3x2": {"label": "3 × 2", "cols": 3, "rows": 2, "tiles": _grid(3, 2)},
    "1big5": {"label": "1 big + 5", "cols": 3, "rows": 3,
            "tiles": [[1, 1, 2, 2], [1, 3, 1, 1], [2, 3, 1, 1], [3, 1, 1, 1], [3, 2, 1, 1], [3, 3, 1, 1]]},
    "3x3": {"label": "3 × 3", "cols": 3, "rows": 3, "tiles": _grid(3, 3)},
    "1big7": {"label": "1 big + 7", "cols": 4, "rows": 4,
            "tiles": [[1, 1, 3, 3], [1, 4, 1, 1], [2, 4, 1, 1], [3, 4, 1, 1],
                      [4, 1, 1, 1], [4, 2, 1, 1], [4, 3, 1, 1], [4, 4, 1, 1]]},
    "4x3": {"label": "4 × 3", "cols": 4, "rows": 3, "tiles": _grid(4, 3)},
    "4x4": {"label": "4 × 4", "cols": 4, "rows": 4, "tiles": _grid(4, 4)},
}

DEFAULT_SETTINGS = {
    "http_port": 8090,
    "go2rtc_api_port": 1984,
    "go2rtc_webrtc_port": 8555,
    "go2rtc_path": "",          # blank = auto-detect
    "ignore_rtsps_cert": True,  # rtsps:// -> rtspx:// (self-signed, e.g. UniFi Protect)
    "fit": "contain",           # contain | fill
    "labels": True,
    "stats": False,
    "remote_admin_hash": "",    # set via "remote_password"; blank = settings only on this machine
}

# Control API that any client (Companion, other machines) may use. Never exposes credentials.
PUBLIC_CMDS = ("state", "events", "route", "swap", "clear", "layout", "preset", "preset/save",
               "preset/delete", "reconnect", "restart", "status")

# Never sent to network clients
PRIVATE_SETTINGS = ("remote_admin_hash", "go2rtc_path")
LOCAL_ADDRS = ("127.0.0.1", "::1", "::ffff:127.0.0.1")


def hash_password(pw):
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000)
    return f"pbkdf2${salt}${dk.hex()}"


def check_password(pw, stored):
    try:
        _, salt, want = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000)
    return hmac.compare_digest(dk.hex(), want)


def src_rev(url):
    """Short fingerprint of a camera URL, so viewers can tell it changed without seeing it."""
    return hashlib.sha1(url.encode()).hexdigest()[:10]

ALLOWED_SCHEMES = ("rtsp://", "rtsps://", "rtspx://", "rtmp://", "rtmps://", "http://", "https://")


def valid_source(url):
    u = url.strip()
    return (u.lower().startswith(ALLOWED_SCHEMES) and len(u) <= 2048
            and not any(ch.isspace() or ord(ch) < 32 for ch in u))

CAM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class ApiError(Exception):
    pass


# ---------------------------------------------------------------- state

class State:
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.subs = []
        self.on_cameras_changed = None
        self.cfg = {"settings": dict(DEFAULT_SETTINGS), "cameras": [],
                    "layout": "3over2", "tiles": [], "presets": {}}
        try:
            with open(path, encoding="utf-8") as f:
                loaded = json.load(f)
            self.cfg.update({k: v for k, v in loaded.items() if k in self.cfg})
            self.cfg["settings"] = {**DEFAULT_SETTINGS, **loaded.get("settings", {})}
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            log("config unreadable, starting fresh:", e)
        if self.cfg["layout"] not in LAYOUTS:
            self.cfg["layout"] = "3over2"
        self.cfg["tiles"] = self._norm_tiles(self.cfg["tiles"])
        self.save()
        # runtime only (not saved): signal health reported by this box's own MV,
        # and recovery counters the MV pages watch
        self.down = []            # camera ids the local MV sees as NO SIGNAL
        self.health_at = 0.0      # last health report time
        self.reconnect = {}       # cam id -> counter; MV rebuilds that player when it changes
        self.reload_seq = 0       # MV pages reload when this changes
        self.last_restart = 0.0

    HEALTH_STALE = 10  # seconds without a report = signal state unknown

    def health_live(self):
        return time.time() - self.health_at < self.HEALTH_STALE

    def report_health(self, down):
        with self.lock:
            ids = {c["id"] for c in self.cams}
            down = sorted(d for d in down if d in ids)
            was_live = self.health_live()
            self.health_at = time.time()
            if down != self.down or not was_live:
                self.down = down
                self.broadcast()

    def health_watch(self):
        """Broadcast once when the MV stops reporting, so feedback doesn't show stale state."""
        live = False
        while True:
            time.sleep(2)
            now = self.health_live()
            if live and not now:
                self.broadcast()
            live = now

    def request_reconnect(self, tile=None, cam=None):
        with self.lock:
            if tile not in (None, ""):
                cam = self.cfg["tiles"][self.tile_index(tile)]
                if not cam:
                    raise ApiError("that tile is empty")
            else:
                cam = self.need_cam(cam)
            self.reconnect[cam] = self.reconnect.get(cam, 0) + 1
            self.broadcast()
            return cam

    # -- helpers
    @property
    def cams(self):
        return self.cfg["cameras"]

    def cam(self, cid):
        return next((c for c in self.cams if c["id"] == cid), None)

    def ntiles(self, layout=None):
        return len(LAYOUTS[layout or self.cfg["layout"]]["tiles"])

    def _norm_tiles(self, tiles, layout=None):
        n = self.ntiles(layout)
        ids = {c["id"] for c in self.cams}
        out, seen = [], set()
        for t in (list(tiles) + [None] * n)[:n]:
            if t in ids and t not in seen:
                out.append(t)
                seen.add(t)
            else:
                out.append(None)
        return out

    def _autofill(self, tiles):
        shown = set(t for t in tiles if t)
        spare = [c["id"] for c in self.cams if c["id"] not in shown]
        return [t if t else (spare.pop(0) if spare else None) for t in tiles]

    def save(self):
        write_private(self.path, json.dumps(self.cfg, indent=2))

    def snapshot(self, admin=True):
        """admin=False is what network clients get: no camera URLs, no private settings."""
        with self.lock:
            cams = []
            for c in self.cams:
                d = {"id": c["id"], "name": c["name"], "rev": src_rev(c["url"])}
                if admin:
                    d["url"] = c["url"]
                cams.append(d)
            settings = {k: v for k, v in self.cfg["settings"].items() if k != "remote_admin_hash"}
            if not admin:
                for k in PRIVATE_SETTINGS:
                    settings.pop(k, None)
            settings["remote_admin"] = bool(self.cfg["settings"].get("remote_admin_hash"))
            return {
                "version": VERSION,
                "admin": admin,
                "layout": self.cfg["layout"],
                "layouts": LAYOUTS,
                "tiles": list(self.cfg["tiles"]),
                "cameras": cams,
                "presets": sorted(self.cfg["presets"]),
                "preset_defs": json.loads(json.dumps(self.cfg["presets"])),
                "settings": settings,
                # signal health from this box's MV; health_live false = unknown (MV not running)
                "health_live": self.health_live(),
                "down": list(self.down) if self.health_live() else [],
                "reconnect": dict(self.reconnect),
                "reload_seq": self.reload_seq,
            }

    def changed(self, cameras=False):
        self.save()
        if cameras and self.on_cameras_changed:
            self.on_cameras_changed()
        self.broadcast()

    def broadcast(self):
        msgs = {True: json.dumps(self.snapshot(True)), False: json.dumps(self.snapshot(False))}
        for q, admin in list(self.subs):
            try:
                q.put_nowait(msgs[admin])
            except queue.Full:
                pass

    # -- tile arg helpers
    def tile_index(self, v, key="tile"):
        try:
            t = int(v)
        except (TypeError, ValueError):
            raise ApiError(f"'{key}' must be a tile number 1-{self.ntiles()}")
        if not 1 <= t <= self.ntiles():
            raise ApiError(f"'{key}' must be a tile number 1-{self.ntiles()}")
        return t - 1

    def need_cam(self, cid):
        if not self.cam(cid):
            raise ApiError(f"unknown camera '{cid}' (have: {', '.join(c['id'] for c in self.cams) or 'none'})")
        return cid

    # -- routing
    def route(self, tile, cid):
        with self.lock:
            i = self.tile_index(tile)
            cid = self.need_cam(cid)
            tiles = self.cfg["tiles"]
            if cid in tiles:
                j = tiles.index(cid)
                tiles[i], tiles[j] = cid, tiles[i]
            else:
                tiles[i] = cid
            self.changed()

    def swap(self, a, b):
        with self.lock:
            i, j = self.tile_index(a, "a"), self.tile_index(b, "b")
            t = self.cfg["tiles"]
            t[i], t[j] = t[j], t[i]
            self.changed()

    def clear(self, tile):
        with self.lock:
            self.cfg["tiles"][self.tile_index(tile)] = None
            self.changed()

    def set_layout(self, name):
        with self.lock:
            if name not in LAYOUTS:
                raise ApiError(f"unknown layout '{name}' (have: {', '.join(LAYOUTS)})")
            self.cfg["layout"] = name
            self.cfg["tiles"] = self._autofill(self._norm_tiles(self.cfg["tiles"], name))
            self.changed()

    # -- presets
    def preset_save(self, name):
        with self.lock:
            if not name:
                raise ApiError("'name' required")
            self.cfg["presets"][name] = {"layout": self.cfg["layout"], "tiles": list(self.cfg["tiles"])}
            self.changed()

    def preset_recall(self, name):
        with self.lock:
            p = self.cfg["presets"].get(name)
            if not p:
                raise ApiError(f"unknown preset '{name}'")
            layout = p.get("layout") if p.get("layout") in LAYOUTS else self.cfg["layout"]
            self.cfg["layout"] = layout
            self.cfg["tiles"] = self._norm_tiles(p.get("tiles", []), layout)
            self.changed()

    def preset_delete(self, name):
        with self.lock:
            if self.cfg["presets"].pop(name, None) is None:
                raise ApiError(f"unknown preset '{name}'")
            self.changed()

    # -- cameras
    def cam_upsert(self, data):
        with self.lock:
            name = str(data.get("name", "")).strip()
            url = str(data.get("url", "")).strip()
            cid = str(data.get("id", "")).strip()
            if not url:
                raise ApiError("'url' required")
            if not valid_source(url):
                raise ApiError("url must be rtsp://, rtsps://, rtmp:// or http(s)://")
            existing = self.cam(cid) if cid else None
            if not cid:
                n = 1
                while self.cam(f"cam{n}"):
                    n += 1
                cid = f"cam{n}"
            if not CAM_ID_RE.match(cid):
                raise ApiError("id: letters, digits, _ or - only (max 32)")
            if existing:
                existing.update(name=name or cid, url=url)
            else:
                self.cams.append({"id": cid, "name": name or cid, "url": url})
                tiles = self.cfg["tiles"]
                if None in tiles:  # drop new cameras into the first empty tile
                    tiles[tiles.index(None)] = cid
            self.changed(cameras=True)
            return cid

    def cam_delete(self, cid):
        with self.lock:
            self.need_cam(cid)
            self.cfg["cameras"] = [c for c in self.cams if c["id"] != cid]
            self.cfg["tiles"] = [None if t == cid else t for t in self.cfg["tiles"]]
            for p in self.cfg["presets"].values():
                p["tiles"] = [None if t == cid else t for t in p.get("tiles", [])]
            self.changed(cameras=True)

    def cam_move(self, cid, delta):
        with self.lock:
            self.need_cam(cid)
            cams = self.cams
            i = next(k for k, c in enumerate(cams) if c["id"] == cid)
            j = max(0, min(len(cams) - 1, i + delta))
            cams.insert(j, cams.pop(i))
            self.changed()

    def update_settings(self, data):
        with self.lock:
            s = self.cfg["settings"]
            restart = False
            if "remote_password" in data:  # blank clears it: settings become local-only
                pw = str(data["remote_password"] or "")
                if pw and len(pw) < 6:
                    raise ApiError("remote password must be at least 6 characters")
                s["remote_admin_hash"] = hash_password(pw) if pw else ""
            for k, v in data.items():
                if k not in DEFAULT_SETTINGS or k == "remote_admin_hash":
                    continue
                if isinstance(DEFAULT_SETTINGS[k], bool):
                    v = v in (True, "true", "1", 1, "on")
                elif isinstance(DEFAULT_SETTINGS[k], int):
                    try:
                        v = int(v)
                    except (TypeError, ValueError):
                        raise ApiError(f"'{k}' must be a number")
                if k == "fit" and v not in ("contain", "fill"):
                    raise ApiError("fit: contain or fill")
                if s.get(k) != v and k in ("go2rtc_api_port", "go2rtc_webrtc_port",
                                           "go2rtc_path", "ignore_rtsps_cert"):
                    restart = True
                s[k] = v
            self.changed(cameras=restart)


# ---------------------------------------------------------------- go2rtc

def go2rtc_source(url, ignore_cert):
    """Translate what users paste into what go2rtc wants."""
    u = url.strip()
    if u.lower().startswith("rtsps://"):
        # UniFi Protect copies URLs with ?enableSrtp, which go2rtc doesn't want.
        p = urllib.parse.urlsplit(u)
        q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
             if k.lower() != "enablesrtp"]
        u = urllib.parse.urlunsplit(p._replace(query=urllib.parse.urlencode(q)))
        if ignore_cert:
            u = "rtspx://" + u[len("rtsps://"):]
    return u


class Go2rtc:
    def __init__(self, state, ddir):
        self.state = state
        self.ddir = ddir
        self.proc = None
        self.binary = None
        self.lock = threading.Lock()
        self.want_running = True
        self.last_error = ""
        self.api_user = "rtspmv"
        self.api_pass = secrets.token_urlsafe(24)

    @property
    def settings(self):
        return self.state.cfg["settings"]

    @property
    def api(self):
        return f"http://127.0.0.1:{self.settings['go2rtc_api_port']}"

    def find_binary(self):
        exe = "go2rtc.exe" if IS_WIN else "go2rtc"
        cands = [self.settings.get("go2rtc_path") or None,
                 os.environ.get("RTSPMV_GO2RTC"),
                 os.path.join(APP_DIR, "bin", exe), os.path.join(APP_DIR, exe),
                 os.path.join(RES_DIR, "bin", exe), os.path.join(self.ddir, exe),
                 shutil.which("go2rtc")]
        for c in cands:
            if c and os.path.isfile(c):
                return c
        return None

    def write_yaml(self):
        s = self.settings
        lines = [
            "# Generated by RTSPmv - edits are overwritten.",
            "api:",
            # local only: viewers reach streams through RTSPmv's /stream tunnel,
            # so go2rtc's API (which lists source URLs) never faces the network
            f'  listen: "127.0.0.1:{s["go2rtc_api_port"]}"',
            # per-run random credentials: web pages in a browser on this box can't use go2rtc directly
            f'  username: "{self.api_user}"',
            f'  password: "{self.api_pass}"',
            "  local_auth: true",
            "rtsp:",
            '  listen: ""',
            "rtmp:",
            '  listen: ""',
            "srtp:",
            '  listen: ""',
            "webrtc:",
            f'  listen: ":{s["go2rtc_webrtc_port"]}"',
            "log:",
            "  level: warn",
            "streams:",
        ]
        for c in self.state.cams:
            if not valid_source(c["url"]):  # defense in depth for hand-edited configs
                log("skipping camera with unsupported url scheme:", c["id"])
                continue
            src = go2rtc_source(c["url"], s["ignore_rtsps_cert"])
            lines.append(f"  {json.dumps(c['id'])}: {json.dumps(src)}")
        if not self.state.cams:
            lines[-1] = "streams: {}"
        path = os.path.join(self.ddir, "go2rtc.yaml")
        write_private(path, "\n".join(lines) + "\n")
        return path

    def start(self):
        with self.lock:
            self._stop_locked()
            self.binary = self.find_binary()
            if not self.binary:
                self.last_error = "go2rtc not found"
                log("go2rtc binary not found; streams will not play until it is installed")
                return
            cfg = self.write_yaml()
            flags = subprocess.CREATE_NO_WINDOW if IS_WIN else 0
            try:
                self.proc = subprocess.Popen([self.binary, "-config", cfg],
                                             stdin=subprocess.DEVNULL, creationflags=flags)
                self.last_error = ""
                log("go2rtc started:", self.binary)
            except OSError as e:
                self.last_error = f"go2rtc failed to start: {e}"
                log(self.last_error)

    def _stop_locked(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()

    def stop(self):
        self.want_running = False
        with self.lock:
            self._stop_locked()

    def running(self):
        return bool(self.proc and self.proc.poll() is None)

    def watchdog(self):
        backoff = 2
        while True:
            time.sleep(backoff)
            if self.want_running and self.binary and not self.running():
                log("go2rtc exited; restarting")
                self.start()
                backoff = min(backoff * 2, 30)
            elif self.running():
                backoff = 2

    def status(self):
        return {"running": self.running(), "binary": self.binary,
                "error": self.last_error, "api_port": self.settings["go2rtc_api_port"]}

    def auth_header(self):
        tok = base64.b64encode(f"{self.api_user}:{self.api_pass}".encode()).decode()
        return f"Basic {tok}"

    def fetch(self, path, timeout=2):
        req = urllib.request.Request(self.api + path, headers={"Authorization": self.auth_header()})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), r.headers.get("Content-Type", "application/octet-stream")

    def codecs(self):
        """Best-effort per-stream codec summary from go2rtc's /api/streams."""
        try:
            raw, _ = self.fetch("/api/streams")
            streams = json.loads(raw)
        except (OSError, ValueError, urllib.error.URLError):
            return {}
        out = {}
        for name, info in (streams or {}).items():
            text = json.dumps(info)
            v = re.findall(r"video, \w+, ([A-Za-z0-9]+)", text)
            a = re.findall(r"audio, \w+, ([A-Za-z0-9]+)", text)
            out[name] = {"video": v[0] if v else None, "audio": a[0] if a else None,
                         "online": bool((info or {}).get("producers"))}
        return out


# ---------------------------------------------------------------- kiosk

def kiosk_service_installed():
    return (not IS_WIN) and os.path.isfile(
        os.path.expanduser("~/.config/systemd/user/rtspmv-kiosk.service"))


def prepare_firefox_profile(prof):
    """Clear stale locks and write kiosk prefs for the MV's dedicated Firefox profile."""
    os.makedirs(prof, exist_ok=True)
    # A hard power cut leaves stale profile locks that make Firefox
    # refuse to start ("already running, but not responding").
    for lockf in ("lock", ".parentlock"):
        try:
            os.unlink(os.path.join(prof, lockf))
        except FileNotFoundError:
            pass
        except OSError as e:
            log("couldn't clear firefox lock:", e)
    with open(os.path.join(prof, "user.js"), "w") as f:
        f.write("\n".join([
            'user_pref("browser.aboutwelcome.enabled", false);',
            'user_pref("browser.startup.homepage_override.mstone", "ignore");',
            'user_pref("startup.homepage_welcome_url", "");',
            'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);',
            'user_pref("browser.sessionstore.resume_from_crash", false);',
            'user_pref("browser.shell.checkDefaultBrowser", false);',
            'user_pref("browser.tabs.warnOnClose", false);',
            'user_pref("browser.warnOnQuit", false);',
            'user_pref("toolkit.crashreporter.enabled", false);',
            'user_pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);',
            'user_pref("extensions.update.enabled", false);',
            'user_pref("media.autoplay.default", 0);',
            'user_pref("media.ffmpeg.vaapi.enabled", true);',
            'user_pref("app.update.auto", false);',
            'user_pref("app.update.enabled", false);', ""]))


def run_kiosk_foreground(ddir):
    """Watchdog entry point (systemd user service): wait for the server, then exec
    Firefox in kiosk mode in the foreground, so systemd sees it exit and restarts it."""
    try:
        with open(os.path.join(ddir, "config.json"), encoding="utf-8") as f:
            port = json.load(f).get("settings", {}).get("http_port", DEFAULT_SETTINGS["http_port"])
    except (OSError, ValueError):
        port = DEFAULT_SETTINGS["http_port"]
    url = f"http://127.0.0.1:{port}/mv"
    while True:  # server may still be starting at login
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2).close()
            break
        except (OSError, urllib.error.URLError):
            time.sleep(2)
    ff = shutil.which("firefox") or shutil.which("firefox-esr")
    if not ff:
        sys.exit("firefox not found (sudo apt install firefox-esr)")
    prof = os.path.join(ddir, "firefox-profile")
    # A stray MV Firefox from an older launcher would hold the profile: clear it.
    if shutil.which("pkill"):
        subprocess.run(["pkill", "-f", "--", f"--profile {prof}"], capture_output=True)
        time.sleep(1)
    prepare_firefox_profile(prof)
    log("kiosk:", url)
    os.execv(ff, [ff, "--kiosk", "--no-remote", "--profile", prof, url])


def launch_kiosk(url, ddir):
    """Open the MV fullscreen in a browser on this machine. Returns a description."""
    if IS_WIN:
        pf = [os.environ.get(k, "") for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
        edge = [os.path.join(p, r"Microsoft\Edge\Application\msedge.exe") for p in pf if p]
        chrome = [os.path.join(p, r"Google\Chrome\Application\chrome.exe") for p in pf if p]
        prof = os.path.join(ddir, "browser-profile")
        for exe in edge:
            if os.path.isfile(exe):
                subprocess.Popen([exe, "--kiosk", url, "--edge-kiosk-type=fullscreen",
                                  "--no-first-run", f"--user-data-dir={prof}",
                                  "--autoplay-policy=no-user-gesture-required"])
                return "edge"
        for exe in chrome:
            if os.path.isfile(exe):
                subprocess.Popen([exe, "--kiosk", url, "--no-first-run", f"--user-data-dir={prof}",
                                  "--autoplay-policy=no-user-gesture-required"])
                return "chrome"
    else:
        # Appliance mode: the kiosk watchdog service owns the MV window.
        # "Show me the MV" = restart it (also recovers a hidden/stuck window).
        if kiosk_service_installed():
            r = subprocess.run(["systemctl", "--user", "restart", "rtspmv-kiosk.service"],
                               capture_output=True, text=True)
            return "kiosk service restarted" if r.returncode == 0 else f"kiosk service error: {r.stderr.strip()}"
        ff = shutil.which("firefox") or shutil.which("firefox-esr")
        if ff:  # Firefox uses VA-API hardware decode on Linux by default
            prof = os.path.join(ddir, "firefox-profile")
            os.makedirs(prof, exist_ok=True)
            # A previous MV window may be running but not visible (e.g. launched
            # before the desktop was ready). Launching means "show me the MV",
            # so replace it rather than leaving it.
            if shutil.which("pkill"):
                pat = ["--", f"--profile {prof}"]
                if subprocess.run(["pkill", "-f"] + pat, capture_output=True).returncode == 0:
                    for _ in range(20):
                        time.sleep(0.25)
                        if subprocess.run(["pgrep", "-f"] + pat, capture_output=True).returncode != 0:
                            break
                    else:
                        subprocess.run(["pkill", "-9", "-f"] + pat, capture_output=True)
                        time.sleep(0.5)
            prepare_firefox_profile(prof)
            subprocess.Popen([ff, "--kiosk", "--no-remote", "--profile", prof, url])
            return "firefox"
        for name in ("chromium", "chromium-browser", "google-chrome"):
            exe = shutil.which(name)
            if exe:
                subprocess.Popen([exe, "--kiosk", url, "--no-first-run",
                                  f"--user-data-dir={os.path.join(ddir, 'chromium-profile')}",
                                  "--autoplay-policy=no-user-gesture-required"])
                return name
    webbrowser.open(url)
    return "default browser (not kiosk)"


# ---------------------------------------------------------------- HTTP

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
        ".ico": "image/x-icon", ".json": "application/json"}


def make_handler(state, g2, ddir):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json", extra=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if getattr(self, "public_cors", False):
                self.send_header("Access-Control-Allow-Origin", "*")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def body_json(self):
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            if n > 65536:
                raise ApiError("request too large")
            try:
                d = json.loads(self.rfile.read(n))
            except ValueError:
                raise ApiError("body must be JSON")
            if not isinstance(d, dict):
                raise ApiError("body must be a JSON object")
            return d

        def do_OPTIONS(self):
            # Cross-site preflight only for the public control API, never for admin
            path = urllib.parse.urlsplit(self.path).path
            cmd = path[5:].rstrip("/") if path.startswith("/api/") else ""
            self.send_response(204)
            if cmd in PUBLIC_CMDS:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self.handle_req()

        def do_POST(self):
            self.handle_req()

        do_HEAD = do_GET

        # ---- access control: this machine = full access; network = routing + MV only,
        # unless a remote password is set (HTTP Basic, any username).
        def is_local(self):
            return self.client_address[0] in LOCAL_ADDRS

        def same_site(self):
            """False for requests a browser makes on behalf of another website."""
            if self.headers.get("Sec-Fetch-Site", "") in ("cross-site", "same-site"):
                return False
            origin = self.headers.get("Origin")
            if origin and origin != "null":
                return urllib.parse.urlsplit(origin).netloc == self.headers.get("Host", "")
            return origin != "null"

        def host_is_local(self):
            # DNS-rebinding guard: a local request must also address the box by a loopback name
            host = self.headers.get("Host", "")
            name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
            return name in ("127.0.0.1", "localhost", "[::1]", "::1")

        def is_admin(self):
            if not self.same_site():
                return False
            if self.is_local() and self.host_is_local():
                return True
            stored = state.cfg["settings"].get("remote_admin_hash")
            auth = self.headers.get("Authorization", "")
            if not stored or not auth.startswith("Basic "):
                return False
            try:
                _, _, pw = base64.b64decode(auth[6:]).decode().partition(":")
            except (ValueError, UnicodeDecodeError):
                return False
            return check_password(pw, stored)

        def require_admin(self):
            if self.is_admin():
                return True
            if state.cfg["settings"].get("remote_admin_hash"):
                self.send(401, {"error": "settings password required"},
                          extra={"WWW-Authenticate": 'Basic realm="RTSPmv settings"'})
            else:
                msg = ("RTSPmv settings are only available on the RTSPmv computer itself. "
                       "To allow them from the network, set a remote password there "
                       "(Settings > Network access).")
                if self.path.startswith("/api/"):
                    self.send(403, {"error": msg})
                else:
                    self.send(403, f"<!doctype html><meta charset=utf-8><title>RTSPmv</title>"
                                   f"<body style='font:16px system-ui;background:#0e1013;color:#e8ebf0;"
                                   f"padding:40px'><h2>Settings are local only</h2><p>{msg}</p>"
                                   f"<p><a style='color:#5b8def' href='/mv'>Open the MV</a></p>",
                              "text/html; charset=utf-8")
            return False

        def handle_req(self):
            u = urllib.parse.urlsplit(self.path)
            path = u.path.rstrip("/") or "/"
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            try:
                if path == "/stream":
                    return self.ws_tunnel(q.get("src", ""))
                if path.startswith("/api/"):
                    if self.command == "POST":
                        q.update(self.body_json())
                    return self.api(path[5:], q)
                if path in ("/", "/mv"):
                    return self.static("mv.html")
                if path in ("/settings", "/static/settings.html"):
                    if not self.require_admin():
                        return
                    return self.static("settings.html")
                if path.startswith("/static/"):
                    return self.static(path[len("/static/"):])
                if path.startswith("/g2/"):
                    return self.go2rtc_asset(path[len("/g2/"):])
                self.send(404, {"error": "not found"})
            except ApiError as e:
                self.send(400, {"error": str(e)})
            except (BrokenPipeError, ConnectionResetError):
                pass

        def static(self, rel):
            full = os.path.realpath(os.path.join(STATIC_DIR, rel))
            if not full.startswith(os.path.realpath(STATIC_DIR) + os.sep) or not os.path.isfile(full):
                return self.send(404, {"error": "not found"})
            with open(full, "rb") as f:
                data = f.read()
            self.send(200, data, MIME.get(os.path.splitext(full)[1], "application/octet-stream"))

        def go2rtc_asset(self, name):
            # Same-origin proxy for go2rtc's player modules (avoids module CORS).
            if name not in ("video-stream.js", "video-rtc.js"):
                return self.send(404, {"error": "not found"})
            try:
                data, ctype = g2.fetch("/" + name)
                self.send(200, data, "text/javascript; charset=utf-8")
            except (OSError, urllib.error.URLError) as e:
                self.send(502, f"// go2rtc unavailable: {e}\n", "text/javascript")

        def ws_tunnel(self, src):
            """Relay a player WebSocket to go2rtc (bound to localhost) for a known camera only."""
            if not state.cam(src):
                return self.send(404, {"error": "unknown camera"})
            if self.headers.get("Upgrade", "").lower() != "websocket":
                return self.send(400, {"error": "websocket required"})
            port = state.cfg["settings"]["go2rtc_api_port"]
            try:
                up = socket.create_connection(("127.0.0.1", port), timeout=5)
            except OSError:
                return self.send(502, {"error": "stream engine unavailable"})
            up.settimeout(None)
            lines = [f"GET /api/ws?src={urllib.parse.quote(src)} HTTP/1.1", f"Host: 127.0.0.1:{port}",
                     f"Authorization: {g2.auth_header()}"]
            for k in ("Upgrade", "Connection", "Sec-WebSocket-Key", "Sec-WebSocket-Version",
                      "Sec-WebSocket-Protocol", "Sec-WebSocket-Extensions", "Origin", "User-Agent"):
                v = self.headers.get(k)
                if v:
                    lines.append(f"{k}: {v}")
            up.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
            client = self.connection
            client.settimeout(None)
            self.close_connection = True

            def pump(src_sock, dst_sock):
                try:
                    while True:
                        data = src_sock.recv(65536)
                        if not data:
                            break
                        dst_sock.sendall(data)
                except OSError:
                    pass
                finally:
                    for s in (src_sock, dst_sock):
                        try:
                            s.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass

            t = threading.Thread(target=pump, args=(up, client), daemon=True)
            t.start()
            pump(client, up)
            t.join(timeout=2)
            up.close()

        def api(self, cmd, q):
            S = state
            self.public_cors = cmd in PUBLIC_CMDS
            ADMIN_CMDS = ("cameras/delete", "cameras/move", "go2rtc/restart", "kiosk")
            mutating = cmd in ADMIN_CMDS or (cmd in ("cameras", "settings") and self.command == "POST")
            if mutating:
                if not self.require_admin():
                    return
                # admin changes: POST + JSON only (no <img>/form tricks from other web pages)
                if self.command != "POST" or not self.headers.get("Content-Type", "").startswith("application/json"):
                    return self.send(405, {"error": "admin commands must be POST with a JSON body"})
            admin = self.is_admin()
            if cmd == "state":
                r = S.snapshot(admin)
            elif cmd == "events":
                return self.sse()
            elif cmd == "route":
                S.route(q.get("tile"), q.get("cam"))
                r = S.snapshot(admin)
            elif cmd == "swap":
                S.swap(q.get("a"), q.get("b"))
                r = S.snapshot(admin)
            elif cmd == "clear":
                S.clear(q.get("tile"))
                r = S.snapshot(admin)
            elif cmd == "layout":
                S.set_layout(q.get("name"))
                r = S.snapshot(admin)
            elif cmd == "preset":
                S.preset_recall(q.get("name"))
                r = S.snapshot(admin)
            elif cmd == "preset/save":
                S.preset_save(str(q.get("name", "")).strip())
                r = S.snapshot(admin)
            elif cmd == "preset/delete":
                S.preset_delete(q.get("name"))
                r = S.snapshot(admin)
            elif cmd == "cameras":
                if self.command != "POST":
                    r = S.snapshot(admin)["cameras"]
                else:
                    r = {"id": S.cam_upsert(q)}
            elif cmd == "cameras/delete":
                S.cam_delete(q.get("id"))
                r = S.snapshot(admin)
            elif cmd == "cameras/move":
                S.cam_move(q.get("id"), -1 if str(q.get("dir")) == "up" else 1)
                r = S.snapshot(admin)
            elif cmd == "settings":
                if self.command == "POST":
                    S.update_settings({k: v for k, v in q.items()})
                r = S.snapshot(admin)["settings"]
            elif cmd == "status":
                g = g2.status()
                if not admin:  # don't reveal filesystem paths to the network
                    g["binary"] = bool(g["binary"])
                r = {"go2rtc": g, "codecs": g2.codecs()}
            elif cmd == "health":
                # Only this box's own MV is the source of truth for signal state
                if self.is_local() and self.host_is_local() and self.same_site() and self.command == "POST":
                    down = q.get("down") or []
                    S.report_health(down if isinstance(down, list) else [])
                r = {"health_live": S.health_live(), "down": S.down if S.health_live() else []}
            elif cmd == "reconnect":
                cam = S.request_reconnect(tile=q.get("tile"), cam=q.get("cam"))
                r = {"reconnect": cam}
            elif cmd == "restart":
                # restart the stream engine (re-pulls every camera) and reload every MV page
                if time.time() - S.last_restart < 5:
                    raise ApiError("restart already in progress")
                S.last_restart = time.time()
                if S.on_cameras_changed:  # stream engine is managed (not --no-go2rtc)
                    g2.start()
                with S.lock:
                    S.reload_seq += 1
                    S.reconnect = {}
                    S.broadcast()
                r = {"restarted": True, "engine": g2.status()["running"]}
            elif cmd == "go2rtc/restart":
                g2.start()
                r = g2.status()
            elif cmd == "kiosk":
                port = S.cfg["settings"]["http_port"]
                r = {"browser": launch_kiosk(f"http://127.0.0.1:{port}/mv", ddir)}
            else:
                raise ApiError(f"unknown command '{cmd}'")
            self.send(200, r)

        def sse(self):
            q = queue.Queue(maxsize=50)
            admin = self.is_admin()
            sub = (q, admin)
            state.subs.append(sub)
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(f"data: {json.dumps(state.snapshot(admin))}\n\n".encode())
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=15)
                        self.wfile.write(f"data: {msg}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                if sub in state.subs:
                    state.subs.remove(sub)
                self.close_connection = True

    return H


# ---------------------------------------------------------------- main

def service_installed():
    """True when the Linux background service is set up (server starts on its own)."""
    return (not IS_WIN) and os.path.isfile(
        os.path.expanduser("~/.config/systemd/user/rtspmv.service"))


def main():
    ap = argparse.ArgumentParser(description="RTSPmv multiviewer")
    ap.add_argument("--port", type=int, help="HTTP port (default from settings, 8090)")
    ap.add_argument("--data", help="data/config directory")
    ap.add_argument("--open", action="store_true", help="open settings page in the default browser")
    ap.add_argument("--kiosk", action="store_true", help="open the MV fullscreen on this machine")
    ap.add_argument("--no-go2rtc", action="store_true", help="don't manage go2rtc (testing)")
    ap.add_argument("--kiosk-run", action="store_true",
                    help="(service use) wait for the server, then run the MV kiosk in the foreground")
    args = ap.parse_args()

    if args.data:
        os.environ["RTSPMV_DATA"] = args.data
    ddir = data_dir()
    if args.kiosk_run:
        return run_kiosk_foreground(ddir)
    state = State(os.path.join(ddir, "config.json"))
    if args.port:
        state.cfg["settings"]["http_port"] = args.port
        state.save()
    port = state.cfg["settings"]["http_port"]

    def server_up():
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1).close()
            return True
        except (OSError, urllib.error.URLError):
            return False

    def open_ui():
        if args.kiosk:
            log("kiosk:", launch_kiosk(f"http://127.0.0.1:{port}/mv", ddir))
        elif args.open:
            webbrowser.open(f"http://127.0.0.1:{port}/settings")

    # Launcher mode: if a server is (or is about to be) running, e.g. the
    # background service starting at login, wait for it and just open the UI.
    launcher = args.kiosk or args.open
    wait = (45 if service_installed() else 3) if launcher else 0
    deadline = time.time() + wait
    while True:
        if server_up():
            if args.kiosk or args.open:
                open_ui()
            else:
                log(f"RTSPmv is already running on port {port}")
            return
        if time.time() >= deadline:
            break
        time.sleep(1)

    try:
        srv = ThreadingHTTPServer(("0.0.0.0", port), make_handler(state, None, ddir))
    except OSError as e:
        # Lost a race with another instance: it's the server, we just open the UI.
        if (args.kiosk or args.open) and server_up():
            open_ui()
            return
        sys.exit(f"Can't listen on port {port}: {e}. Is RTSPmv already running?")

    g2 = Go2rtc(state, ddir)
    srv.RequestHandlerClass = make_handler(state, g2, ddir)
    if not args.no_go2rtc:
        state.on_cameras_changed = g2.start  # rewrite config + restart
        g2.start()
        threading.Thread(target=g2.watchdog, daemon=True).start()
    threading.Thread(target=state.health_watch, daemon=True).start()
    srv.daemon_threads = True
    log(f"RTSPmv {VERSION}  data: {ddir}")
    log(f"MV:       http://127.0.0.1:{port}/mv")
    log(f"Settings: http://127.0.0.1:{port}/settings")

    if args.open or args.kiosk:
        def later():
            time.sleep(1.5)
            open_ui()
        threading.Thread(target=later, daemon=True).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        g2.stop()


if __name__ == "__main__":
    main()
