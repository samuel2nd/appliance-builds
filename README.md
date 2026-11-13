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
- **Raw GitHub:** `https://raw.githubusercontent.com/samuel2nd/appliance-builds/main/profiles/<name>/preseed.cfg`

## Requirements

- Debian 13 (Trixie) amd64 netinst ISO
- Wired network with DHCP and internet access
- Target hardware compatible with the profile

## Security Notes

- No default passwords are preseeded; the installer prompts for the user password
- RTSPmv settings/camera editing is localhost-only by default
- go2rtc API binds to 127.0.0.1 only (not network-accessible)
- Companion dev modules path is set via environment variable
