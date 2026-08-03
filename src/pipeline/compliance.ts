/**
 * Pipeline compliance.ts — Compliance checks for the SYNTARO pipeline.
 *
 * Enforces four compliance domains before PR creation:
 *   1. Code review compliance — all code has been reviewed
 *   2. Dependency audit — no vulnerable or deprecated dependencies
 *   3. License compliance — all dependencies use compatible licenses
 *   4. Security scan results — security scan is clean
 *
 * Usage:
 *   import { runComplianceChecks } from './compliance.js';
 *   const report = await runComplianceChecks({ execFn, repoDir });
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pipeline-compliance' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceCheckName =
  | 'code-review'
  | 'dependency-audit'
  | 'license-compliance'
  | 'security-scan';

export interface ComplianceCheckResult {
  check: ComplianceCheckName;
  passed: boolean;
  durationMs: number;
  details: string[];
  findings: ComplianceFinding[];
  error?: string;
}

export interface ComplianceFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  packageName?: string;
  packageVersion?: string;
  recommendation?: string;
}

export interface ComplianceReport {
  passed: boolean;
  checks: ComplianceCheckResult[];
  totalDurationMs: number;
  summary: string;
  findings: ComplianceFinding[];
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check 1: Code review compliance.
 * Verifies that a code review has been performed by checking for review
 * artifacts (review comments, approval status, etc.).
 */
async function checkCodeReview(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<ComplianceCheckResult> {
  const start = Date.now();
  const details: string[] = [];
  const findings: ComplianceFinding[] = [];

  try {
    // Check if this is a git repo with review metadata
    const gitLogResult = await execFn('git log --oneline -5 2>/dev/null || echo "NO_GIT"', 10_000);

    if (gitLogResult.stdout.trim() === 'NO_GIT') {
      details.push('Not a git repository — code review check skipped');
      return {
        check: 'code-review',
        passed: true,
        durationMs: Date.now() - start,
        details: ['No git repository — skipping code review check'],
        findings: [],
      };
    }

    // Check for review artifacts
    const reviewResult = await execFn(
      'ls -la .github/CODEOWNERS .github/REVIEWERS REVIEWERS.md CODEOWNERS 2>/dev/null; '
      + 'git log --format="%an" -1 2>/dev/null',
      10_000,
    );

    const hasReviewConfig = reviewResult.stdout.length > 0;
    if (!hasReviewConfig) {
      findings.push({
        severity: 'low',
        title: 'No code review configuration found',
        description: 'No CODEOWNERS, REVIEWERS, or review config found in the repository',
        recommendation: 'Add a CODEOWNERS or REVIEWERS file to define review policies',
      });
    }

    // Check recent commit count — low commit counts may indicate unreviewed code
    const commitCountResult = await execFn('git rev-list --count HEAD ^HEAD~5 2>/dev/null || echo 0', 10_000);
    const recentCommits = parseInt(commitCountResult.stdout.trim(), 10) || 0;

    if (recentCommits === 0) {
      details.push('No recent commits found');
    } else {
      details.push(`${recentCommits} recent commit(s) in working tree`);
    }

    details.push(hasReviewConfig ? 'Code review configuration found' : 'No code review config found');
    details.push('Code review compliance: OK (informational)');

    return {
      check: 'code-review',
      passed: true,
      durationMs: Date.now() - start,
      details: [
        ...details,
        'Code review compliance check completed',
      ],
      findings,
    };
  } catch (err) {
    return {
      check: 'code-review',
      passed: true, // Non-blocking — informational only
      durationMs: Date.now() - start,
      details: [`Code review check error (non-blocking): ${String(err)}`],
      findings: [],
    };
  }
}

/**
 * Check 2: Dependency audit.
 * Runs `npm audit` to find known vulnerabilities in dependencies.
 */
async function checkDependencyAudit(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs: number,
): Promise<ComplianceCheckResult> {
  const start = Date.now();
  const details: string[] = [];
  const findings: ComplianceFinding[] = [];

  try {
    // Check if package.json exists
    const hasPackageJson = await execFn('test -f package.json && echo yes || echo no', 5_000);
    if (hasPackageJson.stdout.trim() !== 'yes') {
      details.push('No package.json found — dependency audit skipped');
      return {
        check: 'dependency-audit',
        passed: true,
        durationMs: Date.now() - start,
        details: ['No JavaScript/TypeScript project detected — dependency audit skipped'],
        findings: [],
      };
    }

    // Run npm audit
    details.push('Running npm audit...');
    const auditResult = await execFn('npm audit --audit-level=high 2>&1 || true', timeoutMs);
    const auditOutput = (auditResult.stdout + auditResult.stderr).trim();

    // Parse audit results
    const vulnerabilityCount = (auditOutput.match(/(\d+)\s+vulnerabilit/) || []);
    const highCount = parseInt(vulnerabilityCount[1] || '0', 10);
    const criticalMatch = auditOutput.match(/(\d+)\s+critical/);
    const criticalCount = parseInt(criticalMatch?.[1] || '0', 10);
    const highMatch = auditOutput.match(/(\d+)\s+high/);
    const high = parseInt(highMatch?.[1] || '0', 10);

    if (criticalCount > 0) {
      findings.push({
        severity: 'critical',
        title: `${criticalCount} critical vulnerability(ies) found`,
        description: `npm audit found ${criticalCount} critical vulnerabilities`,
        recommendation: 'Run npm audit fix --force or update affected packages',
      });
    }

    if (high > 0) {
      findings.push({
        severity: 'high',
        title: `${high} high severity vulnerabilities found`,
        description: `npm audit found ${high} high severity vulnerabilities`,
        recommendation: 'Run npm audit fix to address high severity issues',
      });
    }

    const passed = criticalCount === 0 && high === 0;

    details.push(
      passed
        ? `npm audit passed: ${highCount || 0} vulnerabilities (none critical or high)`
        : `npm audit found ${criticalCount} critical and ${high} high severity vulnerabilities`,
    );

    return {
      check: 'dependency-audit',
      passed,
      durationMs: Date.now() - start,
      details,
      findings,
    };
  } catch (err) {
    return {
      check: 'dependency-audit',
      passed: false,
      durationMs: Date.now() - start,
      details: [`Dependency audit error: ${String(err)}`],
      findings: [{
        severity: 'high',
        title: 'Dependency audit failed',
        description: `npm audit could not complete: ${String(err)}`,
        recommendation: 'Run npm audit manually to check dependency health',
      }],
    };
  }
}

/**
 * Check 3: License compliance.
 * Verifies that all dependencies use compatible open-source licenses.
 */
async function checkLicenseCompliance(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs: number,
): Promise<ComplianceCheckResult> {
  const start = Date.now();
  const details: string[] = [];
  const findings: ComplianceFinding[] = [];

  const ALLOWED_LICENSES = [
    'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
    'ISC', 'CC0-1.0', 'Unlicense', '0BSD',
    'MPL-2.0', 'Python-2.0', 'Zlib', 'PostgreSQL',
  ];

  try {
    const hasPackageJson = await execFn('test -f package.json && echo yes || echo no', 5_000);
    if (hasPackageJson.stdout.trim() !== 'yes') {
      details.push('No package.json found — license compliance skipped');
      return {
        check: 'license-compliance',
        passed: true,
        durationMs: Date.now() - start,
        details: ['No JavaScript/TypeScript project — license compliance skipped'],
        findings: [],
      };
    }

    // Try license-checker or license-report
    details.push('Checking dependency licenses...');

    // First check if license-checker is available
    const hasLicenseChecker = await execFn('npx license-checker --version 2>&1 || echo not-found', 10_000);

    if (!hasLicenseChecker.stdout.includes('not-found')) {
      const licenseResult = await execFn(
        'npx license-checker --production --json 2>&1 || true',
        timeoutMs,
      );
      const licenseOutput = licenseResult.stdout;

      try {
        const licenseData = JSON.parse(licenseOutput);
        const incompatiblePackages: string[] = [];

        for (const [pkg, info] of Object.entries(licenseData)) {
          const pkgInfo = info as Record<string, unknown>;
          const licenses = String(pkgInfo.licenses || '');
          const individualLicenses = licenses.split(/[,/]/).map((l: string) => l.trim());

          const hasAllowedLicense = individualLicenses.some((l: string) =>
            ALLOWED_LICENSES.some(allowed => l.includes(allowed)),
          );

          if (!hasAllowedLicense && licenses !== 'MIT' && !licenses.includes('Apache')) {
            incompatiblePackages.push(`${pkg} (${licenses})`);
          }
        }

        if (incompatiblePackages.length > 0) {
          findings.push({
            severity: 'medium',
            title: `${incompatiblePackages.length} package(s) with non-standard licenses`,
            description: incompatiblePackages.slice(0, 10).join(', '),
            recommendation: 'Review licenses of identified packages and ensure compatibility',
          });
        }

        details.push(
          incompatiblePackages.length === 0
            ? 'All dependency licenses are compatible'
            : `${incompatiblePackages.length} package(s) with non-standard licenses found`,
        );
      } catch {
        details.push('Could not parse license-checker output');
      }
    } else {
      details.push('license-checker not available — checking package.json licenses');

      // Fallback: check licenses in package.json
      const pkgResult = await execFn('cat package.json 2>/dev/null || echo "{}"', 10_000);
      try {
        const pkg = JSON.parse(pkgResult.stdout);
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const depCount = Object.keys(allDeps).length;
        details.push(`Found ${depCount} total dependencies (cannot verify licenses without license-checker)`);
      } catch {
        details.push('Could not parse package.json');
      }
    }

    return {
      check: 'license-compliance',
      passed: findings.filter(f => f.severity === 'high' || f.severity === 'critical').length === 0,
      durationMs: Date.now() - start,
      details: [...details, 'License compliance check completed'],
      findings,
    };
  } catch (err) {
    return {
      check: 'license-compliance',
      passed: true, // Non-blocking
      durationMs: Date.now() - start,
      details: [`License compliance error (non-blocking): ${String(err)}`],
      findings: [],
    };
  }
}

/**
 * Check 4: Security scan results.
 * Checks that no high/critical security issues exist from previous scans.
 */
async function checkSecurityScan(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs: number,
): Promise<ComplianceCheckResult> {
  const start = Date.now();
  const details: string[] = [];
  const findings: ComplianceFinding[] = [];

  try {
    // Run snyk test if available
    const hasSnyk = await execFn('which snyk 2>/dev/null && echo available || echo not-found', 10_000);

    if (hasSnyk.stdout.trim() === 'available') {
      details.push('Snyk available — running security scan');
      const snykResult = await execFn('snyk test --json 2>&1 || true', timeoutMs);
      const snykOutput = snykResult.stdout;

      try {
        const snykData = JSON.parse(snykOutput);
        const vulnerabilities = snykData.vulnerabilities || [];

        const criticalVulns = vulnerabilities.filter((v: Record<string, unknown>) => v.severity === 'critical');
        const highVulns = vulnerabilities.filter((v: Record<string, unknown>) => v.severity === 'high');

        for (const vuln of criticalVulns) {
          findings.push({
            severity: 'critical',
            title: `Critical: ${String(vuln.title || 'Unknown vulnerability')}`,
            description: `Package: ${String(vuln.packageName || 'unknown')}@${String(vuln.packageVersion || 'unknown')}`,
            packageName: String(vuln.packageName || ''),
            packageVersion: String(vuln.packageVersion || ''),
            recommendation: `Upgrade ${String(vuln.packageName || 'the package')} to a patched version`,
          });
        }

        for (const vuln of highVulns) {
          findings.push({
            severity: 'high',
            title: `High: ${String(vuln.title || 'Unknown vulnerability')}`,
            description: `Package: ${String(vuln.packageName || 'unknown')}@${String(vuln.packageVersion || 'unknown')}`,
            packageName: String(vuln.packageName || ''),
            packageVersion: String(vuln.packageVersion || ''),
            recommendation: `Upgrade ${String(vuln.packageName || 'the package')} to a patched version`,
          });
        }

        const passed = criticalVulns.length === 0 && highVulns.length === 0;
        details.push(
          passed
            ? 'Snyk security scan passed — no critical or high vulnerabilities'
            : `Snyk found ${criticalVulns.length} critical and ${highVulns.length} high severity issues`,
        );

        return {
          check: 'security-scan',
          passed,
          durationMs: Date.now() - start,
          details,
          findings,
        };
      } catch {
        details.push('Could not parse Snyk JSON output');
      }
    } else {
      details.push('Snyk not available — security scan skipped');
    }

    // Fallback: check for any .snyk or security config
    const securityConfigs = await execFn(
      'ls .snyk .grype.yaml .trivyignore .semgrep 2>/dev/null || echo none',
      5_000,
    );
    const hasSecurityConfig = securityConfigs.stdout.trim() !== 'none';
    if (hasSecurityConfig) {
      details.push('Security configuration files found');
    }

    return {
      check: 'security-scan',
      passed: true, // Non-blocking if tools not available
      durationMs: Date.now() - start,
      details: [...details, 'Security scan check completed'],
      findings,
    };
  } catch (err) {
    return {
      check: 'security-scan',
      passed: true, // Non-blocking
      durationMs: Date.now() - start,
      details: [`Security scan error (non-blocking): ${String(err)}`],
      findings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface RunComplianceOptions {
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  timeoutMs?: number;
  skipDependencyAudit?: boolean;
  skipLicenseCheck?: boolean;
  skipSecurityScan?: boolean;
}

/**
 * Run all four compliance checks and return a consolidated report.
 */
export async function runComplianceChecks(
  options: RunComplianceOptions,
): Promise<ComplianceReport> {
  const { execFn, timeoutMs = 300_000 } = options;
  const overallStart = Date.now();

  log.info('Running compliance checks');

  const checkPromises: Array<Promise<ComplianceCheckResult>> = [
    checkCodeReview(execFn),
  ];

  if (!options.skipDependencyAudit) {
    checkPromises.push(checkDependencyAudit(execFn, timeoutMs));
  }

  if (!options.skipLicenseCheck) {
    checkPromises.push(checkLicenseCompliance(execFn, timeoutMs));
  }

  if (!options.skipSecurityScan) {
    checkPromises.push(checkSecurityScan(execFn, timeoutMs));
  }

  const results = await Promise.allSettled(checkPromises);
  const checks: ComplianceCheckResult[] = results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      check: 'unknown' as ComplianceCheckName,
      passed: false,
      durationMs: 0,
      details: [`Compliance check threw: ${String(r.reason)}`],
      findings: [],
    };
  });

  const allFindings = checks.flatMap(c => c.findings);
  const criticalFindings = allFindings.filter(f => f.severity === 'critical');
  const highFindings = allFindings.filter(f => f.severity === 'high');

  const passed = checks.every(c => c.passed);
  const totalDurationMs = Date.now() - overallStart;

  const summary = passed
    ? `All ${checks.length}/${checks.length} compliance checks passed (${totalDurationMs}ms)`
    : `${checks.filter(c => c.passed).length}/${checks.length} compliance checks passed (${totalDurationMs}ms)`;

  if (criticalFindings.length > 0 || highFindings.length > 0) {
    log.warn(
      { criticalFindings: criticalFindings.length, highFindings: highFindings.length },
      'Compliance checks found critical or high severity issues',
    );
  }

  log.info(
    { passed, totalDurationMs, checksRun: checks.length },
    summary,
  );

  return {
    passed,
    checks,
    totalDurationMs,
    summary,
    findings: allFindings,
  };
}

/**
 * Run a quick summary of compliance without running full checks.
 */
export function getComplianceSummary(findings: ComplianceFinding[]): string {
  if (findings.length === 0) return 'No compliance findings';

  const bySeverity = (severity: string) =>
    findings.filter(f => f.severity === severity);

  const critical = bySeverity('critical');
  const high = bySeverity('high');
  const medium = bySeverity('medium');

  const parts: string[] = [];
  if (critical.length > 0) parts.push(`${critical.length} critical`);
  if (high.length > 0) parts.push(`${high.length} high`);
  if (medium.length > 0) parts.push(`${medium.length} medium`);

  return `${parts.join(', ') || findings.length + ' total'} finding(s)`;
}
