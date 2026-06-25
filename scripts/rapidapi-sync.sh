#!/usr/bin/env bash
# =============================================================================
# RapidAPI OpenAPI Spec Sync
#
# Uploads the OpenAPI 3.1 specification to RapidAPI so it appears in the
# RapidAPI Marketplace documentation. The provider must already be registered
# on RapidAPI.
#
# Usage:
#   export RAPIDAPI_PROVIDER_KEY="your-provider-key"
#   bash scripts/rapidapi-sync.sh
#
# Requirements:
#   - RAPIDAPI_PROVIDER_KEY environment variable must be set
#   - curl must be installed
#   - openapi.yaml must exist at the project root
# =============================================================================

set -euo pipefail

# -------------------------------------------------------------------------
# Pre-flight checks
# -------------------------------------------------------------------------

if [[ -z "${RAPIDAPI_PROVIDER_KEY:-}" ]]; then
  echo "ERROR: RAPIDAPI_PROVIDER_KEY environment variable is not set." >&2
  echo "" >&2
  echo "Set it before running this script:" >&2
  echo "  export RAPIDAPI_PROVIDER_KEY=\"your-provider-key\"" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SPEC_PATH="${PROJECT_ROOT}/openapi.yaml"

if [[ ! -f "${SPEC_PATH}" ]]; then
  echo "ERROR: openapi.yaml not found at ${SPEC_PATH}" >&2
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is not installed." >&2
  exit 1
fi

# -------------------------------------------------------------------------
# Upload to RapidAPI
# -------------------------------------------------------------------------

echo "Uploading OpenAPI spec to RapidAPI..."
echo "  Provider key: ${RAPIDAPI_PROVIDER_KEY:0:8}..."
echo "  Spec file:    ${SPEC_PATH}"
echo ""

curl -X PUT \
  "https://rapidapi.com/api/v1/providers/${RAPIDAPI_PROVIDER_KEY}/spec" \
  -H "Content-Type: application/yaml" \
  --data-binary @"${SPEC_PATH}"

echo ""
echo "Done. OpenAPI spec uploaded to RapidAPI."
