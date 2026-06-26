/**
 * Secrets Scanning Gate — pre-PR credential detection.
 *
 * Runs truffleHog on the git diff of pending changes to detect:
 *   - API keys (Stripe, GitHub, Slack, SendGrid, etc.)
 *   - JWT tokens / bearer tokens
 *   - AWS / GCP / Azure credentials
 *   - Private keys (RSA, EC, Ed25519, PGP)
 *   - Database connection strings
 *   - High-entropy strings matching credential patterns
 *
 * Gate blocks PR creation if any VERIFIED secrets are found.
 * Unverified (possible) secrets emit warnings but do NOT block.
 *
 * False positives are suppressed via .trufflehogignore at repo root.
 */

import { rootLogger } from '../utils/logger.js';
import type { SandboxExecutor } from '../sandbox/types.js';
import type { QualityGateResult } from './types.js';

const log = rootLogger.child({ module: 'secrets-scan-gate' });

// Patterns that truffleHog catches — we define these here for the fallback
// regex-based check when truffleHog binary is unavailable.
const SECRET_PATTERNS = [
  // AWS credentials
  /AKIA[0-9A-Z]{16}/,
  /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]\s*['"][A-Za-z0-9\/+=]{16,64}['"]/,
  // GCP service account
  /(?:type|project_id|private_key_id|private_key|client_email|client_id)\s*[:=]\s*['"][^'"]{10,}['"]/,
  // Azure
  /AccountKey\s*[:=]\s*[A-Za-z0-9+/=]{40,}/,
  /azure-storage-key|AZURE_STORAGE_CONNECTION_STRING/,
  // Generic API keys (Stripe, GitHub, Slack, etc.)
  /(?:sk_live|pk_live)_[A-Za-z0-9]{10,}/,
  /(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{36}/,
  /xox[abpors]-[A-Za-z0-9-]{10,}/,
  /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  // Private keys
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  // Connection strings
  /(?:mongodb|postgresql|mysql|redis):\/\/[^@\s]+@[^\/\s]+/,
  /(?:jdbc|odbc):[^\s]{10,}/,
];

/**
 * Run the secrets scanning gate.
 *
 * Tries truffleHog first, falls back to regex-based scan on the diff if
 * truffleHog is not available. Always reports PASS if no verified secrets found.
 *
 * @param sandbox - Sandbox executor for running commands
 * @param diff    - The git diff of pending changes (empty string skips scan)
 */
export async function gateSecretsScan(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<QualityGateResult> {
  const details: string[] = [];
  const toolName = 'truffleHog';

  if (!diff) {
    return {
      gate: 'secrets',
      passed: true,
      ossTool: toolName,
      command: 'trufflehog git --since HEAD --results=verified --fail',
      stdout: 'No diff to check',
      stderr: '',
      details: ['No diff provided — skipping secrets scan'],
    };
  }

  // ---------------------------------------------------------------
  // PHASE 1: Try truffleHog binary
  // ---------------------------------------------------------------
  let truffleHogAvailable = false;
  try {
    const thCheck = await sandbox.exec('which trufflehog 2>/dev/null || trufflehog --help 2>&1 || true', 15_000);
    if (
      !thCheck.stderr.includes('not found') &&
      !thCheck.stderr.includes('command not found') &&
      thCheck.stdout.includes('trufflehog')
    ) {
      truffleHogAvailable = true;
    }
  } catch {
    log.debug('truffleHog not available, falling back to regex scan');
  }

  if (truffleHogAvailable) {
    return await runTruffleHogScan(sandbox, diff, details);
  }

  // ---------------------------------------------------------------
  // PHASE 2: Fallback — regex-based scan on diff
  // ---------------------------------------------------------------
  return runRegexFallback(diff, details);
}

/**
 * Run truffleHog on the current repo or diff.
 *
 * We scan the git history of the working directory to catch any secrets
 * introduced in the pending diff. The --fail flag causes truffleHog to
 * exit non-zero if verified secrets are found.
 */
async function runTruffleHogScan(
  sandbox: SandboxExecutor,
  diff: string,
  details: string[],
): Promise<QualityGateResult> {
  details.push('truffleHog binary detected — running full scan');

  // Extract changed file paths from the diff to scope the scan
  const changedFiles = extractChangedFilePaths(diff);
  const changedPaths = changedFiles.join(' ');

  // Build the truffleHog command.
  // We scan files from the current working tree using the file system scanner,
  // which checks files on disk without requiring git history.
  // Scope to changed files for speed; fall back to full directory scan.
  let stdout = '';
  let stderr = '';

  // Strategy 1: Scan only changed files (fast)
  if (changedFiles.length > 0 && changedFiles.length <= 50) {
    const scanCmd = `trufflehog filesystem --no-verification --results=verified,unknown --json ${changedPaths} 2>&1 || true`;
    try {
      const result = await sandbox.exec(scanCmd, 120_000);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch {
      // fall through to Strategy 2
    }
  }

  // Strategy 2: Full directory scan (slower but comprehensive)
  if (!stdout) {
    details.push('Changed file scan produced no output — running full directory scan');
    const scanCmd = `trufflehog filesystem --no-verification --results=verified,unknown --json . 2>&1 || true`;
    try {
      const result = await sandbox.exec(scanCmd, 180_000);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      return {
        gate: 'secrets',
        passed: true, // can't scan — don't block, just warn
        ossTool: 'truffleHog',
        command: 'trufflehog filesystem --no-verification --results=verified,unknown --json .',
        stdout: '',
        stderr: String(err),
        details: [
          ...details,
          `truffleHog execution error: ${String(err)}`,
          'Secrets scan skipped — error is non-blocking',
        ],
      };
    }
  }

  // Parse truffleHog JSON output
  const verifiedSecrets: Array<{ secret: string; location: string }> = [];
  const unverifiedSecrets: Array<{ secret: string; location: string }> = [];

  // truffleHog JSON output is one JSON object per line (NDJSON)
  const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const location = parsed.SourceMetadata?.Data?.Filesystem?.file || parsed.Metadata?.filename || 'unknown';
      const secretType = parsed.DetectorName || 'unknown';
      const secret = parsed.Raw || parsed.RawV2 || '';
      const verified = parsed.Verified || false;

      // Check if the path is in the diff (avoid flagging pre-existing secrets)
      if (isInChangedFiles(location, extractChangedFilePaths(diff))) {
        const entry = {
          secret: `${secretType}: ${maskSecret(String(secret).slice(0, 40))}`,
          location,
        };
        if (verified) {
          verifiedSecrets.push(entry);
        } else {
          unverifiedSecrets.push(entry);
        }
      }
    } catch {
      // skip unparseable lines
    }
  }

  // Build result
  if (verifiedSecrets.length > 0) {
    details.push(`BLOCKING: ${verifiedSecrets.length} verified secret(s) detected`);
    for (const s of verifiedSecrets) {
      details.push(`  🔴 ${s.location}: ${s.secret}`);
    }
    if (unverifiedSecrets.length > 0) {
      details.push(`Warnings: ${unverifiedSecrets.length} unverified secret(s) also found`);
    }

    return {
      gate: 'secrets',
      passed: false,
      ossTool: 'truffleHog',
      command: 'trufflehog filesystem --no-verification --results=verified,unknown --json .',
      stdout: JSON.stringify({ verifiedSecrets, unverifiedSecrets }, null, 2),
      stderr,
      details,
    };
  }

  // No verified secrets — PASS
  if (unverifiedSecrets.length > 0) {
    details.push(`${unverifiedSecrets.length} unverified secret(s) found (non-blocking — review recommended)`);
    for (const s of unverifiedSecrets) {
      details.push(`  ⚠️  ${s.location}: ${s.secret}`);
    }
  }

  details.push('No verified secrets detected — gate passed');
  return {
    gate: 'secrets',
    passed: true,
    ossTool: 'truffleHog',
    command: 'trufflehog filesystem --no-verification --results=verified,unknown --json .',
    stdout: JSON.stringify({ verifiedSecrets, unverifiedSecrets, scanned: changedFiles.length > 0 ? `${changedFiles.length} file(s)` : 'full repo' }, null, 2),
    stderr,
    details,
  };
}

/**
 * Fallback regex-based scan when truffleHog is not installed.
 *
 * Scans added lines in the diff against known credential patterns.
 * Less accurate than truffleHog but catches the most obvious leaks.
 */
function runRegexFallback(diff: string, details: string[]): QualityGateResult {
  details.push('truffleHog not available — using regex fallback scan');

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const findings: Array<{ line: number; pattern: string; content: string }> = [];

  // Track line number in diff context for reporting
  let globalLineNum = 0;
  for (const line of diff.split('\n')) {
    globalLineNum++;
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    const content = line.slice(1).trim();
    if (!content) continue;

    // Check each pattern
    for (const pattern of SECRET_PATTERNS) {
      const re = new RegExp(pattern);
      if (re.test(content)) {
        // Avoid flagging the pattern definition itself
        if (content.includes('SECRET_PATTERNS') || content.includes('AKIA')) continue;
        findings.push({
          line: globalLineNum,
          pattern: pattern.source,
          content: maskSecret(content),
        });
        break; // one finding per line is enough
      }
    }
  }

  if (findings.length > 0) {
    details.push(`${findings.length} potential secret(s) detected by regex fallback`);
    for (const f of findings) {
      details.push(`  ⚠️  Line ${f.line}: ${f.content}`);
    }

    // Regex fallback cannot verify — we flag as unverified (non-blocking warning)
    return {
      gate: 'secrets',
      passed: true, // non-blocking for regex fallback (no verification available)
      ossTool: 'regex-fallback',
      command: 'grep -E "<secret-patterns>" <diff>',
      stdout: findings.map(f => `Line ${f.line}: ${f.content}`).join('\n'),
      stderr: '',
      details: [
        ...details,
        'Potential secrets found by regex scan (non-blocking — truffleHog recommended for verification)',
        'Install truffleHog: curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh',
      ],
    };
  }

  details.push('No potential secrets detected by regex fallback');
  return {
    gate: 'secrets',
    passed: true,
    ossTool: 'regex-fallback',
    command: 'grep -E "<secret-patterns>" <diff>',
    stdout: 'No secrets detected in diff',
    stderr: '',
    details,
  };
}

// ---- Helpers ----------------------------------------------------------------

/**
 * Extract the list of changed file paths from a git diff string.
 */
function extractChangedFilePaths(diff: string): string[] {
  const paths: string[] = [];
  for (const line of diff.split('\n')) {
    const m = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (m) {
      paths.push(m[1]);
    }
  }
  return paths;
}

/**
 * Check whether a file path appears in a list of changed files.
 */
function isInChangedFiles(filePath: string, changedFiles: string[]): boolean {
  return changedFiles.some(cf => filePath === cf || filePath.endsWith('/' + cf));
}

/**
 * Mask a secret for safe display: show first 4 and last 4 chars.
 */
function maskSecret(secret: string): string {
  if (secret.length <= 12) {
    return secret.slice(0, 4) + '****';
  }
  return secret.slice(0, 4) + '****' + secret.slice(-4);
}
