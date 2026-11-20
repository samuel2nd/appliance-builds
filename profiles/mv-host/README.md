# MV Host Profile

Unattended Debian 13 installation for a camera multiviewer appliance.

## Target Hardware

- **Model:** Dell OptiPlex 3050 Micro
- **CPU:** Intel Core i5-6500T (Skylake, supports Quick Sync / VAAPI)
- **RAM:** 8 GB
- **Storage:** 256 GB SATA SSD (`/dev/sda`)
- **Network:** Onboard NIC + USB Ethernet adapter (dual-homed)

## Network Configuration

The appliance supports dual-NIC setup: camera NIC provides internet (default route), management NIC for local access only.

| Interface | Profile | IP Address | Gateway | Purpose |
|-----------|---------|------------|---------|---------|
| `<MGMT_IF>` (onboard) | Wired connection 1 | `<MGMT_IP>` | none (never-default) | Management (SSH, Companion UI) |
| `<CAM_IF>` (USB) | Camera Network | `<CAM_IP>` | `<CAM_GATEWAY>` | Camera VLAN + internet |

**Post-install network setup** (not automated in bootstrap):

```bash
# Bind management profile to onboard NIC (find interface name with: ip link)
# Set never-default so it doesn't become the default route
sudo nmcli connection modify "Wired connection 1" \
  connection.interface-name <MGMT_IF> \
  ipv4.never-default yes \
  ipv4.gateway ""

# Create camera network profile with gateway (default route for internet)
sudo nmcli connection add \
  con-name "Camera Network" \
  type ethernet \
  ifname <CAM_IF> \
  ipv4.method manual \
  ipv4.addresses <CAM_IP>/24 \
  ipv4.gateway <CAM_GATEWAY> \
  ipv4.dns <CAM_DNS> \
  ipv4.never-default no \
  ipv6.method disabled \
  connection.autoconnect yes

# Disable WiFi if present
sudo nmcli connection modify "<WIFI_PROFILE>" connection.autoconnect no

# Activate both
sudo nmcli connection up "Wired connection 1"
sudo nmcli connection up "Camera Network"
```

## Site-Specific Configuration

Site-specific values (IPs, interface names, hostname) live in **local site files** that are **never committed** to the repo. Each site file is stored locally (e.g., `sites/mu12-companion.env`) and copied to the target before bootstrap runs.

**Before running bootstrap.sh**, copy the site file to the target:

```bash
# From your workstation (where sites/*.env lives):
scp sites/<SITE_NAME>.env mv@<TARGET_IP>:/tmp/site.env

# Then on the target, run bootstrap:
sudo /tmp/bootstrap.sh
```

If `/tmp/site.env` is not present, bootstrap.sh will warn and use defaults (`hostname=mv-appliance`).

See `site.env.example` for available variables. Create your site file based on this template.

## What the Preseed Answers

| Setting | Value |
|---------|-------|
| Locale | `en_US.UTF-8` |
| Keyboard | US |
| Timezone | `America/New_York` |
| Mirror | `deb.debian.org` |
| Partitioning | Guided, entire disk, single ext4 partition |
| Root account | Disabled |
| User | `mv` (prompted for password at install) |
| Tasks | GNOME Desktop, SSH Server, Standard Utilities |
| GRUB | `/dev/sda` |
| popularity-contest | No |

## Bootstrap Steps

The `late_command` fetches and runs `bootstrap.sh`, which:

1. **System packages:** `intel-media-va-driver`, `vainfo`, `intel-gpu-tools`, `ffmpeg`, `git`, `curl`, `python3`, `firefox-esr`, `libusb-1.0-0-dev`, `libudev-dev`

2. **USB surface permissions:** Installs udev rules (`50-companion.rules`) for Stream Deck, X-keys, Loupedeck, and other USB HID surfaces; adds `mv` user to `plugdev`, `dialout`, `input`, `audio` groups

3. **Sleep/lock prevention:** Masks `sleep.target`, `suspend.target`, `hibernate.target`, `hybrid-sleep.target`; dconf system profile with locks disables screen blank, screensaver, auto-suspend, screen lock (`lock-enabled=false`), and lockdown (`disable-lock-screen=true`) for both user sessions and GDM login screen

4. **GNOME autologin:** Configures GDM to auto-login as `mv` user

5. **Node.js 22:** From NodeSource repository

6. **Bitfocus Companion 5.0.7:** Installed to `/opt/companion`, runs as systemd service with `--extra-module-path /home/mv/dev` (env var `COMPANION_DEV_MODULES` is broken in 5.x)

7. **Companion dev modules:** Installed to `/home/mv/dev/`:
   - `cobalt-9905-color-corrector` v2.1.1 (v1.x API with node18 runtime; `@companion-module/base` pinned to 1.14.1 for Companion 5.0.7 compatibility)
   - `companion-module-rtspmv` v0.2.0 (v2.x API, node22)
   - `companion-module-rtsp-thumbnail` v0.4.0 (v2.x API, node22)

8. **RTSPmv 0.4.0:** Installed to `/home/mv/.local/share/rtspmv`, runs as systemd user service

9. **go2rtc v1.9.15:** Downloaded with SHA256 verification: `20b46c6910734cb05ecefb234066f36868ff19b42ba1418a7a32e13a3e035712`; RTSPmv configures go2rtc with restricted `origin` (127.0.0.1/localhost only) to allow WebSocket connections from the browser. Note: Kamrui runs RTSPmv 0.3.0 which doesn't require the origin fix

10. **MV autostart:** Firefox ESR kiosk mode with VAAPI hardware decode, opens `http://127.0.0.1:8090/mv` at login; GNOME application launchers for RTSPmv

11. **Firewall (if ufw active):** Opens ports 8090 (RTSPmv), 8555 (WebRTC), 8000 (Companion)

## Pinned Versions

| Component | Version |
|-----------|---------|
| Companion | 5.0.7 |
| Node.js | 22.x |
| go2rtc | v1.9.15 |
| RTSPmv | 0.4.0 |
| cobalt-9905-color-corrector | 2.1.1 |
| @companion-module/base (Cobalt) | 1.14.1 |
| companion-module-rtspmv | 0.2.0 |
| companion-module-rtsp-thumbnail | 0.4.0 |

## How to Boot

1. Boot from Debian 13 netinst USB
2. Select **Advanced options** > **Automated install**
3. When prompted for preseed URL, enter:
   ```
   https://samuel2nd.github.io/appliance-builds/profiles/mv-host/preseed.cfg
   ```
   Or raw GitHub URL:
   ```
   https://raw.githubusercontent.com/samuel2nd/appliance-builds/master/profiles/mv-host/preseed.cfg
   ```
4. Enter password for `mv` user when prompted
5. Wait for installation and reboot

## Testing in a VM Before Using the Stick

Every `bootstrap.sh` change should be tested in a Debian 13 VM before deploying to hardware. This catches script errors without burning time on physical installs.

### Quick VM Test (QEMU)

```bash
# Create a 20GB disk image
qemu-img create -f qcow2 test-vm.qcow2 20G

# Boot from ISO with preseed URL on kernel command line
qemu-system-x86_64 \
  -enable-kvm \
  -m 4096 \
  -smp 2 \
  -hda test-vm.qcow2 \
  -cdrom debian-13.0.0-amd64-netinst.iso \
  -boot d \
  -net nic -net user \
  -append "auto=true priority=critical url=https://samuel2nd.github.io/appliance-builds/profiles/mv-host/preseed.cfg"
```

### VirtualBox Test

1. Create a new VM: Debian 64-bit, 4GB RAM, 20GB disk
2. Attach the custom ISO (or stock netinst)
3. If using stock ISO: at boot menu, press Tab/e to edit boot options, append:
   ```
   auto=true priority=critical url=https://samuel2nd.github.io/appliance-builds/profiles/mv-host/preseed.cfg
   ```
4. Watch the install; check `/var/log/installer/syslog` if it fails

### What to Verify

- [ ] Preseed URL fetched successfully (no 404)
- [ ] Bootstrap script downloads and runs
- [ ] All apt packages install without errors
- [ ] Companion service starts (`systemctl status companion`)
- [ ] Dev modules appear in Companion UI
- [ ] USB surfaces detected in Companion (Stream Deck, X-keys, etc.)
- [ ] RTSPmv service starts (`systemctl --user status rtspmv`)
- [ ] MV fullscreen after cold boot (no GNOME panels visible)
- [ ] Autologin works (no login prompt at boot)
- [ ] Screen doesn't lock or blank

### Testing Bootstrap Changes Without Full Reinstall

For iterating on `bootstrap.sh` without reinstalling:

```bash
# On the VM, re-run bootstrap after editing
curl -fsSL https://raw.githubusercontent.com/samuel2nd/appliance-builds/master/profiles/mv-host/bootstrap.sh -o /tmp/bootstrap.sh
chmod +x /tmp/bootstrap.sh
sudo /tmp/bootstrap.sh
```

Note: Some changes (partitioning, user creation) only apply during initial install.

## Lessons from the First Install

Issues encountered during the first Dell OptiPlex deployment and their fixes:

### 1. Wrong Boot Menu Choice

**Problem:** Selected "Install" instead of "Advanced options > Automated install". The preseed URL prompt only appears in automated mode.

**Fix:** Use the custom ISO with preseed baked in, or remember: Advanced options > Automated install.

### 2. main vs master Branch URL

**Problem:** Preseed `late_command` referenced `main` branch, but this repo uses `master`. Bootstrap script 404'd.

**Fix:** All raw GitHub URLs must use `master`:
```
https://raw.githubusercontent.com/samuel2nd/appliance-builds/master/profiles/mv-host/bootstrap.sh
```

### 3. Silent Companion Failure (COMPANION_DEV_MODULES)

**Problem:** Dev modules didn't appear in Companion. No error in logs. The `COMPANION_DEV_MODULES` environment variable is broken in Companion 5.x.

**Fix:** Use `--extra-module-path` CLI argument instead:
```bash
ExecStart=/opt/companion/.../node main.js --extra-module-path /home/mv/dev
```

### 4. Companion Version Mismatch

**Problem:** Bootstrap installed Companion 5.0.1, but production config was exported from 5.0.7. Config import failed or behaved unexpectedly.

**Fix:** Pin Companion version to match production (5.0.7). The tarball structure also changed (5.0.7 has a `companion-x64` subfolder that must be moved).

### 5. @companion-module/base Version (Cobalt Module)

**Problem:** Cobalt module showed "Incompatible module version" errors. The manifest has `apiVersion: "0.0.0"` which makes base report its own version as the API version. npm installed base 1.15.1, which Companion 5.0.7 rejected.

**Fix:** Pin `@companion-module/base` to exact version `1.14.1` in package.json (not caret `^1.12.0`).

### 6. Missing GNOME Application Launchers

**Problem:** RTSPmv and Companion desktop launchers weren't created, making it hard to restart apps from the GUI.

**Fix:** Bootstrap now creates `.desktop` files in `/home/mv/.local/share/applications/`.

### 7. Screen Lock Despite dconf Settings

**Problem:** Screen still locked after idle. User-level dconf settings weren't enough; GDM also needed configuration.

**Fix:** Configure both user dconf profile AND GDM dconf profile:
```bash
# User session
/etc/dconf/db/local.d/00-mv-settings
/etc/dconf/db/local.d/locks/mv-settings

# GDM login screen
/etc/dconf/db/gdm.d/00-mv-settings
/etc/dconf/db/gdm.d/locks/mv-settings
```

### 8. NIC Profile Not Bound to Interface

**Problem:** "Wired connection 1" profile existed but wasn't bound to a specific interface. On a dual-NIC system, NetworkManager might assign it to either NIC unpredictably.

**Fix:** Explicitly bind profiles to interface names:
```bash
nmcli connection modify "Wired connection 1" connection.interface-name <MGMT_IF>
```

### 9. IP Conflict / Wrong NIC as Default Route

**Problem:** Management NIC (no internet) became default route. Appliance couldn't reach the internet for package downloads or camera streams.

**Fix:** Camera NIC must have gateway and be the default route. Management NIC must have `ipv4.never-default yes` and no gateway:
```bash
# Camera NIC (USB): default route
ipv4.gateway <CAM_GATEWAY>
ipv4.never-default no

# Management NIC (onboard): local only
ipv4.gateway ""
ipv4.never-default yes
```

### 10. go2rtc WebSocket Origin Rejection

**Problem:** Browser WebSocket connections to go2rtc failed. go2rtc 1.9.x added origin checking that rejected requests from `http://127.0.0.1:8090`.

**Fix:** RTSPmv 0.4.0 configures go2rtc with `origin: "127.0.0.1 localhost"` to allow local browser connections.

### 11. No Internet on Management LAN

**Problem:** Management network has no gateway. Tried to install packages over this network and failed.

**Fix:** Ensure camera NIC (with internet) is connected and configured as default route before running any commands that need network access.

### 12. Stream Deck / USB Surfaces Not Detected

**Problem:** Companion didn't detect USB Stream Deck even though `lsusb` showed it. The `mv` user couldn't access `/dev/hidraw*` devices.

**Fix:** Install udev rules and add user to required groups:
```bash
# Install udev rules (50-companion.rules with MODE="666", GROUP="plugdev")
# Add user to groups: plugdev, dialout, input, audio
usermod -aG plugdev,dialout,input,audio mv
udevadm control --reload-rules && udevadm trigger
systemctl restart companion
```

The official Companion-Pi installer creates a dedicated `companion` user with its own group. Our setup runs as `mv` user with `plugdev` group ownership on hidraw devices.

### 13. Firefox --kiosk Not True Fullscreen on GNOME/Wayland

**Problem:** Firefox's `--kiosk` flag doesn't hide GNOME panels on Wayland. The MV opens maximized but top bar and dock remain visible.

**Fix:** Disable Wayland (use X11) and use xdotool to send F11 after Firefox starts:
```bash
# In GDM config: WaylandEnable=false
# Wrapper script waits for window, then:
xdotool key --window "$WID" F11
```

The `kiosk-fullscreen.sh` wrapper handles this automatically.

## Verification

After first boot:

### VAAPI hardware decode
```bash
vainfo
# Should show iHD driver, H.264/HEVC entrypoints
```

### GPU utilization during playback
```bash
sudo intel_gpu_top
# Video engine should show activity while MV plays streams
```

### Companion
Open `http://127.0.0.1:8000` - all three dev modules should appear:
- Cobalt Digital: 9905-MPx
- RTSPmv
- RTSP Thumbnail

### RTSPmv
```bash
systemctl --user status rtspmv
# Should be active
```

### Services
```bash
systemctl status companion
journalctl --user -u rtspmv -f
```

### Stream Deck / USB Surfaces
USB surfaces (Stream Deck, X-keys, Loupedeck) should appear in Companion > Surfaces:
```bash
# Check Companion logs for surface detection
sudo journalctl -u companion | grep -i "surface.*ready"
# Should show: Surface panel ready: streamdeck:<SERIAL>
```

If USB surfaces don't appear:
1. Verify udev rules: `ls -la /etc/udev/rules.d/50-companion.rules`
2. Check hidraw permissions: `ls -la /dev/hidraw*` (should be `crw-rw-rw-` with group `plugdev`)
3. Verify user groups: `id mv | grep plugdev`
4. Reload rules: `sudo udevadm control --reload-rules && sudo udevadm trigger`
5. Restart Companion: `sudo systemctl restart companion`

## Updating a Dev Module

```bash
cd /home/mv/dev/companion-module-rtspmv
git pull  # or replace files manually
npm ci --omit=dev
sudo systemctl restart companion
```

## Cloning to a New Profile

```bash
cp -r profiles/mv-host profiles/new-profile
# Edit new-profile/preseed.cfg and bootstrap.sh
# Update URLs in preseed late_command
```

## Post-Install Manual Steps

1. **Camera URLs:** Open `http://127.0.0.1:8090/settings`, add RTSP camera streams

2. **Companion config:** Import your `.companionconfig` at `http://127.0.0.1:8000`

3. **RTSPmv connection:** In Companion, point the RTSPmv module connection to `127.0.0.1:8090`

4. **RTSP Thumbnail ffmpeg path:** In each RTSP Thumbnail connection, clear any Windows ffmpeg path (leave blank to use system ffmpeg)

## Troubleshooting

### Check Previous Boot Logs After Freeze

With persistent journald (configured by bootstrap), logs survive reboots. After a freeze that required hard reboot:

```bash
# Kernel messages from previous boot
journalctl -b -1 -k | grep -iE 'oom|kill|i915|hang|blocked'

# All previous boot messages
journalctl -b -1 --priority=0..4
```

### Companion SIGABRT / Segfault

If Companion crashes with SIGABRT, check `~/segfault.log`. This is written by Companion's built-in segfault handler. Example from Nov 2026:

```
/opt/companion/resources/node-runtimes/main/bin/node(_ZN4node7FPrintF...)
...
/lib/x86_64-linux-gnu/libc.so.6(abort+0x22)
```

This indicates a crash in the Node.js runtime, possibly due to memory pressure or a module bug. Check journalctl for OOM kills around the same time.

### High-Rate Module Errors (CPU Saturation)

Companion modules that poll rapidly with wrong settings can saturate CPU with error logging. Symptoms:
- System freeze or extreme slowness
- Load average >> number of CPU cores
- journalctl shows same error repeating hundreds of times per second

**Example:** Evertz Quartz router module with `max_sources`/`max_destinations` set higher than actual router size, combined with 50ms poll interval = ~600 errors/second.

**Diagnosis:**
```bash
# Check for repeated errors
journalctl -u companion --since "5 minutes ago" | sort | uniq -c | sort -rn | head

# Check error rate
journalctl -u companion --since "1 minute ago" | grep -c error
```

**Fix:** Reduce poll interval or fix the module configuration. The journald rate limit (1000 burst / 30s) will cap logging but won't stop the CPU usage from the module itself.

### Verify Watchdog Is Active

```bash
systemctl show | grep -i watchdog
# Should show: RuntimeWatchdogUSec=30s, WatchdogDevice=/dev/watchdog0

lsmod | grep wdt
# Should show: iTCO_wdt, mei_wdt
```

### Vacuum Journal If Full

```bash
journalctl --disk-usage
sudo journalctl --vacuum-size=500M
```

## Files

```
profiles/mv-host/
  preseed.cfg       # Debian installer answers
  bootstrap.sh      # Post-install setup script
  README.md         # This file
  files/
    rtspmv/         # RTSPmv application
  dev/
    cobalt-9905-color-corrector/
    companion-module-rtspmv/
    companion-module-rtsp-thumbnail/
```
