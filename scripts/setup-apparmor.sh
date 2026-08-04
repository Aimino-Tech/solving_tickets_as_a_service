#!/bin/sh
# SYNTARO Sandbox AppArmor Profile Setup
# Loads the syntaro-sandbox AppArmor profile into the kernel.
# Must be run as root on the Docker host.
#
# Usage:
#   sudo ./scripts/setup-apparmor.sh              # Load/reload profile
#   sudo ./scripts/setup-apparmor.sh --status      # Check profile status
#   sudo ./scripts/setup-apparmor.sh --unload      # Remove profile

set -e

PROFILE_NAME="syntaro-sandbox"
PROFILE_SRC="./docker/apparmor/${PROFILE_NAME}"
PROFILE_DST="/etc/apparmor.d/${PROFILE_NAME}"

usage() {
  echo "Usage: $0 [--status|--unload]"
  echo ""
  echo "  (no args)  Load or reload the ${PROFILE_NAME} AppArmor profile"
  echo "  --status   Check if the profile is loaded in the kernel"
  echo "  --unload   Remove the profile from the kernel"
  exit 0
}

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  usage
fi

if ! command -v apparmor_parser >/dev/null 2>&1; then
  echo "ERROR: apparmor_parser not found. Is AppArmor installed on the host?"
  echo "  Install: apt-get install apparmor-utils  (Debian/Ubuntu)"
  echo "           yum install apparmor-utils      (RHEL/Fedora)"
  exit 1
fi

if [ "$1" = "--status" ]; then
  if aa-status 2>/dev/null | grep -q "${PROFILE_NAME}"; then
    echo "Profile '${PROFILE_NAME}' is loaded:"
    aa-status 2>/dev/null | grep "${PROFILE_NAME}"
    exit 0
  else
    echo "Profile '${PROFILE_NAME}' is NOT loaded."
    exit 1
  fi
fi

if [ "$1" = "--unload" ]; then
  echo "Unloading AppArmor profile: ${PROFILE_NAME}"
  apparmor_parser -R "${PROFILE_DST}" 2>/dev/null || true
  echo "Profile unloaded."
  exit 0
fi

if [ ! -f "${PROFILE_SRC}" ]; then
  echo "ERROR: Profile source not found: ${PROFILE_SRC}"
  echo "Run this script from the project root directory."
  exit 1
fi

echo "Installing AppArmor profile: ${PROFILE_NAME}"

cp "${PROFILE_SRC}" "${PROFILE_DST}"
chmod 644 "${PROFILE_DST}"

if aa-status 2>/dev/null | grep -q "${PROFILE_NAME}"; then
  echo "Reloading existing profile..."
  apparmor_parser -r -W "${PROFILE_DST}"
else
  echo "Loading new profile..."
  apparmor_parser -a -W "${PROFILE_DST}"
fi

echo "AppArmor profile '${PROFILE_NAME}' loaded successfully."
echo ""
echo "Verify with: sudo aa-status | grep ${PROFILE_NAME}"
echo "Docker containers can use: --security-opt apparmor=${PROFILE_NAME}"
