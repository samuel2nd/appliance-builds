# Appliance Builds

Unattended Debian 13 installations via preseed URL for broadcast/AV appliances.

## How It Works

1. Boot a stock Debian 13 netinst USB
2. Select **Advanced options** > **Automated install**
3. Enter the preseed URL for your profile
4. The installer runs unattended, then fetches and executes the profile's bootstrap script

## Profiles

| Profile | Description |
|---------|-------------|
| [mv-host](profiles/mv-host/) | Camera multiviewer: RTSPmv + Bitfocus Companion |

## Adding a New Profile

1. Copy an existing profile:
   ```bash
   cp -r profiles/mv-host profiles/my-profile
   ```

2. Edit `preseed.cfg`:
   - Update hostname, user, partitioning as needed
   - Change the `late_command` URL to point to your profile's bootstrap

3. Edit `bootstrap.sh`:
   - Modify packages, services, and configuration

4. Add any files to `files/` or `dev/`

5. Update `README.md` with specifics

6. Commit, push, and test

## Repository Structure

```
appliance-builds/
  README.md
  profiles/
    mv-host/
      preseed.cfg       # Installer answers
      bootstrap.sh      # Post-install script
      README.md         # Profile documentation
      files/            # Application files
      dev/              # Companion dev modules
```

## Preseed URLs

Each profile's preseed can be accessed via:

- **GitHub Pages (short):** `https://samuel2nd.github.io/appliance-builds/profiles/<name>/preseed.cfg`
- **Raw GitHub:** `https://raw.githubusercontent.com/samuel2nd/appliance-builds/master/profiles/<name>/preseed.cfg`

## Custom ISO with Preseed Baked In

Instead of manually selecting "Advanced options > Automated install" and typing the preseed URL, build a custom ISO with your profile's preseed URL baked in. The boot menu will default to "Install mv-host (automated)" with a 5-second timeout.

### Building the Custom ISO (Linux)

```bash
# Install dependencies
sudo apt install xorriso isolinux syslinux-utils

# Download current Debian 13 netinst (auto-detect version)
ISO_FILE=$(curl -sL "https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/" | \
    grep -oP 'debian-[0-9]+\.[0-9]+\.[0-9]+-amd64-netinst\.iso' | head -1)
curl -LO "https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/$ISO_FILE"
curl -LO "https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/SHA256SUMS"
sha256sum -c SHA256SUMS 2>&1 | grep "$ISO_FILE"

# Build custom ISO for your profile
./tools/build-iso.sh mv-host "$ISO_FILE"

# Output: debian-mv-host-netinst.iso
```

The script adds a GRUB/isolinux menu entry with `auto=true priority=critical url=<preseed-url>` baked in.

### Regenerating for a Different Profile

```bash
# Clone the profile first
cp -r profiles/mv-host profiles/new-profile
# Edit new-profile/preseed.cfg and bootstrap.sh with new URLs
# Then build:
./tools/build-iso.sh new-profile "$ISO_FILE"
```

## Stock USB Stick (Manual Preseed Entry)

If you don't want to build a custom ISO, use the stock Debian netinst and enter the preseed URL manually.

Download the latest Debian 13 netinst ISO and verify:

```bash
# Auto-detect current version
ISO_FILE=$(curl -sL "https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/" | \
    grep -oP 'debian-[0-9]+\.[0-9]+\.[0-9]+-amd64-netinst\.iso' | head -1)
curl -LO "https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/$ISO_FILE"
curl -LO "https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/SHA256SUMS"
sha256sum -c SHA256SUMS 2>&1 | grep "$ISO_FILE"
```

### Writing the ISO (Windows, elevated PowerShell)

1. **Identify the USB disk:**
   ```powershell
   Get-Disk | Select-Object Number, FriendlyName, Size, BusType | Format-Table
   ```
   Note the disk number (e.g., `2` for a 60 GB USB Flash Disk).

2. **Clear the disk:**
   ```powershell
   Clear-Disk -Number 2 -RemoveData -RemoveOEM -Confirm:$false
   ```

3. **Write the ISO using Git's dd:**
   ```powershell
   & "C:\Program Files\Git\usr\bin\dd.exe" if=debian-mv-host-netinst.iso of=/dev/sdc bs=4M status=progress conv=fsync
   ```
   Disk mapping: `/dev/sda` = Disk 0, `/dev/sdb` = Disk 1, `/dev/sdc` = Disk 2, etc.

**Note:** Claude Code must run in an elevated terminal to write directly to raw disks.

### Writing the ISO (Linux)

```bash
sudo dd if=debian-mv-host-netinst.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

## Requirements

- Debian 13 (Trixie) amd64 netinst ISO
- Wired network with DHCP and internet access
- Target hardware compatible with the profile

## Notes

- **Branch name:** This repo uses `master`. All raw URLs must reference `master`, not `main`.
- **Companion tarball:** Uses `companion_headless.sh` (not `launch.sh`), downloads from `cf-pub.bitfocus.io`, extracts without `--strip-components`.
- **Dev module permissions:** Must `chown` modules to target user before `npm install`.
- **GitHub CDN cache:** Raw URLs may cache for ~5 minutes; copy scripts directly for immediate updates.

## Security Notes

- No default passwords are preseeded; the installer prompts for the user password
- RTSPmv settings/camera editing is localhost-only by default
- go2rtc API binds to 127.0.0.1 only (not network-accessible)
- Companion dev modules path is set via environment variable
