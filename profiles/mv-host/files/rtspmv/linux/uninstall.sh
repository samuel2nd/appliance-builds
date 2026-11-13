#!/bin/bash
# Removes RTSPmv. Cameras/presets in ~/.config/rtspmv are kept unless you pass --purge.
# Appliance settings (no blanking, auto-login, no auto-updates) are left as they are;
# run ./linux/appliance.sh --undo first if you want desktop defaults back.
set -u
systemctl --user disable --now rtspmv-kiosk.service rtspmv.service 2>/dev/null
rm -f "$HOME/.config/systemd/user/rtspmv.service" \
      "$HOME/.config/systemd/user/rtspmv-kiosk.service" \
      "$HOME/.local/share/applications/rtspmv.desktop" \
      "$HOME/.local/share/applications/rtspmv-settings.desktop" \
      "$HOME/.local/share/applications/rtspmv-hide.desktop" \
      "$HOME/.config/autostart/rtspmv.desktop"
rm -rf "$HOME/.local/share/rtspmv"
systemctl --user daemon-reload 2>/dev/null
if command -v ufw >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo ufw delete allow 8090/tcp >/dev/null 2>&1
  sudo ufw delete allow 8555 >/dev/null 2>&1
  echo "Closed firewall ports 8090 and 8555."
else
  echo "If you use ufw, close the ports with: sudo ufw delete allow 8090/tcp && sudo ufw delete allow 8555"
fi
[ "${1:-}" = "--purge" ] && rm -rf "$HOME/.config/rtspmv" && echo "Removed cameras/presets."
echo "RTSPmv removed."
