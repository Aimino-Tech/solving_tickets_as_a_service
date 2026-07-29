#!/usr/bin/env bash
# ── Publish STAS as a downloadable OpenCode skill ──────────────────────────
#
# Usage:
#   bash scripts/publish-skill.sh              # print the skill URL
#   bash scripts/publish-skill.sh --install    # write opencode.json snippet
#
# The skill file lives at skills/stas/SKILL.md and is served via raw GitHub.
# Any OpenCode/OpenClaw agent can install it with:
#
#   skill stas
#
# Or by adding the following to opencode.json:
#   "skills": {
#     "stas": {
#       "url": "https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/skills/stas/SKILL.md"
#     }
#   }

set -euo pipefail

REPO="Aimino-Tech/solving_tickets_as_a_service"
BRANCH="${1:-main}"
SKILL_FILE="skills/stas/SKILL.md"
RAW_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/${SKILL_FILE}"

echo "=== STAS OpenCode Skill ==="
echo ""
echo "Skill URL:  ${RAW_URL}"
echo ""
echo "Any OpenCode/OpenClaw agent can install by adding to opencode.json:"
echo ""
echo '  "skills": {'
echo '    "stas": {'
echo '      "description": "STAS — Solving Tickets As A Service"'
echo '      "url": "'"${RAW_URL}"'"'
echo '    }'
echo '  }'
echo ""
echo "Or via CLI: opencode skill install ${RAW_URL}"
echo ""

if [[ "${1:-}" == "--install" ]]; then
  CONFIG="${2:-opencode.json}"
  if [[ -f "$CONFIG" ]]; then
    echo "Installing skill into ${CONFIG}..."
    # Use jq if available, otherwise print manual instructions
    if command -v jq &>/dev/null; then
      jq '.skills.stas = {"description": "STAS — Solving Tickets As A Service. Submit GitHub issues and get automated fix PRs.", "url": "'"${RAW_URL}"'"}' "$CONFIG" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"
      echo "✓ Skill installed in ${CONFIG}"
    else
      echo "jq not found. Add manually to ${CONFIG}:"
      echo "  \"skills\": { \"stas\": { \"url\": \"${RAW_URL}\" } }"
    fi
  else
    echo "Config file ${CONFIG} not found. Skill URL: ${RAW_URL}"
  fi
fi
