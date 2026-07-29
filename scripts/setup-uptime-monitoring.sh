#!/usr/bin/env bash
set -euo pipefail
API_KEY="${BETTER_UPTIME_API_KEY:-}"
BASE_URL="${BETTER_UPTIME_BASE_URL:-https://betteruptime.com/api/v1}"
[ -n "$API_KEY" ] || { echo "ERROR: API key not set"; exit 1; }
u() { local n="$1" u="$2" i="$3" r="$4"; local e; e=$(curl -s -X GET "$BASE_URL/monitors" -H "Authorization: Bearer $API_KEY" | jq -r --arg n "$n" '.data[] | select(.attributes.name == $n) | .id' | head -1); local p='{"monitor":{"name":"'"$n"'","monitor_type":"http","url":"'"$u"'","check_interval":'"$i"',"regions":'"$r"',"http_method":"GET","expected_status_code":200,"paused":false}}'; [ -n "$e" ] && { echo "Updating: $n"; curl -s -X PATCH "$BASE_URL/monitors/$e" -H "Authorization: Bearer $API_KEY" -d "$p" > /dev/null; } || { echo "Creating: $n"; curl -s -X POST "$BASE_URL/monitors" -H "Authorization: Bearer $API_KEY" -d "$p" > /dev/null; }; }
uh() { local n="$1" u="$2" i="$3" g="$4"; local e; e=$(curl -s -X GET "$BASE_URL/heartbeats" -H "Authorization: Bearer $API_KEY" | jq -r --arg n "$n" '.data[] | select(.attributes.name == $n) | .id' | head -1); local p='{"heartbeat":{"name":"'"$n"'","url":"'"$u"'","period":'"$i"',"grace":'"$g"',"paused":false}}'; [ -n "$e" ] && { echo "Updating: $n"; curl -s -X PATCH "$BASE_URL/heartbeats/$e" -H "Authorization: Bearer $API_KEY" -d "$p" > /dev/null; } || { echo "Creating: $n"; curl -s -X POST "$BASE_URL/heartbeats" -H "Authorization: Bearer $API_KEY" -d "$p" > /dev/null; }; }
echo "=== STAS Uptime Setup ==="
u "STAS /health" "https://api.stas.aimino.io/health" 30 '["us-east-1","eu-west-1","ap-southeast-1"]'
u "STAS /health/queue" "https://api.stas.aimino.io/health/queue" 60 '["us-east-1","eu-west-1"]'
u "STAS /api/pricing" "https://api.stas.aimino.io/api/pricing" 300 '["us-east-1","eu-west-1"]'
u "STAS Website" "https://stas.aimino.io/" 300 '["us-east-1","eu-west-1","ap-southeast-1"]'
uh "STAS Synthetic E2E" "https://api.stas.aimino.io/monitoring/synthetic-heartbeat" 300 120
echo "=== Done ==="
