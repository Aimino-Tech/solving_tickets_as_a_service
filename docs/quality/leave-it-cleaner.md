# Leave It Cleaner Gate — lsp_diagnostics + Test Suite Enforcement

## What This Is

The **Leave It Cleaner Than You Found It** gate enforces two deterministic checks
on every file touched in a PR or branch. It replaces AIM-1986 with a unified
gate that runs **before** any PR is created (blocking) and again in CI.

| Gate | Check | Tool | Kills PR? |
|------|-------|------|-----------|
| **1 — LSP Diagnostics** | TypeScript errors in touched files | `tsc --noEmit` + parser | Yes |
| **2 — Test Suite** | Tests related to touched files must pass | `vitest` | Yes |

Zero tolerance: any error in Gate 1 or failure in Gate 2 blocks the PR.

## Quick Start

```bash
# Run both gates on auto-detected changed files
npm run leave-it-cleaner

# Run LSP diagnostics only
npm run leave-it-cleaner -- --skip-tests

# Run test suite only
npm run leave-it-cleaner -- --skip-lsp

# JSON output (for CI consumption)
npm run leave-it-cleaner -- --json

# Check specific files
npm run leave-it-cleaner -- --files="src/app.ts,src/lib/api.ts"
```

## Shell Script

The `scripts/leave-it-cleaner.sh` script wraps the Python module for CI and
developer use. It supports the same flags as the Python CLI.

```bash
bash scripts/leave-it-cleaner.sh
bash scripts/leave-it-cleaner.sh --skip-lsp
bash scripts/leave-it-cleaner.sh --json
```

## Python Module

The core logic lives in `workers/quality/cleaner_gate.py`. Use it directly:

```python
from workers.quality.cleaner_gate import run_cleaner_gate

result = run_cleaner_gate()
print(f"Passed: {result.passed}")
print(f"LSP: {result.lsp}")
print(f"Tests: {result.tests}")
```

### API

#### `run_cleaner_gate(files=None, *, skip_lsp=False, skip_tests=False) -> CleanerGateResult`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `files` | `list[str] | None` | `None` | Files to check. `None` = auto-detect from git diff. |
| `skip_lsp` | `bool` | `False` | Skip the LSP diagnostics check. |
| `skip_tests` | `bool` | `False` | Skip the test suite check. |

#### `CleanerGateResult`

| Field | Type | Description |
|-------|------|-------------|
| `passed` | `bool` | True if all enabled gates pass. |
| `lsp` | `LspDiagnosticsResult | None` | LSP gate result. |
| `tests` | `TestSuiteResult | None` | Test suite gate result. |
| `touched_files` | `list[str]` | Files that were checked. |
| `duration_ms` | `float` | Total execution time. |

#### `LspDiagnosticsResult`

| Field | Type | Description |
|-------|------|-------------|
| `passed` | `bool` | True if zero errors in touched files. |
| `files_checked` | `list[str]` | TypeScript files checked. |
| `errors` | `list[FileDiagnostic]` | Errors found in touched files. |
| `warnings` | `list[FileDiagnostic]` | Warnings (non-blocking). |

#### `TestSuiteResult`

| Field | Type | Description |
|-------|------|-------------|
| `passed` | `bool` | True if all related tests pass. |
| `total_tests` | `int` | Total test count. |
| `passed_tests` | `int` | Passing test count. |
| `failed_tests` | `int` | Failing test count. |
| `related_test_files` | `list[str]` | Test files discovered for touched sources. |

## How It Works

### Gate 1 — LSP Diagnostics

1. Collects all changed files (auto-detected via `git diff --name-only` or explicit list).
2. Filters to TypeScript files (`.ts`, `.tsx`, `.mts`, `.cts`).
3. Runs `npx tsc --noEmit` on the project.
4. Parses the compiler output to extract only diagnostics that belong to the touched files.
5. **Fails** if any TypeScript error exists in a touched file.

### Gate 2 — Test Suite Enforcement

1. For each touched file, discovers related test files:
   - Co-located `*.test.ts` / `*.spec.ts` files
   - Files under `tests/` mirroring the source path
   - Files under `workers/tests/` mirroring the source path
2. Runs `npx vitest run` targeting the discovered test files.
3. Parses vitest JSON output for pass/fail counts.
4. **Fails** if any related test fails.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_BRANCH` | `origin/main` | Base branch for git diff. |
| `CLEANER_GATE_LSP_TIMEOUT` | `120000` | LSP timeout in ms. |
| `CLEANER_GATE_TEST_TIMEOUT` | `180000` | Test timeout in ms. |

## CI Integration

The gate is called from `.github/scripts/ci-gates.sh` as Gate 0 (pre-flight):

```bash
bash .github/scripts/ci-gates.sh 0
```

## Comparison with quality-gates.sh

| Aspect | `quality-gates.sh` (6 gates) | `leave-it-cleaner.sh` (2 gates) |
|--------|----------------------------|--------------------------------|
| Scope | Full repo or changed files | Only touched files |
| Focus | General quality + anti-hallucination | LSP diagnostics + test pass |
| Speed | Full tsc + knip + 4 tools | Targeted tsc + vitest on related tests |
| Use case | Before PR review | Every commit / during development |
| Blocking | Gates 1-5 block | Both gates block |

## Files

```
workers/quality/cleaner_gate.py   — Python implementation
scripts/leave-it-cleaner.sh       — Shell wrapper for CLI/CI
docs/quality/leave-it-cleaner.md  — This document
workers/tests/test_cleaner_gate.py — Unit tests
```
