#!/bin/bash
# RTSPmv Linux installer (per-user, no root needed).
#   ./linux/install.sh              install + background service + app menu entries
#   ./linux/install.sh --autostart  also run the MV fullscreen at login, with a watchdog
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.local/share/rtspmv"
APPS="$HOME/.local/share/applications"
AUTOSTART=0
[ "${1:-}" = "--autostart" ] && AUTOSTART=1

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

echo "Installing to $DEST"
mkdir -p "$DEST/bin" "$APPS"
cp "$SRC/rtspmv.py" "$SRC/LICENSE" "$DEST/"
rm -rf "$DEST/static" && cp -r "$SRC/static" "$DEST/"
cp "$SRC/linux/rtspmv.svg" "$DEST/" 2>/dev/null || true

# go2rtc stream engine
if [ ! -x "$DEST/bin/go2rtc" ]; then
  if [ -x "$SRC/bin/go2rtc" ]; then
    cp "$SRC/bin/go2rtc" "$DEST/bin/go2rtc"
  else
    case "$(uname -m)" in
      x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; armv7l) ARCH=arm ;;
      *) echo "Unknown arch $(uname -m); download go2rtc manually to $DEST/bin/go2rtc"; ARCH="" ;;
    esac
    if [ -n "$ARCH" ]; then
      # Pin a tested go2rtc release with GO2RTC_VERSION=v1.x.y (default: latest)
      if [ -n "${GO2RTC_VERSION:-}" ]; then
        URL="https://github.com/AlexxIT/go2rtc/releases/download/$GO2RTC_VERSION/go2rtc_linux_$ARCH"
      else
        URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_$ARCH"
      fi
      echo "Downloading go2rtc ($ARCH)"
      if command -v curl >/dev/null; then curl -fL "$URL" -o "$DEST/bin/go2rtc"
      else wget -O "$DEST/bin/go2rtc" "$URL"; fi
    fi
  fi
  chmod +x "$DEST/bin/go2rtc" 2>/dev/null || true
fi

# Background service (starts at login, restarts on crash)
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/rtspmv.service" <<EOF
[Unit]
Description=RTSPmv multiviewer server
After=network-online.target

[Service]
ExecStart=/usr/bin/env python3 $DEST/rtspmv.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable rtspmv.service
# restart (not just start) so an update replaces the running server
systemctl --user restart rtspmv.service

# App menu entries
cat > "$APPS/rtspmv.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Multiviewer
Comment=Open the camera multiviewer fullscreen
Exec=/usr/bin/env python3 $DEST/rtspmv.py --kiosk
Icon=$DEST/rtspmv.svg
Categories=AudioVideo;Video;
EOF
cat > "$APPS/rtspmv-settings.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Settings
Comment=Cameras, layouts and routing
Exec=xdg-open http://127.0.0.1:8090/settings
Icon=$DEST/rtspmv.svg
Categories=AudioVideo;Video;
EOF

# Open ports if ufw is active (8090 web/API/streams, 8555 WebRTC media).
# go2rtc's own API (1984) is bound to this machine only and is closed if previously opened.
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "ufw is active; opening RTSPmv ports (sudo)"
  sudo ufw allow 8090/tcp && sudo ufw allow 8555 \
    || echo "Couldn't open ports; run: sudo ufw allow 8090/tcp && sudo ufw allow 8555"
  sudo ufw delete allow 1984/tcp >/dev/null 2>&1 && echo "closed old go2rtc port 1984" || true
fi

cat > "$APPS/rtspmv-hide.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Hide MV (maintenance)
Comment=Close the fullscreen MV and stop it reopening, until the next login or 'RTSPmv Multiviewer'
Exec=systemctl --user stop rtspmv-kiosk.service
Icon=$DEST/rtspmv.svg
Categories=AudioVideo;Video;
EOF

# The old login-autostart entry is replaced by the kiosk watchdog service
rm -f "$HOME/.config/autostart/rtspmv.desktop"

if [ "$AUTOSTART" = 1 ]; then
  # Kiosk watchdog: opens the MV when the desktop session starts and reopens it
  # within a few seconds if Firefox crashes or the window is closed.
  cat > "$HOME/.config/systemd/user/rtspmv-kiosk.service" <<EOF
[Unit]
Description=RTSPmv MV fullscreen (kiosk watchdog)
PartOf=graphical-session.target
After=graphical-session.target rtspmv.service
Wants=rtspmv.service
# never give up restarting
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/bin/env python3 $DEST/rtspmv.py --kiosk-run
Restart=always
RestartSec=4

[Install]
WantedBy=graphical-session.target
EOF
  # stop any MV window opened by an older launcher, then hand over to the service
  pkill -f -- "--profile $HOME/.config/rtspmv/firefox-profile" 2>/dev/null || true
  systemctl --user daemon-reload
  systemctl --user enable rtspmv-kiosk.service
  if [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
    systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XAUTHORITY 2>/dev/null || true
    systemctl --user restart rtspmv-kiosk.service
  fi
  echo "MV opens fullscreen at login and reopens itself if closed or crashed."
  echo "To work on the desktop: 'RTSPmv Hide MV (maintenance)' from the app menu."
fi

echo
echo "Done."
echo "  Settings: http://127.0.0.1:8090/settings  (or the 'RTSPmv Settings' app)"
echo "  MV:       'RTSPmv Multiviewer' app, or http://<this-ip>:8090/mv from any browser"
echo "  Logs:     journalctl --user -u rtspmv -u rtspmv-kiosk -f"
echo "For an unattended box: run with --autostart, then ./linux/appliance.sh"
