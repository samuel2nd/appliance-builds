#!/bin/bash
# build-iso.sh - Create a custom Debian netinst ISO with preseed URL baked in
# Usage: ./build-iso.sh <profile-name> [source-iso]
#
# Example:
#   ./build-iso.sh mv-host debian-13.0.0-amd64-netinst.iso
#
# Requirements (Debian/Ubuntu):
#   sudo apt install xorriso isolinux syslinux-utils

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <profile-name> [source-iso]"
    echo ""
    echo "Arguments:"
    echo "  profile-name   Profile directory name (e.g., mv-host)"
    echo "  source-iso     Path to Debian netinst ISO (default: debian-13.0.0-amd64-netinst.iso)"
    echo ""
    echo "Output:"
    echo "  debian-<profile>-netinst.iso in current directory"
    exit 1
}

if [[ $# -lt 1 ]]; then
    usage
fi

PROFILE="$1"
SOURCE_ISO="${2:-debian-13.0.0-amd64-netinst.iso}"
PROFILE_DIR="$REPO_ROOT/profiles/$PROFILE"
OUTPUT_ISO="debian-${PROFILE}-netinst.iso"
WORK_DIR=$(mktemp -d)
ISO_MOUNT="$WORK_DIR/mnt"
ISO_EXTRACT="$WORK_DIR/iso"

# Preseed URL (GitHub Pages)
PRESEED_URL="https://samuel2nd.github.io/appliance-builds/profiles/${PROFILE}/preseed.cfg"

cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    sudo umount "$ISO_MOUNT" 2>/dev/null || true
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Validation
if [[ ! -d "$PROFILE_DIR" ]]; then
    echo -e "${RED}Error: Profile '$PROFILE' not found at $PROFILE_DIR${NC}"
    exit 1
fi

if [[ ! -f "$SOURCE_ISO" ]]; then
    echo -e "${RED}Error: Source ISO not found: $SOURCE_ISO${NC}"
    echo ""
    echo "Download the Debian 13 netinst ISO:"
    echo "  curl -LO https://cdimage.debian.org/cdimage/release/current/amd64/iso-cd/debian-13.0.0-amd64-netinst.iso"
    exit 1
fi

# Check dependencies
for cmd in xorriso isohybrid; do
    if ! command -v "$cmd" &>/dev/null; then
        echo -e "${RED}Error: $cmd not found. Install with:${NC}"
        echo "  sudo apt install xorriso isolinux syslinux-utils"
        exit 1
    fi
done

echo -e "${GREEN}Building custom ISO for profile: $PROFILE${NC}"
echo "  Source: $SOURCE_ISO"
echo "  Output: $OUTPUT_ISO"
echo "  Preseed URL: $PRESEED_URL"
echo ""

# Mount and extract ISO
echo -e "${YELLOW}Extracting ISO...${NC}"
mkdir -p "$ISO_MOUNT" "$ISO_EXTRACT"
sudo mount -o loop,ro "$SOURCE_ISO" "$ISO_MOUNT"
cp -a "$ISO_MOUNT/." "$ISO_EXTRACT/"
sudo umount "$ISO_MOUNT"
chmod -R u+w "$ISO_EXTRACT"

# GRUB config (UEFI boot)
GRUB_CFG="$ISO_EXTRACT/boot/grub/grub.cfg"
if [[ -f "$GRUB_CFG" ]]; then
    echo -e "${YELLOW}Adding GRUB menu entry...${NC}"

    # Insert custom entry after the menuentry for "Install"
    # The entry uses auto=true priority=critical for fully unattended install
    GRUB_ENTRY="menuentry 'Install $PROFILE (automated)' --hotkey=a {
    set background_color=black
    linux    /install.amd/vmlinuz auto=true priority=critical url=$PRESEED_URL vga=788 --- quiet
    initrd   /install.amd/initrd.gz
}"

    # Insert after first menuentry line
    sed -i "/^menuentry 'Install'/a \\
\\
$GRUB_ENTRY" "$GRUB_CFG"

    # Set as default (0-indexed, our entry becomes second)
    sed -i 's/set default=.*/set default=1/' "$GRUB_CFG"
    sed -i 's/set timeout=.*/set timeout=5/' "$GRUB_CFG"
fi

# Isolinux config (BIOS boot)
ISOLINUX_CFG="$ISO_EXTRACT/isolinux/isolinux.cfg"
TXT_CFG="$ISO_EXTRACT/isolinux/txt.cfg"

if [[ -f "$TXT_CFG" ]]; then
    echo -e "${YELLOW}Adding isolinux menu entry...${NC}"

    # Add custom entry at the top of txt.cfg
    ISOLINUX_ENTRY="label auto-$PROFILE
    menu label ^Install $PROFILE (automated)
    kernel /install.amd/vmlinuz
    append auto=true priority=critical url=$PRESEED_URL vga=788 initrd=/install.amd/initrd.gz --- quiet"

    # Prepend to txt.cfg
    echo "$ISOLINUX_ENTRY
" | cat - "$TXT_CFG" > "$WORK_DIR/txt.cfg.new"
    mv "$WORK_DIR/txt.cfg.new" "$TXT_CFG"
fi

if [[ -f "$ISOLINUX_CFG" ]]; then
    # Set timeout and default
    sed -i 's/timeout .*/timeout 50/' "$ISOLINUX_CFG"
    # Default to our custom entry
    sed -i "s/default .*/default auto-$PROFILE/" "$ISOLINUX_CFG"
fi

# Update MD5 checksums
echo -e "${YELLOW}Updating checksums...${NC}"
cd "$ISO_EXTRACT"
find . -type f ! -name md5sum.txt -exec md5sum {} \; > md5sum.txt
cd - >/dev/null

# Rebuild ISO
echo -e "${YELLOW}Building ISO...${NC}"
xorriso -as mkisofs \
    -r -V "Debian $PROFILE" \
    -o "$OUTPUT_ISO" \
    -J -joliet-long \
    -isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin \
    -partition_offset 16 \
    -c isolinux/boot.cat \
    -b isolinux/isolinux.bin \
    -no-emul-boot -boot-load-size 4 -boot-info-table \
    -eltorito-alt-boot \
    -e boot/grub/efi.img \
    -no-emul-boot -isohybrid-gpt-basdat \
    "$ISO_EXTRACT"

# Verify
if [[ -f "$OUTPUT_ISO" ]]; then
    SIZE=$(du -h "$OUTPUT_ISO" | cut -f1)
    echo ""
    echo -e "${GREEN}Success! Created: $OUTPUT_ISO ($SIZE)${NC}"
    echo ""
    echo "To write to USB (Linux):"
    echo "  sudo dd if=$OUTPUT_ISO of=/dev/sdX bs=4M status=progress conv=fsync"
    echo ""
    echo "Boot menu will show 'Install $PROFILE (automated)' as default."
else
    echo -e "${RED}Error: ISO creation failed${NC}"
    exit 1
fi
