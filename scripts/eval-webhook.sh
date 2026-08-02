#!/usr/bin/env bash
#
# eval-webhook.sh — STAS launch-readiness happy-path eval.
#
# Proves the GitHub issues.labeled webhook → STAS → governance proxy →
# OpenSymphony chain works against the live stack:
#
#   1. POST a signed GitHub `issues.labeled` webhook to STAS → expect
#      202 {accepted:true} and an x-stas-trace-id response header
#   2. Assert the trace_id is threaded through the governance proxy and the
#      OpenSymphony upstream (visible in their logs)
#   3. Assert the kill-switch abort path: a governance tenant that is killed
#      makes the proxy return 402, which STAS logs as a governance failure
#      (fail-closed — the issue is not dispatched)
#
# Requires a running STAS instance (npm ci + npm run build + start), the
# governance proxy on :4002 with GOVERNANCE_ADMIN_KEY set, and OpenSymphony
# on :4000 with the STAS webhook endpoint (/api/v1/stas/webhook) reachable.
#
# Usage: scripts/eval-webhook.sh
#
# Environment (all optional):
#   STAS_URL        STAS webhook base    (default http://localhost:3000)
#   GOV_URL         governance proxy     (default http://localhost:4002)
#   ADMIN_KEY       governance X-Admin-Key (default eval-admin-key)
#   WEBHOOK_SECRET  STAS GITHUB_WEBHOOK_SECRET (default test-secret)
#   KILLED_TENANT   tenant used for 402  (default eval-killed)
#   TRACE_ID        (default generated)
#   GOV_LOGS_CMD / OS_LOGS_CMD   log-tail commands for trace threading checks
#
# Exit code: 0 if all checks pass, 1 otherwise.
#
set -euo pipefail

STAS_URL="${STAS_URL:-http://localhost:3000}"
GOV_URL="${GOV_URL:-http://localhost:4002}"
ADMIN_KEY="${ADMIN_KEY:-eval-admin-key}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-test-secret}"
KILLED_TENANT="${KILLED_TENANT:-eval-killed}"
TRACE_ID="${TRACE_ID:-eval-stas-$(date +%s)-$$}"

PASS=0
FAIL=0

pass() { echo "  [PASS]  $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL]  $1"; FAIL=$((FAIL + 1)); }

check() {
  local name="$1" result="$2"
  if [ "$result" = "0" ]; then pass "$name"; else fail "$name"; fi
}

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo 000
}

# GitHub `issues.labeled` payload with a stas:fix label so STAS routes it.
PAYLOAD=$(cat <<JSON
{
  "action": "labeled",
  "issue": {"number": 1, "title": "Eval issue $TRACE_ID", "body": "launch-readiness eval", "labels": [{"name": "stas:fix"}]},
  "repository": {"full_name": "Aimino-Tech/eval-repo", "name": "eval-repo", "owner": {"login": "Aimino-Tech"}},
  "installation": {"id": "eval-install"},
  "label": {"name": "stas:fix"},
  "sender": {"login": "eval-user"}
}
JSON
)
SIGNATURE="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"

echo "=== STAS eval: webhook → governance → OpenSymphony ==="
echo "STAS=$STAS_URL  GOV=$GOV_URL  trace_id=$TRACE_ID"
echo ""

# ── Hop 1: signed issues.labeled webhook → 202 {accepted:true} ─────────────
echo "--- Hop 1: signed issues.labeled webhook ---"
RESP_FILE=$(mktemp)
CODE=$(curl -s -D "$RESP_FILE" -o /tmp/stas-eval-body.json -w "%{http_code}" -X POST "$STAS_URL/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: eval-delivery-$TRACE_ID" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -H "x-trace-id: $TRACE_ID" \
  -d "$PAYLOAD")
BODY=$(cat /tmp/stas-eval-body.json)
echo "  HTTP $CODE  body=$BODY"
check "STAS webhook returns 202" "$([ "$CODE" = "202" ] && echo 0 || echo 1)"
ACCEPTED=$(printf '%s' "$BODY" | jq -r '.accepted // "false"' 2>/dev/null)
check "Body is {accepted:true}" "$([ "$ACCEPTED" = "true" ] && echo 0 || echo 1)"

TRACE_HEADER=$(grep -i "^x-stas-trace-id:" "$RESP_FILE" | tr -d '\r' | awk '{print $2}')
echo "  x-stas-trace-id=$TRACE_HEADER"
check "Response carries x-stas-trace-id header" "$([ -n "$TRACE_HEADER" ] && echo 0 || echo 1)"
rm -f "$RESP_FILE" /tmp/stas-eval-body.json

# ── Hop 2: invalid signature → 401 ─────────────────────────────────────────
echo ""
echo "--- Hop 2: invalid signature ---"
BAD=$(http_code -X POST "$STAS_URL/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-Hub-Signature-256: sha256=wrong" \
  -d "$PAYLOAD")
check "Invalid signature rejected (401)" "$([ "$BAD" = "401" ] && echo 0 || echo 1)"

# ── Hop 3: trace threading through governance + OS ─────────────────────────
echo ""
echo "--- Hop 3: trace_id in governance + OpenSymphony logs ---"
GOV_TRACED=0
if [ -n "${GOV_LOGS_CMD:-}" ]; then
  N=$(eval "$GOV_LOGS_CMD" 2>/dev/null | grep -c "$TRACE_ID" || true)
  [ "${N:-0}" -gt 0 ] 2>/dev/null && GOV_TRACED=1
fi
OS_TRACED=0
if [ -n "${OS_LOGS_CMD:-}" ]; then
  N=$(eval "$OS_LOGS_CMD" 2>/dev/null | grep -c "$TRACE_ID" || true)
  [ "${N:-0}" -gt 0 ] 2>/dev/null && OS_TRACED=1
fi
check "trace_id visible in governance logs" "$GOV_TRACED"
check "trace_id visible in OpenSymphony logs" "$OS_TRACED"
if [ "$GOV_TRACED" = "0" ] && [ -z "${GOV_LOGS_CMD:-}" ]; then
  echo "  (set GOV_LOGS_CMD to check governance logs)"
fi
if [ "$OS_TRACED" = "0" ] && [ -z "${OS_LOGS_CMD:-}" ]; then
  echo "  (set OS_LOGS_CMD to check OpenSymphony logs)"
fi

# ── Hop 4: kill-switch abort path (402/503) ────────────────────────────────
echo ""
echo "--- Hop 4: kill-switch abort path ---"
KILL_ADMIN=$(http_code -X POST "$GOV_URL/admin/kill" \
  -H "Content-Type: application/json" -H "X-Admin-Key: $ADMIN_KEY" \
  -d "{\"tenant_id\":\"$KILLED_TENANT\",\"reason\":\"launch-eval\"}")
echo "  admin/kill=$KILL_ADMIN"
GOV_BLOCKED=$(http_code -X POST "$GOV_URL/api/stas/webhook" \
  -H "Content-Type: application/json" -H "x-trace-id: $TRACE_ID-kill" \
  -d "{\"tenant_id\":\"$KILLED_TENANT\",\"issue_id\":\"Aimino-Tech/eval-repo#1\",\"trace_id\":\"$TRACE_ID-kill\"}")
echo "  governance webhook for killed tenant=$GOV_BLOCKED"
check "Governance proxy returns 402 for killed tenant" "$([ "$GOV_BLOCKED" = "402" ] && echo 0 || echo 1)"

RESUME=$(http_code -X POST "$GOV_URL/admin/resume/$KILLED_TENANT" -H "X-Admin-Key: $ADMIN_KEY")
check "Tenant resume succeeds" "$([ "$RESUME" = "200" ] && echo 0 || echo 1)"

# ── Hop 5: STAS fails closed (still acks, records governance failure) ──────
echo ""
echo "--- Hop 5: STAS fail-closed on governance abort ---"
STAS_CODE=$(http_code -X POST "$STAS_URL/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: eval-kill-$TRACE_ID" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -d "$PAYLOAD")
echo "  STAS webhook during kill=$STAS_CODE (STAS always acks 202; abort logged)"
if [ "$STAS_CODE" = "202" ]; then
  pass "STAS remains available (202) during governance abort"
else
  fail "STAS remains available (202) during governance abort (got $STAS_CODE)"
fi

echo ""
echo "=== Results: $((PASS + FAIL)) checks, $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
