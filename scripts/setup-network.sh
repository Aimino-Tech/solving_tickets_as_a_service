#!/bin/sh
# STAS Sandbox Network Setup
# Creates the stas_agent-net bridge and applies host iptables rules
# to prevent Squid bypass (DNS tunneling, direct IP connections).
#
# Run once at daemon/container start. Idempotent.
#
# Usage:
#   sudo ./scripts/setup-network.sh           # Set up rules
#   sudo ./scripts/setup-network.sh --cleanup  # Remove rules

set -e

NETWORK_NAME="stas_agent-net"
BRIDGE_NAME="br-stas_agent-net"
DNS_PRIMARY="1.1.1.1"
DNS_SECONDARY="8.8.8.8"
PROXY_PORT="3128"
ALLOWED_HOSTS="${ALLOWED_DOMAINS:-api.github.com,github.com,raw.githubusercontent.com,registry.npmjs.org,pypi.org,files.pythonhosted.org,proxy.golang.org,index.crates.io,crates.io}"

cleanup() {
  echo "Cleaning up iptables rules for ${NETWORK_NAME}..."

  # Remove forward rules
  iptables -D FORWARD -i "${BRIDGE_NAME}" -j DROP 2>/dev/null || true
  iptables -D FORWARD -i "${BRIDGE_NAME}" -p tcp --dport "${PROXY_PORT}" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -i "${BRIDGE_NAME}" -p udp --dport 53 -d "${DNS_PRIMARY}" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -i "${BRIDGE_NAME}" -p udp --dport 53 -d "${DNS_SECONDARY}" -j ACCEPT 2>/dev/null || true

  # Remove established/related rule
  iptables -D FORWARD -i "${BRIDGE_NAME}" -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true

  echo "Cleanup complete."
}

if [ "$1" = "--cleanup" ]; then
  cleanup
  exit 0
fi

echo "Setting up network isolation for ${NETWORK_NAME}..."

# 1. Ensure Docker network exists
if ! docker network ls --filter "name=${NETWORK_NAME}" --format '{{.Name}}' | grep -q "^${NETWORK_NAME}$"; then
  echo "Creating Docker network: ${NETWORK_NAME}"
  docker network create --driver bridge --internal=false "${NETWORK_NAME}"
else
  echo "Docker network ${NETWORK_NAME} already exists"
fi

# 2. Get bridge interface name
BRIDGE_ID=$(docker network inspect "${NETWORK_NAME}" --format '{{.Id}}' 2>/dev/null | cut -c1-12)
if [ -n "${BRIDGE_ID}" ]; then
  BRIDGE_NAME="br-${BRIDGE_ID}"
fi
echo "Bridge interface: ${BRIDGE_NAME}"

# 3. Allow established connections
iptables -C FORWARD -i "${BRIDGE_NAME}" -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null ||
  iptables -A FORWARD -i "${BRIDGE_NAME}" -m state --state ESTABLISHED,RELATED -j ACCEPT

# 4. Allow DNS to known resolvers (prevent DNS tunneling bypass)
iptables -C FORWARD -i "${BRIDGE_NAME}" -p udp --dport 53 -d "${DNS_PRIMARY}" -j ACCEPT 2>/dev/null ||
  iptables -A FORWARD -i "${BRIDGE_NAME}" -p udp --dport 53 -d "${DNS_PRIMARY}" -j ACCEPT

iptables -C FORWARD -i "${BRIDGE_NAME}" -p udp --dport 53 -d "${DNS_SECONDARY}" -j ACCEPT 2>/dev/null ||
  iptables -A FORWARD -i "${BRIDGE_NAME}" -p udp --dport 53 -d "${DNS_SECONDARY}" -j ACCEPT

# 5. Allow traffic to the Squid proxy port
iptables -C FORWARD -i "${BRIDGE_NAME}" -p tcp --dport "${PROXY_PORT}" -j ACCEPT 2>/dev/null ||
  iptables -A FORWARD -i "${BRIDGE_NAME}" -p tcp --dport "${PROXY_PORT}" -j ACCEPT

# 6. Drop all other traffic from the agent network (Squid bypass prevention)
iptables -C FORWARD -i "${BRIDGE_NAME}" -j DROP 2>/dev/null ||
  iptables -A FORWARD -i "${BRIDGE_NAME}" -j DROP

echo "Network isolation rules applied successfully."
echo ""
echo "Summary:"
echo "  Network:   ${NETWORK_NAME}"
echo "  Bridge:    ${BRIDGE_NAME}"
echo "  Proxy:     :${PROXY_PORT}"
echo "  DNS:       ${DNS_PRIMARY}, ${DNS_SECONDARY}"
echo "  Default:   DROP all other egress"
echo ""
echo "To remove rules: sudo ./scripts/setup-network.sh --cleanup"
