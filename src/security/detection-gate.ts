/**
 * Detection Gate — pre-PR security gate that runs all scanners.
 *
 * Orchestrates the diff scanner and external secret scanners (truffleHog/gitleaks)
 * to determine whether a PR should be blocked.
 *
 * Usage:
 *   const result = await runDetectionGate('/path/to/repo', diffContent);
 *   if (!result.passed) {
 *     console.log('Blocked by:', result.blockedBy);
 *   }
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { scanDiff, hasBlockingFindings, type ScanResult } from './diff-scanner.js';
import { runAllScanners as runExternalScanners, type Finding } from './trufflehog-scanner.js';
import { trackFinding } from './tracking.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const log = rootLogger.child({ module: 'detection-gate' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GateResult {
  /** Whether the gate passed (no HIGH findings, or blocking is disabled) */
  passed: boolean;
  /** All findings from all scanners (diff scanner + external) */
  findings: Finding[];
  /** List of reasons the gate was blocked */
  blockedBy: string[];
  /** Diff scanner results (structured) */
  diffScanResults: ScanResult[];
  /** External scanner findings (raw) */
  externalFindings: Finding[];
}

// ---------------------------------------------------------------------------
// Main gate function
// ---------------------------------------------------------------------------

/**
 * Run the complete detection gate: diff scanning + external scanners.
 *
 * Steps:
 *   1. Check if detection gate is enabled in config (default: true)
 *   2. Run built-in diff scanner on the provided diff
 *   3. Run external scanners (truffleHog/gitleaks) if configured
 *   4. Track findings via analytics if configured
 *   5. Determine if gate passes based on severity and config
 *
 * @param workDir - Repository working directory (for external scanners)
 * @param diff - Git diff content to scan (optional, for built-in scanner)
 * @returns GateResult with pass/fail status and all findings
 */
export async function runDetectionGate(
  workDir: string,
  diff?: string,
): Promise<GateResult> {
  const gateConfig = config.security.detectionGate;

  if (!gateConfig.enabled) {
    log.info('Detection gate is disabled via config — skipping');
    return {
      passed: true,
      findings: [],
      blockedBy: [],
      diffScanResults: [],
      externalFindings: [],
    };
  }

  const blockedBy: string[] = [];
  const allFindings: Finding[] = [];

  // ── Step 1: Built-in diff scanner ──────────────────────────────────
  let diffScanResults: ScanResult[] = [];
  if (diff && diff.trim().length > 0) {
    log.info('Running built-in diff scanner...');
    diffScanResults = scanDiff(diff, workDir);

    for (const result of diffScanResults) {
      const finding: Finding = {
        file: result.file,
        line: result.line,
        secret: result.pattern || result.message,
        description: `[${result.severity}] ${result.type}: ${result.message}`,
        scanner: 'builtin',
        severity: result.severity,
      };
      allFindings.push(finding);

      // Track finding via analytics
      if (result.severity === 'HIGH') {
        trackFinding(finding).catch(() => {});
      }
    }

    log.info(
      { highCount: diffScanResults.filter((r) => r.severity === 'HIGH').length, total: diffScanResults.length },
      'Diff scanner completed',
    );

    // HIGH findings block PR creation
    if (gateConfig.blockOnHigh && hasBlockingFindings(diffScanResults)) {
      const highFindings = diffScanResults.filter((r) => r.severity === 'HIGH');
      for (const f of highFindings) {
        blockedBy.push(`HIGH: ${f.type} in ${f.file}:${f.line} — ${f.message}`);
      }
    }
  } else {
    log.info('No diff provided — skipping built-in diff scanner');
  }

  // ── Step 2: External scanners (truffleHog/gitleaks) ────────────────
  let externalFindings: Finding[] = [];
  if (workDir && existsSync(resolve(workDir))) {
    log.info('Running external secret scanners...');
    const scannerMode = gateConfig.scanner;
    externalFindings = await runExternalScanners(workDir, scannerMode);
    allFindings.push(...externalFindings);

    for (const finding of externalFindings) {
      if (finding.severity === 'HIGH' || finding.severity?.toUpperCase() === 'HIGH') {
        blockedBy.push(
          `HIGH: ${finding.scanner} found secret in ${finding.file}:${finding.line} — ${finding.description}`,
        );
        trackFinding(finding).catch(() => {});
      }
    }

    log.info(
      { externalCount: externalFindings.length },
      'External secret scanner completed',
    );
  } else {
    log.info({ workDir }, 'Work directory does not exist — skipping external scanners');
  }

  const passed = blockedBy.length === 0;

  if (!passed) {
    log.warn(
      { blockedBy, findingCount: allFindings.length },
      `Detection gate BLOCKED: ${blockedBy.length} blocking finding(s)`,
    );
  } else {
    log.info({ findingCount: allFindings.length }, 'Detection gate passed — no blocking findings');
  }

  return {
    passed,
    findings: allFindings,
    blockedBy,
    diffScanResults,
    externalFindings,
  };
}
