# Malicious Code Detection Gate

> **AIM-2009** — Pre-PR security gate that scans agent-generated diffs for dangerous patterns.

## Overview

The Malicious Code Detection Gate is a security layer that runs before PR creation in the STAS pipeline. It scans the agent-generated diff for:

1. **Secrets & Credentials** — API keys, tokens, private keys, connection strings, passwords
2. **Dangerous Code Execution** — `os.system()`, `eval()`, `child_process.exec()`, suspicious imports
3. **Crypto Miners** — References to crypto mining libraries or suspicious network calls
4. **Obfuscated Code** — Base64-encoded payloads, hex-encoded strings, JS obfuscation
5. **Commented-out Code** — Large blocks of commented-out code (low severity)

## Architecture

```
Agent generates diff
        │
        ▼
┌─────────────────────┐
│  runDetectionGate() │
│                     │
│  ┌───────────────┐  │
│  │ Diff Scanner  │──│── Built-in pattern matching
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ truffleHog    │──│── External secret scanner
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ gitleaks      │──│── Fallback secret scanner
│  └───────────────┘  │
│         │           │
│         ▼           │
│  ┌───────────────┐  │
│  │ PostHog       │──│── Analytics tracking
│  └───────────────┘  │
└─────────────────────┘
        │
        ▼
  Pass → Create PR
  Block → Post comment with findings
```

## Components

### 1. Diff Scanner (`src/security/diff-scanner.ts`)

The core pattern detection engine. It:

- Parses unified git diff output into per-file hunks
- Scans each added/modified line against a predefined pattern list
- Returns structured `ScanResult[]` with severity, type, file, line, and message
- Deduplicates findings per (file, type, line)

**Pattern Categories:**

| Severity | Category | Examples |
|----------|----------|---------|
| HIGH | Secrets | API keys, private keys, connection strings, passwords, AWS keys, GitHub tokens, JWT tokens |
| HIGH | Code Execution | `os.system()`, `eval()`, `subprocess.call()`, `child_process.exec()` |
| HIGH | Crypto Miners | CryptoNight, CoinHive, suspicious IP URLs, `.xyz` domains |
| MEDIUM | Obfuscation | Base64 payloads, hex-encoded strings, `String.fromCharCode()` |
| LOW | Cleanliness | Commented-out code, large binary blobs |

### 2. External Secret Scanners (`src/security/trufflehog-scanner.ts`)

Integrates with industry-standard secret scanners:

- **truffleHog** (primary) — runs `trufflehog filesystem --json` on the working directory
- **gitleaks** (fallback) — runs `gitleaks detect --no-git --format json`

Both scanners handle graceful degradation:
- If the tool is not installed → log warning, return empty results
- If the tool fails → log warning, return empty results
- If the directory doesn't exist → return empty results

### 3. Detection Gate (`src/security/detection-gate.ts`)

The orchestrator that runs all scanners and determines pass/fail:

```typescript
const result = await runDetectionGate(workDir, diff);
if (!result.passed) {
  console.log('Blocked by:', result.blockedBy);
}
```

**Behavior:**
- HIGH findings → Block PR creation (configurable via `security.detectionGate.blockOnHigh`)
- LOW/MEDIUM findings → Logged but do not block
- Configurable via environment variables

### 4. Analytics Tracking (`src/security/tracking.ts`)

Sends findings to analytics infrastructure:
- **Prometheus metrics** via `bridgeMetrics` (counters and gauges)
- **PostHog** (optional, requires `POSTHOG_API_KEY` environment variable)
- All tracking is fire-and-forget — failures are logged but never thrown

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Detection Gate
SECURITY_DETECTION_GATE_ENABLED=true
SECURITY_DETECTION_GATE_BLOCK_ON_HIGH=true
SECURITY_DETECTION_GATE_SCANNER=both

# PostHog (optional, for analytics)
POSTHOG_API_KEY=phc_xxxxxxxxxxxx
POSTHOG_HOST=https://app.posthog.com
```

### Config Structure (`src/config.ts`)

```typescript
config.security.detectionGate = {
  enabled: true,     // Enable/disable the entire gate
  blockOnHigh: true, // Block PR on HIGH severity findings
  scanner: 'both',   // 'trufflehog' | 'gitleaks' | 'both'
};
```

### False Positive Suppression (`.trufflehogignore`)

The `.trufflehogignore` file at the project root contains regex patterns for common false positives:

- Test fixtures and mock data
- Placeholder tokens (`your-api-key`, `REPLACE_ME`)
- Package manager lockfiles
- Generated/minified files
- Known test tokens
- SHA hashes in lockfiles
- Common dependency URLs

Both the built-in diff scanner and external scanners respect this file.

## Integration

The detection gate is integrated into the PR creation pipeline in `src/github/actionDispatcher.ts`:

1. Before creating a PR, `runDetectionGate()` is called with the working directory and diff
2. If blocked (HIGH findings), the PR is aborted and a comment is posted to the issue
3. If passed, the PR is created normally

## Running Tests

```bash
npm test -- src/__tests__/security/diff-scanner.test.ts
```

The test suite covers:
- Detection of all pattern types (API keys, secrets, code execution, etc.)
- Severity-based blocking (HIGH blocks, LOW doesn't)
- Empty/edge case diff handling
- False positive suppression
- Diff parsing correctness

## Manual Testing

To test the scanner against a specific diff:

```bash
# Get the diff
git diff origin/main...HEAD > /tmp/my-diff.diff

# Create a quick test script
cat << 'SCRIPT' | npx tsx -
import { scanDiff } from './src/security/diff-scanner.js';
import { readFileSync } from 'fs';
const diff = readFileSync('/tmp/my-diff.diff', 'utf8');
console.log(JSON.stringify(scanDiff(diff), null, 2));
SCRIPT
```
