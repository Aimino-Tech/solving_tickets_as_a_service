# SYNTARO Pre-Launch Smoke Test

## Overview

The pre-launch smoke test (`pre-launch-smoke-test.sh`) is a comprehensive bash script that validates all SYNTARO system components from a clean state. It runs 37 tests across 7 sections to ensure the repository is ready for production deployment.

## Purpose

- **Verify clean-state readiness**: Ensures the repo is in a clean, unconfigured state suitable for fresh setup
- **Validate infrastructure**: Checks Docker, Docker Compose, and container configurations
- **Confirm CI/CD pipelines**: Validates GitHub Actions workflows and secrets documentation
- **Ensure documentation completeness**: Verifies README, architecture docs, and operational guides exist
- **Check test infrastructure**: Confirms E2E tests, harness, and runner scripts are in place
- **Produce actionable output**: Each test passes, fails, warns, or skips with clear descriptions

## Usage

### Basic Run

```bash
bash scripts/pre-launch-smoke-test.sh
```

### Verbose Mode

Shows detailed output for each check:

```bash
bash scripts/pre-launch-smoke-test.sh --verbose
```

### JSON Output for CI

Produces a JSON summary report (useful for CI ingestion):

```bash
bash scripts/pre-launch-smoke-test.sh --json
```

### Help

```bash
bash scripts/pre-launch-smoke-test.sh --help
```

## Test Sections

### Section 1: Prerequisites Check (7 tests)

| # | Test | Description |
|---|------|-------------|
| 1.1 | Git repo clean | No uncommitted changes |
| 1.2 | No .env file | Clean state (no secrets present) |
| 1.3 | Docker available | Required for container builds |
| 1.4 | gh CLI available | GitHub CLI for workflow management |
| 1.5 | curl available | HTTP requests utility |
| 1.6 | jq available | JSON processing utility |
| 1.7 | .env.example exists | Environment template present |

### Section 2: Docker Build Tests (5 tests)

| # | Test | Description |
|---|------|-------------|
| 2.1 | Main Dockerfile exists | Primary build file present |
| 2.2 | Dockerfile.syntaro exists | SYNTARO-specific Dockerfile (optional) |
| 2.3 | HEALTHCHECK configured | Container health monitoring |
| 2.4 | Non-root user | Security best practice |
| 2.5 | Reproducible builds | Lockfile integrity checks |

### Section 3: Docker Compose Validation (5 tests)

| # | Test | Description |
|---|------|-------------|
| 3.1 | docker-compose.yml exists | Main compose file |
| 3.2 | Valid YAML | Parse correctly |
| 3.3 | Variant files exist | dev, e2e, prod variants |
| 3.4 | Env vars documented | .env.example covers compose vars |
| 3.5 | Healthchecks configured | Service monitoring |

### Section 4: GitHub Actions Workflow (5 tests)

| # | Test | Description |
|---|------|-------------|
| 4.1 | syntaro.yml exists | Main SYNTARO workflow |
| 4.2 | Valid YAML | Workflow parses correctly |
| 4.3 | Secrets documented | Required secrets in config files |
| 4.4 | CI workflow exists | Continuous Integration |
| 4.5 | Essential workflows | e2e-verify, release, quality, cd |

### Section 5: Scripts & Entrypoints (5 tests)

| # | Test | Description |
|---|------|-------------|
| 5.1 | entrypoint.sh exists | Container entrypoint |
| 5.2 | Healthcheck script | Health monitoring mechanism |
| 5.3 | Key scripts present | setup, doctor, quality-gates, etc. |
| 5.4 | Scripts executable | Proper file permissions |
| 5.5 | Env var validation | Doctor script checks required vars |

### Section 6: Documentation (5 tests)

| # | Test | Description |
|---|------|-------------|
| 6.1 | README.md exists | Main project documentation |
| 6.2 | AGENTS.md exists | Agent deployment guide |
| 6.3 | Architecture doc | SPEC.md or ARCHITECTURE.md |
| 6.4 | docs/ populated | Documentation directory with content |
| 6.5 | Key docs present | CHANGELOG, CONTRIBUTING, LICENSE, etc. |

### Section 7: Test Infrastructure (5 tests)

| # | Test | Description |
|---|------|-------------|
| 7.1 | tests/ directory exists | Test files present |
| 7.2 | E2E test structure | Harness and test files |
| 7.3 | Test runner config | vitest configuration |
| 7.4 | Smoke test runner | run-e2e-smoke-tests.sh |
| 7.5 | Launch readiness test | tests/launch-readiness.test.ts |

## Output Format

Each test produces one of four outputs:

- **✅ PASS**: Test passed successfully
- **❌ FAIL**: Test failed with details on what went wrong
- **⚠️ WARN**: Non-critical issue detected (test passed but has concerns)
- **⏭️ SKIP**: Test skipped due to missing dependencies (graceful degradation)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed (or only warnings/skips) |
| 1 | One or more tests failed |

## CI Integration

Use the `--json` flag for machine-readable output:

```bash
bash scripts/pre-launch-smoke-test.sh --json > smoke-test-report.json
```

The JSON report includes:
- Overall summary (total, pass, fail, warn, skip counts)
- Per-test results with status and detail messages
- Timestamp and exit code

## Requirements

- **Bash 4+** (for array support)
- **curl** (for HTTP-related checks)
- **Docker** (optional — for Compose validation)
- **jq** (optional — for JSON processing)

The script is designed to run even without all tools installed — missing tools result in SKIP or WARN rather than FAIL.

## Files

- `scripts/pre-launch-smoke-test.sh` — Main smoke test script
- `scripts/pre-launch-smoke-test-README.md` — This documentation
