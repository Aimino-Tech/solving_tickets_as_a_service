#!/bin/sh
# SYNTARO Egress Proxy Entrypoint
# Generates the allowed domains file from the ALLOWED_DOMAINS env var
# and starts Squid.

set -e

ALLOWED_DOMAINS_FILE="/etc/squid/allowed_domains.txt"

# Ensure directory exists
mkdir -p "$(dirname "$ALLOWED_DOMAINS_FILE")"

# Generate allowed domains file from env var
if [ -n "$ALLOWED_DOMAINS" ]; then
  echo "$ALLOWED_DOMAINS" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' > "$ALLOWED_DOMAINS_FILE"
  echo "Generated allowed domains (count: $(wc -l < "$ALLOWED_DOMAINS_FILE")):"
  cat "$ALLOWED_DOMAINS_FILE"
else
  echo "WARNING: ALLOWED_DOMAINS is empty — all egress traffic will be blocked"
  touch "$ALLOWED_DOMAINS_FILE"
fi

# Initialize Squid cache directories if needed
if [ ! -d /var/spool/squid/00 ]; then
  squid -z -N 2>/dev/null || true
fi

# Start Squid in foreground
exec squid -N
