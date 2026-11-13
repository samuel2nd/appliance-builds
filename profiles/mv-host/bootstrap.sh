#!/bin/bash
# MV Host Bootstrap Script - Idempotent
# Logs to /var/log/bootstrap.log
set -euo pipefail

LOG="/var/log/bootstrap.log"
exec > >(tee -a "$LOG") 2>&1

# Fail loudly on any error
trap 'echo "FATAL: Command failed at line $LINENO: $BASH_COMMAND" >&2; exit 1' ERR

echo "=== Bootstrap started: $(date -Iseconds) ==="

# Pinned versions
COMPANION_VERSION="5.0.1"
COMPANION_BUILD="9649"
COMPANION_HASH="6acd549dd5"
NODE_VERSION="22"
GO2RTC_VERSION="v1.9.15"
GO2RTC_SHA256="20b46c6910734cb05ecefb234066f36868ff19b42ba1418a7a32e13a3e035712"
RTSPMV_VERSION="0.4.0"

MV_USER="mv"
MV_HOME="/home/$MV_USER"

# Site-specific config (optional) - copy site.env.example to /tmp/site.env before install
SITE_ENV="/tmp/site.env"
if [ -f "$SITE_ENV" ]; then
    echo ">>> Loading site config from $SITE_ENV"
    # shellcheck source=/dev/null
    source "$SITE_ENV"
else
    echo ">>> WARNING: No $SITE_ENV found - using defaults (hostname=mv-appliance)"
    echo "    To customize: copy site.env.example to /tmp/site.env before running bootstrap"
fi

# Defaults (can be overridden by site.env)
HOSTNAME_TARGET="${HOSTNAME:-mv-appliance}"

# ============================================================
# 0. Hostname
# ============================================================
echo ">>> Setting hostname to $HOSTNAME_TARGET..."
hostnamectl set-hostname "$HOSTNAME_TARGET"
sed -i "s/127.0.1.1.*/127.0.1.1\t$HOSTNAME_TARGET/" /etc/hosts || \
    echo -e "127.0.1.1\t$HOSTNAME_TARGET" >> /etc/hosts
echo "  Hostname set to $(hostname)"

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
# 2. Disable sleep/suspend and configure GNOME autologin
# ============================================================
echo ">>> Disabling sleep/suspend at systemd level..."
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
echo "  Sleep targets masked"

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
else
    echo "  WARNING: GDM config not found"
fi

# dconf system profile with locks (applies to all users, cannot be overridden)
mkdir -p /etc/dconf/profile
cat > /etc/dconf/profile/user <<EOF
user-db:user
system-db:local
EOF

# GDM profile (must reference gdm db for login screen settings to apply)
cat > /etc/dconf/profile/gdm <<EOF
user-db:user
system-db:gdm
system-db:local
EOF

mkdir -p /etc/dconf/db/local.d
cat > /etc/dconf/db/local.d/00-no-sleep <<'DCONF'
[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false

[org/gnome/desktop/lockdown]
disable-lock-screen=true

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type="nothing"
sleep-inactive-battery-type="nothing"
idle-dim=false

[org/gnome/desktop/notifications]
show-banners=false
DCONF

mkdir -p /etc/dconf/db/local.d/locks
cat > /etc/dconf/db/local.d/locks/00-no-sleep <<EOF
/org/gnome/desktop/session/idle-delay
/org/gnome/desktop/screensaver/lock-enabled
/org/gnome/desktop/screensaver/idle-activation-enabled
/org/gnome/desktop/lockdown/disable-lock-screen
/org/gnome/settings-daemon/plugins/power/sleep-inactive-ac-type
/org/gnome/settings-daemon/plugins/power/sleep-inactive-battery-type
/org/gnome/settings-daemon/plugins/power/idle-dim
/org/gnome/desktop/notifications/show-banners
EOF

# GDM login screen settings (prevent sleep/lock while waiting for login)
mkdir -p /etc/dconf/db/gdm.d
cat > /etc/dconf/db/gdm.d/00-no-sleep <<'DCONF'
[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false

[org/gnome/desktop/lockdown]
disable-lock-screen=true

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type="nothing"
idle-dim=false
DCONF

dconf update
echo "  dconf system profile with locks configured"

# ============================================================
# 3. Node.js (for Companion)
# ============================================================
echo ">>> Installing Node.js $NODE_VERSION..."
if ! command -v node >/dev/null || ! node -v | grep -q "v$NODE_VERSION"; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
fi
echo "  Node.js $(node -v) installed"

# ============================================================
# 4. Bitfocus Companion (tar.gz from CDN)
# ============================================================
echo ">>> Installing Bitfocus Companion $COMPANION_VERSION..."
COMPANION_DIR="/opt/companion"
COMPANION_TAR="companion-linux-x64-${COMPANION_VERSION}-${COMPANION_BUILD}-stable-${COMPANION_HASH}.tar.gz"
COMPANION_URL="https://cf-pub.bitfocus.io/companion/companion/$COMPANION_TAR"

if [ ! -f "$COMPANION_DIR/companion_headless.sh" ]; then
    echo "  Downloading Companion from $COMPANION_URL..."
    cd /tmp
    rm -f "$COMPANION_TAR"
    wget --progress=dot:giga "$COMPANION_URL" || {
        echo "FATAL: Failed to download Companion"
        exit 1
    }

    echo "  Extracting to $COMPANION_DIR..."
    rm -rf "$COMPANION_DIR"
    mkdir -p "$COMPANION_DIR"
    # tarball has no top-level folder, extract directly
    tar -xzf "$COMPANION_TAR" -C "$COMPANION_DIR"
    rm -f "$COMPANION_TAR"

    [ -f "$COMPANION_DIR/companion_headless.sh" ] || {
        echo "FATAL: Companion extraction failed - companion_headless.sh not found"
        ls -la "$COMPANION_DIR"
        exit 1
    }
    chmod +x "$COMPANION_DIR/companion_headless.sh"
    echo "  Companion extracted"
else
    echo "  Companion already installed"
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
ExecStart=$COMPANION_DIR/companion_headless.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable companion.service
echo "  Companion $COMPANION_VERSION service configured"

# ============================================================
# 5. Companion dev modules (clone from repo)
# ============================================================
echo ">>> Setting up Companion dev modules..."
mkdir -p "$MV_HOME/dev"

REPO_CLONE="/tmp/appliance-builds"
rm -rf "$REPO_CLONE"
echo "  Cloning repo..."
git clone --depth 1 https://github.com/samuel2nd/appliance-builds.git "$REPO_CLONE" || {
    echo "FATAL: Failed to clone repo"
    exit 1
}

DEV_MODULES="cobalt-9905-color-corrector companion-module-rtspmv companion-module-rtsp-thumbnail"
for mod in $DEV_MODULES; do
    SRC_DIR="$REPO_CLONE/profiles/mv-host/dev/$mod"
    DST_DIR="$MV_HOME/dev/$mod"

    [ -d "$SRC_DIR" ] || {
        echo "FATAL: Module source not found: $SRC_DIR"
        exit 1
    }

    rm -rf "$DST_DIR"
    cp -r "$SRC_DIR" "$DST_DIR"
    chown -R "$MV_USER:$MV_USER" "$DST_DIR"

    if [ -f "$DST_DIR/package.json" ]; then
        echo "  npm install for $mod..."
        cd "$DST_DIR"
        sudo -u "$MV_USER" npm install --omit=dev || {
            echo "FATAL: npm install failed for $mod"
            exit 1
        }
    fi
done
echo "  Dev modules installed"

# ============================================================
# 6. RTSPmv
# ============================================================
echo ">>> Installing RTSPmv $RTSPMV_VERSION..."
RTSPMV_DIR="$MV_HOME/.local/share/rtspmv"
mkdir -p "$RTSPMV_DIR/bin"

# Copy rtspmv files from cloned repo
RTSPMV_SRC="$REPO_CLONE/profiles/mv-host/files/rtspmv"
[ -d "$RTSPMV_SRC" ] || {
    echo "FATAL: RTSPmv source not found: $RTSPMV_SRC"
    exit 1
}

cp "$RTSPMV_SRC/rtspmv.py" "$RTSPMV_DIR/"
cp "$RTSPMV_SRC/LICENSE" "$RTSPMV_DIR/"
rm -rf "$RTSPMV_DIR/static"
cp -r "$RTSPMV_SRC/static" "$RTSPMV_DIR/"
cp "$RTSPMV_SRC/linux/rtspmv.svg" "$RTSPMV_DIR/" 2>/dev/null || true

# Download go2rtc with checksum verification
if [ ! -x "$RTSPMV_DIR/bin/go2rtc" ]; then
    echo "  Downloading go2rtc $GO2RTC_VERSION..."
    curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/$GO2RTC_VERSION/go2rtc_linux_amd64" \
        -o "$RTSPMV_DIR/bin/go2rtc.tmp" || {
        echo "FATAL: Failed to download go2rtc"
        exit 1
    }
    ACTUAL_SHA256=$(sha256sum "$RTSPMV_DIR/bin/go2rtc.tmp" | cut -d' ' -f1)
    if [ "$ACTUAL_SHA256" != "$GO2RTC_SHA256" ]; then
        echo "FATAL: go2rtc checksum mismatch!"
        echo "  Expected: $GO2RTC_SHA256"
        echo "  Got:      $ACTUAL_SHA256"
        rm -f "$RTSPMV_DIR/bin/go2rtc.tmp"
        exit 1
    fi
    mv "$RTSPMV_DIR/bin/go2rtc.tmp" "$RTSPMV_DIR/bin/go2rtc"
    chmod +x "$RTSPMV_DIR/bin/go2rtc"
    echo "  go2rtc checksum verified"
else
    echo "  go2rtc already installed"
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

# Enable user service
sudo -u "$MV_USER" XDG_RUNTIME_DIR="/run/user/$(id -u $MV_USER)" systemctl --user daemon-reload 2>/dev/null || true
sudo -u "$MV_USER" XDG_RUNTIME_DIR="/run/user/$(id -u $MV_USER)" systemctl --user enable rtspmv.service 2>/dev/null || true
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

# GNOME application launchers
APPS_DIR="$MV_HOME/.local/share/applications"
mkdir -p "$APPS_DIR"

cat > "$APPS_DIR/rtspmv.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Multiviewer
Comment=Open the camera multiviewer fullscreen
Exec=/usr/bin/env python3 $RTSPMV_DIR/rtspmv.py --kiosk
Icon=$RTSPMV_DIR/rtspmv.svg
Categories=AudioVideo;Video;
EOF

cat > "$APPS_DIR/rtspmv-settings.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Settings
Comment=Cameras, layouts and routing
Exec=xdg-open http://127.0.0.1:8090/settings
Icon=$RTSPMV_DIR/rtspmv.svg
Categories=AudioVideo;Video;
EOF

cat > "$APPS_DIR/rtspmv-hide.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RTSPmv Hide MV (maintenance)
Comment=Close the fullscreen MV and stop it reopening
Exec=systemctl --user stop rtspmv-kiosk.service
Icon=$RTSPMV_DIR/rtspmv.svg
Categories=AudioVideo;Video;
EOF

chown -R "$MV_USER:$MV_USER" "$APPS_DIR"
echo "  Application launchers created"

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
systemctl start companion.service || {
    echo "WARNING: Failed to start companion.service (may need reboot)"
}

# Enable lingering for mv user (user services start at boot)
loginctl enable-linger "$MV_USER" || {
    echo "WARNING: Failed to enable linger for $MV_USER"
}

# Clean up
rm -rf "$REPO_CLONE"

echo ""
echo "=== Bootstrap completed: $(date -Iseconds) ==="
echo ""
echo "Hostname: $(hostname)"
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
