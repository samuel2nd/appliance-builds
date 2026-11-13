# MV Host Profile

Unattended Debian 13 installation for a camera multiviewer appliance.

## Target Hardware

- **Model:** Dell OptiPlex 3050 Micro
- **CPU:** Intel Core i5-6500T (Skylake, supports Quick Sync / VAAPI)
- **RAM:** 8 GB
- **Storage:** 256 GB SATA SSD (`/dev/sda`)
- **Network:** Wired Ethernet (DHCP)

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

1. **System packages:** `intel-media-va-driver`, `vainfo`, `intel-gpu-tools`, `ffmpeg`, `git`, `curl`, `python3`, `firefox-esr`

2. **GNOME settings:** Autologin for `mv`, screen blank disabled, screensaver disabled, suspend disabled, notifications disabled

3. **Node.js 22:** From NodeSource repository

4. **Bitfocus Companion 5.0.1:** Installed to `/opt/companion`, runs as systemd service with `COMPANION_DEV_MODULES=/home/mv/dev`

5. **Companion dev modules:** Installed to `/home/mv/dev/`:
   - `cobalt-9905-color-corrector` v2.1.1
   - `companion-module-rtspmv` v0.2.0
   - `companion-module-rtsp-thumbnail` v0.4.0

6. **RTSPmv 0.4.0:** Installed to `/home/mv/.local/share/rtspmv`, runs as systemd user service

7. **go2rtc v1.9.15:** Downloaded with SHA256 verification: `20b46c6910734cb05ecefb234066f36868ff19b42ba1418a7a32e13a3e035712`

8. **MV autostart:** Firefox ESR kiosk mode with VAAPI hardware decode, opens `http://127.0.0.1:8090/mv` at login

9. **Firewall (if ufw active):** Opens ports 8090 (RTSPmv), 8555 (WebRTC), 8000 (Companion)

## Pinned Versions

| Component | Version |
|-----------|---------|
| Companion | 5.0.1 |
| Node.js | 22.x |
| go2rtc | v1.9.15 |
| RTSPmv | 0.4.0 |
| cobalt-9905-color-corrector | 2.1.1 |
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
