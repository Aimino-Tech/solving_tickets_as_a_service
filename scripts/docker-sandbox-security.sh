#!/usr/bin/env bash
# SYNTARO Docker Sandbox Security Setup
#
# Installs and configures seccomp + AppArmor profiles for Docker sandbox
# containers.  Must be run as root on the Docker host.
#
# Usage:
#   sudo ./scripts/docker-sandbox-security.sh                # Install profiles
#   sudo ./scripts/docker-sandbox-security.sh --status        # Check status
#   sudo ./scripts/docker-sandbox-security.sh --unload        # Remove AppArmor
#   sudo ./scripts/docker-sandbox-security.sh --help          # This help
#
# What this does:
#   1. Verifies that Docker and (optionally) AppArmor are available.
#   2. Writes the seccomp profile to /etc/docker/seccomp/ so it can be
#      referenced via --security-opt seccomp=/etc/docker/...
#   3. Loads the AppArmor profile into the kernel (if AppArmor is present)
#      so it can be referenced via --security-opt apparmor=syntaro-sandbox.
#   4. Prints a docker run example that uses both profiles.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SECDST="/etc/docker/seccomp"
APPARMOR_SRC="${PROJECT_DIR}/docker/apparmor/syntaro-sandbox"
APPARMOR_DST="/etc/apparmor.d/syntaro-sandbox"
PROFILE_NAME="syntaro-sandbox"

# ── Helpers ───────────────────────────────────────────────────────────────────

usage() {
  sed -n '/^# SYNTARO/,/^$/ { s/^# //; p; }' "$0"
  exit 0
}

log_info()  { printf '\033[36m[INFO]\033[0m  %s\n' "$*"; }
log_ok()    { printf '\033[32m[OK]\033[0m    %s\n' "$*"; }
log_warn()  { printf '\033[33m[WARN]\033[0m  %s\n' "$*"; }
log_error() { printf '\033[31m[ERROR]\033[0m %s\n' "$*"; }

# ── Arg parsing ───────────────────────────────────────────────────────────────

case "${1:-}" in
  --help|-h) usage ;;
  --status)  MODE="status" ;;
  --unload)  MODE="unload" ;;
  *)         MODE="install" ;;
esac

# ── Prerequisites ─────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
  log_error "This script must be run as root. Try: sudo $0"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  log_error "Docker is not installed."
  exit 1
fi

HAS_APPARMOR=false
if command -v apparmor_parser &>/dev/null || command -v aa-status &>/dev/null; then
  HAS_APPARMOR=true
fi

# ── Mode: status ──────────────────────────────────────────────────────────────

if [ "$MODE" = "status" ]; then
  echo ""
  log_info "=== Docker Sandbox Security Profile Status ==="
  echo ""

  # Seccomp
  if [ -f "${SECDST}/sandbox.json" ]; then
    log_ok "Seccomp profile installed: ${SECDST}/sandbox.json"
  else
    log_warn "Seccomp profile NOT installed at ${SECDST}/sandbox.json"
  fi

  # AppArmor
  if [ "$HAS_APPARMOR" = true ]; then
    if aa-status 2>/dev/null | grep -q "${PROFILE_NAME}"; then
      log_ok "AppArmor profile '${PROFILE_NAME}' is loaded in the kernel."
    else
      log_warn "AppArmor profile '${PROFILE_NAME}' is NOT loaded."
    fi
  else
    log_warn "AppArmor is not available on this host."
  fi

  echo ""
  exit 0
fi

# ── Mode: unload (AppArmor only) ─────────────────────────────────────────────

if [ "$MODE" = "unload" ]; then
  if [ "$HAS_APPARMOR" = true ]; then
    log_info "Unloading AppArmor profile '${PROFILE_NAME}' ..."
    apparmor_parser -R "${APPARMOR_DST}" 2>/dev/null || true
    log_ok "AppArmor profile unloaded."
  else
    log_warn "AppArmor not available — nothing to unload."
  fi
  exit 0
fi

# ── Mode: install ─────────────────────────────────────────────────────────────

log_info "=== Installing Docker Sandbox Security Profiles ==="
echo ""

# ── 1. Seccomp ────────────────────────────────────────────────────────────────
log_info "Installing seccomp profile ..."
mkdir -p "${SECDST}"
cp "${PROJECT_DIR}/docker/seccomp/sandbox.json" "${SECDST}/sandbox.json"
chmod 644 "${SECDST}/sandbox.json"
log_ok "Seccomp profile installed to ${SECDST}/sandbox.json"

# ── 2. AppArmor ───────────────────────────────────────────────────────────────
if [ "$HAS_APPARMOR" = true ]; then
  log_info "Installing AppArmor profile '${PROFILE_NAME}' ..."

  if [ ! -f "${APPARMOR_SRC}" ]; then
    log_error "AppArmor source not found: ${APPARMOR_SRC}"
    exit 1
  fi

  cp "${APPARMOR_SRC}" "${APPARMOR_DST}"
  chmod 644 "${APPARMOR_DST}"

  if aa-status 2>/dev/null | grep -q "${PROFILE_NAME}"; then
    log_info "Reloading existing AppArmor profile ..."
    apparmor_parser -r -W "${APPARMOR_DST}"
  else
    log_info "Loading new AppArmor profile ..."
    apparmor_parser -a -W "${APPARMOR_DST}"
  fi

  log_ok "AppArmor profile '${PROFILE_NAME}' loaded."
else
  log_warn "AppArmor not found — skipping AppArmor setup."
  log_warn "Install with: apt-get install apparmor-utils (Debian/Ubuntu)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
log_info "=== Installation Complete ==="
echo ""
echo "  Seccomp:   ${SECDST}/sandbox.json"
if [ "$HAS_APPARMOR" = true ]; then
  echo "  AppArmor:  ${APPARMOR_DST} (loaded as '${PROFILE_NAME}')"
fi
echo ""
echo "Example docker run command:"
echo ""
echo '  docker run --rm --init \\'
echo "    --security-opt seccomp=${SECDST}/sandbox.json \\"
if [ "$HAS_APPARMOR" = true ]; then
  echo "    --security-opt apparmor=${PROFILE_NAME} \\"
fi
echo "    --read-only \\"
echo "    --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \\"
echo "    --cap-add FOWNER --cap-add FSETID --cap-add SETGID --cap-add SETUID \\"
echo "    --memory 2g --cpus 1.0 \\"
echo "    python:3.12-slim sh -c 'python --version'"
echo ""
