/**
 * TruffleHog/Gitleaks scanner — runs external secret scanners and parses output.
 *
 * Provides a unified interface for running both truffleHog and gitleaks.
 * If neither tool is installed, returns empty results with a warning.
 *
 * Usage:
 *   const findings = await runTruffleHog('/path/to/repo');
 *   const gitleaksFindings = await runGitleaks('/path/to/repo');
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { rootLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const log = rootLogger.child({ module: 'trufflehog-scanner' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  /** File path relative to repo root */
  file: string;
  /** Line number (1-based), or 0 if unknown */
  line: number;
  /** The secret/pattern that was matched */
  secret: string;
  /** Human-readable description */
  description: string;
  /** Source scanner that found this (trufflehog, gitleaks, or builtin) */
  scanner: string;
  /** Severity if available */
  severity?: string;
  /** Commit hash if available */
  commit?: string;
  /** Branch if available */
  branch?: string;
  /** Date if available */
  date?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a binary is available on PATH.
 */
async function isBinaryAvailable(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// truffleHog Scanner
// ---------------------------------------------------------------------------

/**
 * Run truffleHog v3+ on a directory and parse the JSON output.
 *
 * Supports both truffleHog v3 (which outputs JSON lines) and v2 (single JSON array).
 * Returns empty array if truffleHog is not installed.
 */
export async function runTruffleHog(workDir: string): Promise<Finding[]> {
  if (!existsSync(workDir)) {
    log.warn({ workDir }, 'Directory does not exist, skipping truffleHog scan');
    return [];
  }

  const available = await isBinaryAvailable('trufflehog');
  if (!available) {
    log.warn('trufflehog not found on PATH — skipping truffleHog scan');
    return [];
  }

  try {
    log.info({ workDir }, 'Running truffleHog scan...');

    const { stdout } = await execFileAsync(
      'trufflehog',
      ['filesystem', '--json', '--no-verification', workDir],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const findings: Finding[] = [];
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const sourceMetadata = parsed.SourceMetadata as Record<string, unknown> | undefined;
        const data = sourceMetadata?.Data as Record<string, unknown> | undefined;
        const filesystem = data?.Filesystem as Record<string, unknown> | undefined;

        findings.push({
          file: String(filesystem?.file || parsed?.file || 'unknown'),
          line: Number(filesystem?.line || parsed?.line || 0),
          secret: String(parsed.Raw || parsed?.raw || ''),
          description: String(parsed.DetectorDescription || parsed?.description || parsed.DetectorName || 'Unknown secret'),
          scanner: 'trufflehog',
          severity: String(parsed?.severity || 'MEDIUM'),
          commit: String(filesystem?.commit || parsed?.commit || ''),
          branch: String(parsed?.branch || ''),
          date: String(parsed?.date || ''),
        });
      } catch {
        // Skip malformed JSON lines
      }
    }

    log.info({ findingCount: findings.length }, 'truffleHog scan completed');
    return findings;
  } catch (err) {
    log.warn({ err: String(err), workDir }, 'truffleHog scan failed (non-fatal)');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Gitleaks Scanner (fallback)
// ---------------------------------------------------------------------------

/**
 * Run gitleaks on a directory and parse the JSON output.
 *
 * Returns empty array if gitleaks is not installed.
 */
export async function runGitleaks(workDir: string): Promise<Finding[]> {
  if (!existsSync(workDir)) {
    log.warn({ workDir }, 'Directory does not exist, skipping gitleaks scan');
    return [];
  }

  const available = await isBinaryAvailable('gitleaks');
  if (!available) {
    log.warn('gitleaks not found on PATH — skipping gitleaks scan');
    return [];
  }

  try {
    log.info({ workDir }, 'Running gitleaks scan...');

    const { stdout } = await execFileAsync(
      'gitleaks',
      ['detect', '--source', workDir, '--no-git', '--format', 'json', '-v'],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const parsed = JSON.parse(stdout) as Record<string, unknown>[];
    const findings: Finding[] = (Array.isArray(parsed) ? parsed : []).map((item) => ({
      file: String(item.file || item.File || 'unknown'),
      line: Number(item.startLine || item.line || 0),
      secret: String(item.secret || item.Secret || ''),
      description: String(item.description || item.Description || item.rule || 'Unknown secret'),
      scanner: 'gitleaks',
      severity: String(item.severity || item.Severity || 'MEDIUM'),
      commit: String(item.commit || item.Commit || ''),
      branch: String(item.branch || ''), // gitleaks doesn't always include branch
      date: String(item.date || item.Date || ''),
    }));

    log.info({ findingCount: findings.length }, 'gitleaks scan completed');
    return findings;
  } catch (err) {
    log.warn({ err: String(err), workDir }, 'gitleaks scan failed (non-fatal)');
    return [];
  }
}

/**
 * Run both scanners and return all findings combined.
 * Runs truffleHog first, falls back to gitleaks.
 * If both are configured, runs both and deduplicates.
 */
export async function runAllScanners(
  workDir: string,
  mode: 'trufflehog' | 'gitleaks' | 'both' = 'both',
): Promise<Finding[]> {
  const findings: Finding[] = [];

  if (mode === 'trufflehog' || mode === 'both') {
    const trufflehogFindings = await runTruffleHog(workDir);
    findings.push(...trufflehogFindings);
  }

  if (mode === 'gitleaks' || mode === 'both') {
    const gitleaksFindings = await runGitleaks(workDir);
    findings.push(...gitleaksFindings);
  }

  // Deduplicate by file:line:secret fingerprint
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.secret.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
