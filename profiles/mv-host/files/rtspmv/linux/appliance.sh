#!/bin/bash
# RTSPmv appliance settings for a GNOME desktop box (Debian/Ubuntu).
# Stops the things that can blank, cover, or reboot the MV during a show.
#
#   ./linux/appliance.sh            apply (asks for sudo for the system parts)
#   ./linux/appliance.sh --check    report only, change nothing
#   ./linux/appliance.sh --undo     put desktop defaults back
#
# Run as the user that shows the MV (not with sudo).
set -u
MODE="${1:-apply}"
USER_NAME="$(id -un)"
[ "$(id -u)" -eq 0 ] && { echo "Run as your normal user, not root/sudo."; exit 1; }

ok()   { printf '  \e[32mOK\e[0m    %s\n' "$*"; }
chg()  { printf '  \e[36mSET\e[0m   %s\n' "$*"; }
warn() { printf '  \e[33mNOTE\e[0m  %s\n' "$*"; }

# ---------- GNOME (per-user) ----------
# schema key appliance-value default-value description
GS=(
  "org.gnome.desktop.session idle-delay uint32:0 uint32:300 screen-blank timeout"
  "org.gnome.desktop.screensaver lock-enabled false true screen lock"
  "org.gnome.desktop.screensaver idle-activation-enabled false true screensaver"
  "org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 'suspend' suspend-when-idle"
  "org.gnome.settings-daemon.plugins.power idle-dim false true dim-when-idle"
  "org.gnome.desktop.notifications show-banners false true notification-popups"
  "org.gnome.software download-updates false true GNOME-Software-update-downloads"
  "org.gnome.software allow-updates false true GNOME-Software-updates"
)

echo "Desktop (user: $USER_NAME)"
if ! command -v gsettings >/dev/null; then
  warn "gsettings not found (not a GNOME desktop?) - skipping desktop settings"
else
  for row in "${GS[@]}"; do
    read -r schema key want def desc <<<"$row"
    if ! gsettings list-keys "$schema" 2>/dev/null | grep -qx "$key"; then
      warn "$desc: not available on this system"; continue
    fi
    cur="$(gsettings get "$schema" "$key")"
    target="$want"; [ "$MODE" = "--undo" ] && target="$def"
    if [ "$cur" = "$target" ] || [ "$cur" = "${target#uint32:}" ] || [ "$cur" = "uint32 ${target#uint32:}" ]; then
      ok "$desc ($cur)"
    elif [ "$MODE" = "--check" ]; then
      warn "$desc is $cur (appliance wants $want)"
    else
      gsettings set "$schema" "$key" "${target#uint32:}" && chg "$desc -> $target"
    fi
  done
fi

# ---------- skip GNOME's Activities overview at login (GNOME 40+ opens it on every login) ----------
EXT_UUID="rtspmv-no-overview@rtspmv"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"
ext_enabled() { gsettings get org.gnome.shell enabled-extensions 2>/dev/null | grep -q "'$EXT_UUID'"; }
set_ext_list() { # $1 = add|remove
  local cur new
  cur="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null)"
  new="$(python3 - "$cur" "$EXT_UUID" "$1" <<'PY'
import ast, sys
cur, uuid, op = sys.argv[1], sys.argv[2], sys.argv[3]
cur = cur.replace("@as ", "").strip()
lst = ast.literal_eval(cur) if cur.startswith("[") else []
lst = [x for x in lst if x != uuid] + ([uuid] if op == "add" else [])
print("[" + ", ".join(repr(x) for x in lst) + "]")
PY
)"
  gsettings set org.gnome.shell enabled-extensions "$new"
}
if command -v gnome-shell >/dev/null && command -v gsettings >/dev/null; then
  if [ "$MODE" = "--check" ]; then
    { [ -f "$EXT_DIR/extension.js" ] && ext_enabled; } && ok "login skips the Activities overview" \
      || warn "login opens the Activities overview on top of the MV"
  elif [ "$MODE" = "--undo" ]; then
    set_ext_list remove; rm -rf "$EXT_DIR"; chg "Activities overview at login restored"
  else
    mkdir -p "$EXT_DIR"
    cat > "$EXT_DIR/metadata.json" <<'EOF'
{
  "uuid": "rtspmv-no-overview@rtspmv",
  "name": "RTSPmv: no overview at login",
  "description": "Start the session on the desktop (the MV) instead of the Activities overview.",
  "shell-version": ["45", "46", "47", "48", "49", "50"]
}
EOF
    cat > "$EXT_DIR/extension.js" <<'EOF'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class NoOverviewAtLogin extends Extension {
    enable() {
        if (!Main.layoutManager._startingUp)
            return;
        this._orig = Main.sessionMode.hasOverview;
        Main.sessionMode.hasOverview = false;
        this._id = Main.layoutManager.connect('startup-complete', () => this._restore());
    }

    _restore() {
        if (this._id) {
            Main.layoutManager.disconnect(this._id);
            this._id = null;
        }
        if (this._orig !== undefined)
            Main.sessionMode.hasOverview = this._orig;
        this._orig = undefined;
    }

    disable() {
        this._restore();
    }
}
EOF
    gsettings set org.gnome.shell disable-user-extensions false 2>/dev/null
    ext_enabled || set_ext_list add
    chg "login skips the Activities overview (takes effect next login)"
  fi
fi

# ---------- system (sudo) ----------
echo "System"
TIMERS=(apt-daily.timer apt-daily-upgrade.timer)
SVCS=(unattended-upgrades.service packagekit.service)
if [ "$MODE" = "--check" ]; then
  for u in "${TIMERS[@]}" "${SVCS[@]}"; do
    st="$(systemctl is-enabled "$u" 2>/dev/null || true)"
    case "$st" in enabled|static) warn "$u is $st (automatic updates)";; "") ;; *) ok "$u $st";; esac
  done
else
  echo "  (sudo needed for automatic-update and auto-login settings)"
  sudo -v || { warn "no sudo - skipped system settings"; exit 0; }
  if [ "$MODE" = "--undo" ]; then
    for u in "${TIMERS[@]}" unattended-upgrades.service; do
      sudo systemctl unmask "$u" >/dev/null 2>&1; sudo systemctl enable --now "$u" >/dev/null 2>&1 && chg "re-enabled $u"
    done
  else
    for u in "${TIMERS[@]}" unattended-upgrades.service; do
      if systemctl list-unit-files "$u" >/dev/null 2>&1 && systemctl list-unit-files "$u" | grep -q "$u"; then
        sudo systemctl disable --now "$u" >/dev/null 2>&1 && chg "disabled $u (no automatic updates/reboots)"
      fi
    done
  fi

  # GDM automatic login, so a power cycle comes straight back to the MV
  GDM=""
  for f in /etc/gdm3/daemon.conf /etc/gdm/custom.conf; do [ -f "$f" ] && GDM="$f" && break; done
  if [ -z "$GDM" ]; then
    warn "GDM config not found - enable automatic login in Settings > System > Users"
  elif [ "$MODE" = "--undo" ]; then
    sudo sed -i 's/^AutomaticLoginEnable *=.*/AutomaticLoginEnable = false/' "$GDM" && chg "auto-login off ($GDM)"
  else
    sudo cp -n "$GDM" "$GDM.rtspmv-backup" 2>/dev/null
    sudo sed -i '/^AutomaticLoginEnable *=/d; /^AutomaticLogin *=/d' "$GDM"
    sudo sed -i "/^\[daemon\]/a AutomaticLoginEnable = true\nAutomaticLogin = $USER_NAME" "$GDM"
    grep -q "^AutomaticLogin = $USER_NAME" "$GDM" && chg "auto-login as $USER_NAME ($GDM)" \
      || warn "couldn't set auto-login in $GDM - use Settings > System > Users"
  fi
fi

# ---------- report-only: things that matter on a show box ----------
echo "Review (not changed)"
ip -4 route get 1.1.1.1 2>/dev/null | grep -q " dev wl" \
  && warn "default network is Wi-Fi - use wired Ethernet with a reserved IP for a show box" \
  || ok "default network is wired"
for s in docker tailscaled x11vnc vncserver wayvnc; do
  systemctl is-active --quiet "$s" 2>/dev/null && warn "$s is running - remove it if this box doesn't need it"
done
[ -f "$HOME/.local/share/keyrings/login.keyring" ] && [ "$MODE" != "--undo" ] && \
  warn "with auto-login, GNOME may ask for the keyring password (Chrome/Wi-Fi secrets). If a prompt appears at boot, set the login keyring password to blank in 'Passwords and Keys'."
systemctl --user is-enabled --quiet rtspmv-kiosk.service 2>/dev/null \
  && ok "MV kiosk watchdog enabled" \
  || warn "MV kiosk watchdog not enabled - run ./linux/install.sh --autostart"

echo
[ "$MODE" = "--check" ] && echo "Check only - nothing changed." || echo "Done. Reboot to test: the MV should come up by itself."
