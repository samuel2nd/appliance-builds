#!/bin/bash
# MV Host Bootstrap Script - Idempotent
# Logs to /var/log/bootstrap.log
set -euo pipefail

LOG="/var/log/bootstrap.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== Bootstrap started: $(date -Iseconds) ==="

# Pinned versions
COMPANION_VERSION="5.0.1"
NODE_VERSION="22"
GO2RTC_VERSION="v1.9.15"
GO2RTC_SHA256="20b46c6910734cb05ecefb234066f36868ff19b42ba1418a7a32e13a3e035712"
RTSPMV_VERSION="0.4.0"

REPO_BASE="https://raw.githubusercontent.com/samuel2nd/appliance-builds/master/profiles/mv-host"
MV_USER="mv"
MV_HOME="/home/$MV_USER"

# ============================================================
# 1. System packages
# ============================================================
echo ">>> Installing system packages..."
apt-get update
apt-get install -y \
    intel-media-va-driver vainfo intel-gpu-tools \
    ffmpeg git curl wget gnupg ca-certificates \
    python3 firefox-esr

# ============================================================
# 2. GNOME settings: autologin, no blank, no suspend
# ============================================================
echo ">>> Configuring GNOME autologin and power settings..."

# GDM autologin
GDM_CONF=""
for f in /etc/gdm3/daemon.conf /etc/gdm/custom.conf; do
    [ -f "$f" ] && GDM_CONF="$f" && break
done
if [ -n "$GDM_CONF" ]; then
    sed -i '/^AutomaticLoginEnable/d; /^AutomaticLogin[[:space:]]*=/d' "$GDM_CONF"
    sed -i "/^\[daemon\]/a AutomaticLoginEnable = true\nAutomaticLogin = $MV_USER" "$GDM_CONF"
    echo "  GDM autologin configured in $GDM_CONF"
fi

# GNOME settings (run as mv user)
sudo -u "$MV_USER" dbus-launch gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
sudo -u "$MV_USER" dbus-launch gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
sudo -u "$MV_USER" dbus-launch gsettings set org.gnome.desktop.screensaver idle-activation-enabled false 2>/dev/null || true
sudo -u "$MV_USER" dbus-launch gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing 2>/dev/null || true
sudo -u "$MV_USER" dbus-launch gsettings set org.gnome.settings-daemon.plugins.power idle-dim false 2>/dev/null || true
sudo -u "$MV_USER" dbus-launch gsettings set org.gnome.desktop.notifications show-banners false 2>/dev/null || true
echo "  GNOME power/screensaver settings applied"

# ============================================================
# 3. Node.js (for Companion)
# ============================================================
echo ">>> Installing Node.js $NODE_VERSION..."
if ! command -v node >/dev/null || ! node -v | grep -q "v$NODE_VERSION"; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
echo "  Node.js $(node -v) installed"

# ============================================================
# 4. Bitfocus Companion
# ============================================================
echo ">>> Installing Bitfocus Companion $COMPANION_VERSION..."
COMPANION_DIR="/opt/companion"
COMPANION_DEB="companion-${COMPANION_VERSION}-linux-x64.deb"

if [ ! -d "$COMPANION_DIR" ] || ! "$COMPANION_DIR/node-runtime/bin/node" -v 2>/dev/null | grep -q "v22"; then
    cd /tmp
    if [ ! -f "$COMPANION_DEB" ]; then
        wget -q "https://releases.bitfocus.io/companion/v${COMPANION_VERSION}/${COMPANION_DEB}"
    fi
    dpkg -i "$COMPANION_DEB" || apt-get install -f -y
    rm -f "$COMPANION_DEB"
fi

# Companion systemd service (runs as mv user)
cat > /etc/systemd/system/companion.service <<EOF
[Unit]
Description=Bitfocus Companion
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$MV_USER
Environment=COMPANION_DEV_MODULES=$MV_HOME/dev
ExecStart=/opt/companion/launch.sh headless
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable companion.service
echo "  Companion $COMPANION_VERSION installed"

# ============================================================
# 5. Companion dev modules (clone from repo)
# ============================================================
echo ">>> Setting up Companion dev modules..."
mkdir -p "$MV_HOME/dev"

REPO_CLONE="/tmp/appliance-builds"
if [ ! -d "$REPO_CLONE" ]; then
    git clone --depth 1 https://github.com/samuel2nd/appliance-builds.git "$REPO_CLONE"
fi

DEV_MODULES="cobalt-9905-color-corrector companion-module-rtspmv companion-module-rtsp-thumbnail"
for mod in $DEV_MODULES; do
    SRC_DIR="$REPO_CLONE/profiles/mv-host/dev/$mod"
    DST_DIR="$MV_HOME/dev/$mod"
    if [ -d "$SRC_DIR" ] && [ ! -d "$DST_DIR" ]; then
        cp -r "$SRC_DIR" "$DST_DIR"
    fi
    if [ -f "$DST_DIR/package.json" ] && [ ! -d "$DST_DIR/node_modules" ]; then
        echo "  npm ci for $mod..."
        cd "$DST_DIR"
        sudo -u "$MV_USER" npm ci --omit=dev 2>/dev/null || sudo -u "$MV_USER" npm install --omit=dev
    fi
done
chown -R "$MV_USER:$MV_USER" "$MV_HOME/dev"
echo "  Dev modules installed"

# ============================================================
# 6. RTSPmv
# ============================================================
echo ">>> Installing RTSPmv $RTSPMV_VERSION..."
RTSPMV_DIR="$MV_HOME/.local/share/rtspmv"
mkdir -p "$RTSPMV_DIR/bin"

# Copy rtspmv files from cloned repo
RTSPMV_SRC="$REPO_CLONE/profiles/mv-host/files/rtspmv"
if [ ! -f "$RTSPMV_DIR/rtspmv.py" ] && [ -d "$RTSPMV_SRC" ]; then
    cp "$RTSPMV_SRC/rtspmv.py" "$RTSPMV_DIR/"
    cp "$RTSPMV_SRC/LICENSE" "$RTSPMV_DIR/"
    cp -r "$RTSPMV_SRC/static" "$RTSPMV_DIR/"
    cp "$RTSPMV_SRC/linux/rtspmv.svg" "$RTSPMV_DIR/" 2>/dev/null || true
fi

# Download go2rtc with checksum verification
if [ ! -x "$RTSPMV_DIR/bin/go2rtc" ]; then
    echo "  Downloading go2rtc $GO2RTC_VERSION..."
    curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/$GO2RTC_VERSION/go2rtc_linux_amd64" \
        -o "$RTSPMV_DIR/bin/go2rtc.tmp"
    ACTUAL_SHA256=$(sha256sum "$RTSPMV_DIR/bin/go2rtc.tmp" | cut -d' ' -f1)
    if [ "$ACTUAL_SHA256" != "$GO2RTC_SHA256" ]; then
        echo "ERROR: go2rtc checksum mismatch!"
        echo "  Expected: $GO2RTC_SHA256"
        echo "  Got:      $ACTUAL_SHA256"
        rm -f "$RTSPMV_DIR/bin/go2rtc.tmp"
        exit 1
    fi
    mv "$RTSPMV_DIR/bin/go2rtc.tmp" "$RTSPMV_DIR/bin/go2rtc"
    chmod +x "$RTSPMV_DIR/bin/go2rtc"
    echo "  go2rtc checksum verified"
fi

chown -R "$MV_USER:$MV_USER" "$RTSPMV_DIR"
chmod 700 "$RTSPMV_DIR"

# RTSPmv systemd user service
SYSTEMD_USER_DIR="$MV_HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"
cat > "$SYSTEMD_USER_DIR/rtspmv.service" <<EOF
[Unit]
Description=RTSPmv multiviewer server
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 $RTSPMV_DIR/rtspmv.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

chown -R "$MV_USER:$MV_USER" "$MV_HOME/.config"

# Enable user service (requires user session)
sudo -u "$MV_USER" bash -c "systemctl --user daemon-reload && systemctl --user enable rtspmv.service" 2>/dev/null || true
echo "  RTSPmv installed"

# ============================================================
# 7. MV autostart (Firefox ESR kiosk with VAAPI)
# ============================================================
echo ">>> Configuring MV autostart..."
AUTOSTART_DIR="$MV_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/rtspmv-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Kiosk
Comment=Open MV fullscreen at login
Exec=/usr/bin/firefox-esr --kiosk http://127.0.0.1:8090/mv
X-GNOME-Autostart-enabled=true
EOF

# Firefox hardware acceleration config
FF_PREFS_DIR="$MV_HOME/.mozilla/firefox"
mkdir -p "$FF_PREFS_DIR"
cat > "$FF_PREFS_DIR/user.js.template" <<'EOF'
// VAAPI hardware video decode
user_pref("media.ffmpeg.vaapi.enabled", true);
user_pref("media.hardware-video-decoding.enabled", true);
user_pref("media.hardware-video-decoding.force-enabled", true);
user_pref("gfx.webrender.all", true);
user_pref("widget.dmabuf.force-enabled", true);
EOF

chown -R "$MV_USER:$MV_USER" "$AUTOSTART_DIR" "$FF_PREFS_DIR"
echo "  Autostart configured"

# ============================================================
# 8. Firewall (if ufw is active)
# ============================================================
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    echo ">>> Configuring firewall..."
    ufw allow 8090/tcp comment "RTSPmv web/API"
    ufw allow 8555 comment "RTSPmv WebRTC"
    ufw allow 8000/tcp comment "Companion web UI"
    echo "  Firewall rules added"
fi

# ============================================================
# 9. Final
# ============================================================
echo ">>> Starting services..."
systemctl start companion.service || true

# Enable lingering for mv user (user services start at boot)
loginctl enable-linger "$MV_USER" 2>/dev/null || true

echo ""
echo "=== Bootstrap completed: $(date -Iseconds) ==="
echo ""
echo "Pinned versions:"
echo "  Companion: $COMPANION_VERSION"
echo "  Node.js:   $(node -v)"
echo "  go2rtc:    $GO2RTC_VERSION"
echo "  RTSPmv:    $RTSPMV_VERSION"
echo ""
echo "Post-install steps:"
echo "  1. Reboot"
echo "  2. Enter camera URLs at http://127.0.0.1:8090/settings"
echo "  3. Import Companion config at http://127.0.0.1:8000"
echo "  4. Point rtspmv connection to 127.0.0.1:8090"
echo ""
