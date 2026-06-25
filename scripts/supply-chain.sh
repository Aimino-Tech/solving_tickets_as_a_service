#!/usr/bin/env bash
# =============================================================================
# STAS Supply Chain Security — Local Tooling
#
# Provides local commands for supply chain security tasks that mirror the
# CI/CD pipeline steps. Useful for developers running these checks locally
# before pushing.
#
# Usage:
#   ./scripts/supply-chain.sh sbom          Generate CycloneDX SBOM
#   ./scripts/supply-chain.sh audit-npm      Run npm audit (fail on high/critical)
#   ./scripts/supply-chain.sh audit-pip      Run pip-audit on workers deps
#   ./scripts/supply-chain.sh verify-lock    Verify package-lock.json integrity
#   ./scripts/supply-chain.sh scan-docker    Scan Docker image with grype
#   ./scripts/supply-chain.sh all            Run ALL checks sequentially
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------------------------------------------------------------------------
# 1. Generate CycloneDX SBOM
# ---------------------------------------------------------------------------
generate_sbom() {
    info "Generating CycloneDX SBOM..."

    if ! command -v npx &>/dev/null; then
        error "npx not found. Is Node.js installed?"
        return 1
    fi

    local output_dir="$PROJECT_ROOT/sbom"
    mkdir -p "$output_dir"

    # Generate SBOM using @cyclonedx/cyclonedx-npm
    npx --yes @cyclonedx/cyclonedx-npm --output-format JSON --output-file "$output_dir/sbom.cyclonedx.json"

    # Also generate a human-readable summary
    npx --yes @cyclonedx/cyclonedx-npm --output-format XML --output-file "$output_dir/sbom.cyclonedx.xml" 2>/dev/null || true

    ok "SBOM generated:"
    echo "  JSON: $output_dir/sbom.cyclonedx.json"
    echo "  XML:  $output_dir/sbom.cyclonedx.xml"
}

# ---------------------------------------------------------------------------
# 2. Run npm audit (fail on high/critical)
# ---------------------------------------------------------------------------
audit_npm() {
    info "Running npm audit (failing on high/critical vulnerabilities)..."

    cd "$PROJECT_ROOT"

    if npm audit --audit-level=high; then
        ok "npm audit passed — no high or critical vulnerabilities found"
    else
        error "npm audit FAILED — high or critical vulnerabilities detected!"
        info "Run 'npm audit fix' or 'npm audit fix --force' to address them."
        return 1
    fi
}

# ---------------------------------------------------------------------------
# 3. Run pip-audit on workers dependencies
# ---------------------------------------------------------------------------
audit_pip() {
    info "Running pip-audit on workers/requirements.txt..."

    if ! command -v pip-audit &>/dev/null; then
        warn "pip-audit not found. Installing..."
        pip install pip-audit --quiet
    fi

    cd "$PROJECT_ROOT"

    if pip-audit --requirement workers/requirements.txt --desc; then
        ok "pip-audit passed — no vulnerabilities found in Python dependencies"
    else
        error "pip-audit FAILED — vulnerabilities detected in Python dependencies!"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# 4. Verify package-lock.json integrity
# ---------------------------------------------------------------------------
verify_lock() {
    info "Verifying package-lock.json integrity..."

    cd "$PROJECT_ROOT"

    if [ ! -f "package-lock.json" ]; then
        error "package-lock.json not found!"
        return 1
    fi

    # Check 1: Verify lockfile version is v3 (npm's latest)
    local lockfile_version
    lockfile_version=$(node -e "console.log(require('./package-lock.json').lockfileVersion)" 2>/dev/null || echo "unknown")
    if [ "$lockfile_version" != "3" ]; then
        warn "package-lock.json lockfileVersion is $lockfile_version (expected 3)"
    else
        ok "Lockfile version: v$lockfile_version"
    fi

    # Check 2: Verify integrity hashes exist for all packages
    local packages_without_integrity
    packages_without_integrity=$(node -e "
        const lock = require('./package-lock.json');
        const pkgs = Object.keys(lock.packages || {});
        const missing = pkgs.filter(p => {
            const meta = lock.packages[p];
            return meta && !meta.link && !meta.dev && !meta.peer && !meta.bundled && !meta.integrity;
        });
        console.log(missing.join('\n'));
    " 2>/dev/null)

    if [ -n "$packages_without_integrity" ]; then
        warn "Packages missing integrity hashes:"
        echo "$packages_without_integrity" | head -20
        warn "Run 'npm ci' to regenerate the lockfile with integrity hashes."
    else
        ok "All packages have integrity hashes"
    fi

    # Check 3: Verify lockfile is consistent with package.json
    if npm ls --all --json &>/dev/null; then
        ok "Lockfile is consistent with package.json"
    else
        warn "Lockfile may be inconsistent with package.json — run 'npm install' to regenerate"
    fi

    ok "package-lock.json integrity checks complete"
}

# ---------------------------------------------------------------------------
# 5. Scan Docker image with grype
# ---------------------------------------------------------------------------
scan_docker() {
    local image="${1:-stas-bot:latest}"

    info "Scanning Docker image '$image' with grype..."

    if ! command -v grype &>/dev/null; then
        warn "grype not found. Trying Docker..."
        if command -v docker &>/dev/null; then
            docker run --rm \
                -v /var/run/docker.sock:/var/run/docker.sock \
                -v "$PROJECT_ROOT:/repo" \
                anchore/grype:latest \
                "$image" \
                --fail-on high \
                --only-fixed \
                -o table
            return $?
        else
            error "Neither grype nor Docker is available. Install grype: https://github.com/anchore/grype"
            return 1
        fi
    fi

    grype "$image" \
        --fail-on high \
        --only-fixed \
        -o table
}

# ---------------------------------------------------------------------------
# 6. Run all checks
# ---------------------------------------------------------------------------
run_all() {
    local exit_code=0

    echo ""
    echo "========================================================"
    echo "  STAS Supply Chain Security — Full Audit"
    echo "========================================================"
    echo ""

    generate_sbom || exit_code=$?
    echo ""

    audit_npm || exit_code=$?
    echo ""

    audit_pip || exit_code=$?
    echo ""

    verify_lock || exit_code=$?
    echo ""

    if [ "$exit_code" -eq 0 ]; then
        ok "All supply chain security checks passed!"
    else
        error "Some checks failed (exit code: $exit_code)"
    fi

    return $exit_code
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    case "${1:-help}" in
        sbom)
            generate_sbom
            ;;
        audit-npm)
            audit_npm
            ;;
        audit-pip)
            audit_pip
            ;;
        verify-lock)
            verify_lock
            ;;
        scan-docker)
            shift
            scan_docker "$@"
            ;;
        all)
            run_all
            ;;
        help|--help|-h)
            echo "STAS Supply Chain Security — Local Tooling"
            echo ""
            echo "Usage: $0 <command>"
            echo ""
            echo "Commands:"
            echo "  sbom              Generate CycloneDX SBOM"
            echo "  audit-npm         Run npm audit (fail on high/critical)"
            echo "  audit-pip         Run pip-audit on workers deps"
            echo "  verify-lock       Verify package-lock.json integrity"
            echo "  scan-docker [img]  Scan Docker image with grype (default: stas-bot:latest)"
            echo "  all               Run ALL checks sequentially"
            echo ""
            ;;
        *)
            error "Unknown command: $1"
            echo "Usage: $0 <command> (try: $0 help)"
            return 1
            ;;
    esac
}

main "$@"
