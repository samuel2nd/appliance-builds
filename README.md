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

## USB Stick Creation

Download the latest Debian 13 netinst ISO and verify:

```bash
curl -LO https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/debian-13.7.0-amd64-netinst.iso
curl -LO https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/SHA256SUMS
sha256sum -c SHA256SUMS 2>&1 | grep netinst
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
   & "C:\Program Files\Git\usr\bin\dd.exe" if=debian-13.7.0-amd64-netinst.iso of=/dev/sdc bs=4M status=progress conv=fsync
   ```
   Disk mapping: `/dev/sda` = Disk 0, `/dev/sdb` = Disk 1, `/dev/sdc` = Disk 2, etc.

**Note:** Claude Code must run in an elevated terminal to write directly to raw disks.

### Writing the ISO (Linux)

```bash
sudo dd if=debian-13.7.0-amd64-netinst.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

## Requirements

- Debian 13 (Trixie) amd64 netinst ISO
- Wired network with DHCP and internet access
- Target hardware compatible with the profile

## Notes

- **Branch name:** This repo uses `master`. All raw URLs must reference `master`, not `main`.

## Security Notes

- No default passwords are preseeded; the installer prompts for the user password
- RTSPmv settings/camera editing is localhost-only by default
- go2rtc API binds to 127.0.0.1 only (not network-accessible)
- Companion dev modules path is set via environment variable
