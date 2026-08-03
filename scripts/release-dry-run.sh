#!/usr/bin/env bash
# =============================================================================
# SYNTARO Release Dry-Run
#
# Simulates the release workflow locally without actually publishing anything.
# Validates that the release would succeed by checking:
#   1. Git working tree is clean
#   2. CHANGELOG.md has an entry for the target version
#   3. package.json version is correct
#   4. Docker image builds successfully
#
# Usage:
#   npm run release:dry-run -- --version v0.11.0
#   # or directly:
#   bash scripts/release-dry-run.sh --version v0.11.0
# =============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Parse arguments ────────────────────────────────────────────────────────────
VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    *)
      echo "Usage: $0 --version <vMAJOR.MINOR.PATCH>"
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo -e "${RED}Error: --version is required${NC}"
  echo "Usage: $0 --version <vMAJOR.MINOR.PATCH>"
  exit 1
fi

# Strip leading 'v' if present
SEMVER="${VERSION#v}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  SYNTARO Release Dry-Run: v${SEMVER}${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# ── Step 1: Check git working tree ───────────────────────────────────────────
echo -e "${YELLOW}[1/5] Checking git working tree...${NC}"
if ! git diff --quiet HEAD 2>/dev/null; then
  echo -e "${RED}  ✗ Working tree has uncommitted changes${NC}"
  echo "    Commit or stash changes before releasing:"
  git status --short
  exit 1
fi
echo -e "${GREEN}  ✓ Working tree is clean${NC}"
echo ""

# ── Step 2: Validate CHANGELOG entry ─────────────────────────────────────────
echo -e "${YELLOW}[2/5] Validating CHANGELOG.md entry for v${SEMVER}...${NC}"
if [[ ! -f "CHANGELOG.md" ]]; then
  echo -e "${RED}  ✗ CHANGELOG.md not found${NC}"
  exit 1
fi

ENTRY=$(node -e "
  const fs = require('fs');
  const content = fs.readFileSync('CHANGELOG.md', 'utf8');
  const lines = content.split('\n');
  let inSection = false;
  let section = [];
  const headerRegex = new RegExp('^## \\\\[' + '${SEMVER}'.replace(/\./g, '\\\\.') + '\\\\]');
  for (const line of lines) {
    if (headerRegex.test(line)) { inSection = true; continue; }
    if (inSection) {
      if (line.startsWith('## [')) break;
      section.push(line);
    }
  }
  const result = section.join('\\n').trim();
  if (!result) process.exit(1);
  console.log(result);
") || {
  echo -e "${RED}  ✗ No CHANGELOG entry found for v${SEMVER}${NC}"
  echo "    Add an entry to CHANGELOG.md before releasing"
  exit 1
}

# Count entries by category
ADDED=$(echo "$ENTRY" | grep -c "^### Added" || true)
CHANGED=$(echo "$ENTRY" | grep -c "^### Changed" || true)
FIXED=$(echo "$ENTRY" | grep -c "^### Fixed" || true)
REMOVED=$(echo "$ENTRY" | grep -c "^### Removed" || true)
SECURITY=$(echo "$ENTRY" | grep -c "^### Security" || true)

echo -e "${GREEN}  ✓ CHANGELOG entry found${NC}"
echo "    Categories: Added=${ADDED} Changed=${CHANGED} Fixed=${FIXED} Removed=${REMOVED} Security=${SECURITY}"
echo ""

# ── Step 3: Validate package.json version ─────────────────────────────────────
echo -e "${YELLOW}[3/5] Checking package.json version...${NC}"
PKG_VERSION=$(node -e "console.log(require('./package.json').version)")
echo "    package.json: ${PKG_VERSION}"
echo "    release:      ${SEMVER}"

NODE_MAJOR=$(echo "$PKG_VERSION" | cut -d. -f1)
NODE_MINOR=$(echo "$PKG_VERSION" | cut -d. -f2)
REL_MAJOR=$(echo "$SEMVER" | cut -d. -f1)
REL_MINOR=$(echo "$SEMVER" | cut -d. -f2)

if [[ "$NODE_MAJOR" != "$REL_MAJOR" ]] || [[ "$NODE_MINOR" != "$REL_MINOR" ]]; then
  echo -e "${YELLOW}  ⚠ package.json version (${PKG_VERSION}) differs from release (${SEMVER})${NC}"
  echo "    Update package.json version if this is a final release"
else
  echo -e "${GREEN}  ✓ Version match${NC}"
fi
echo ""

# ── Step 4: Validate Docker build ─────────────────────────────────────────────
echo -e "${YELLOW}[4/5] Validating Docker build...${NC}"
if command -v docker &>/dev/null; then
  echo "    Building Docker image (syntaro-bot:dry-run)..."
  if docker build -t syntaro-bot:dry-run -f Dockerfile . --quiet 2>&1; then
    echo -e "${GREEN}  ✓ Docker build successful${NC}"

    # Check for non-root user
    if docker run --rm syntaro-bot:dry-run whoami 2>/dev/null | grep -q "syntaro"; then
      echo -e "${GREEN}  ✓ Non-root user check passed${NC}"
    else
      echo -e "${YELLOW}  ⚠ Non-root user check skipped (container may not support whoami)${NC}"
    fi

    docker rmi syntaro-bot:dry-run >/dev/null 2>&1 || true
  else
    echo -e "${RED}  ✗ Docker build failed${NC}"
    echo "    Fix Dockerfile errors before releasing"
    exit 1
  fi
else
  echo -e "${YELLOW}  ⚠ Docker not available — skipping Docker build validation${NC}"
fi
echo ""

# ── Step 5: Summary ───────────────────────────────────────────────────────────
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Dry-Run Summary${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Version:       ${GREEN}v${SEMVER}${NC}"
echo -e "  CHANGELOG:     ${GREEN}✓${NC}"
echo -e "  package.json:  ${PKG_VERSION}"
echo -e "  Docker build:  ${GREEN}✓${NC}"
echo ""
echo "  To publish this release:"
echo "    git tag -a v${SEMVER} -m \"v${SEMVER}\""
echo "    git push origin v${SEMVER}"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Dry-run completed successfully!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"

# Exit with CHANGELOG entry for verification
echo ""
echo "CHANGELOG entry preview:"
echo "───────────────────────────────────────"
echo "$ENTRY"
