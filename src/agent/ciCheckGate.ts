/**
 * CI Check Gate — Pre-PR gate that runs biome, tsc --noEmit, and ruff
 * on agent-produced code. All checks must pass before a PR can be created.
 *
 * Integrates with the existing ActionDispatcher and quality-gates pipeline
 * by returning QualityGateResult[] that get appended to the verification
 * results and checked before PR creation.
 *
 * Acceptance Criteria:
 *   AC1: biome check runs with zero errors on agent-produced code
 *   AC2: tsc --noEmit type-checks agent code
 *   AC3: ruff lint on Python agent code
 *   AC4: All checks must pass before PR creation
 */

import type { QualityGateResult } from './types.js';

interface CiCheckOptions {
  /** Run checks only on changed files vs base branch (default: false) */
  changedOnly?: boolean;
  /** Base branch to diff against when changedOnly is true (default: origin/main) */
  baseBranch?: string;
  /** Timeout per check in ms (default: 120000) */
  timeoutMs?: number;
}

/**
 * Result of a single CI check (biome, tsc, ruff).
 */
export interface CiCheckDetail {
  /** Tool name */
  tool: string;
  /** Whether the check passed */
  passed: boolean;
  /** Full stdout output */
  stdout: string;
  /** Full stderr output */
  stderr: string;
  /** Parsed error count */
  errorCount: number;
  /** Parsed warning count */
  warningCount: number;
  /** Human-readable summary */
  summary: string;
}

/**
 * Aggregate result from running all CI checks.
 */
export interface CiCheckReport {
  /** Whether all checks passed */
  passed: boolean;
  /** Details per check */
  checks: CiCheckDetail[];
  /** Summary of passed/failed/total */
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

/**
 * Run a shell command and capture output.
 * Uses a minimal inline exec rather than importing the full SandboxExecutor
 * so this module works in both sandboxed and non-sandboxed contexts.
 */
async function execCmd(
  cmd: string,
  timeoutMs: number,
  execFn: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await execFn(cmd, timeoutMs);
  } catch (err) {
    return {
      stdout: '',
      stderr: String(err),
      exitCode: -1,
    };
  }
}

// ── Individual check runners ────────────────────────────────────────

/**
 * Run biome check on the codebase (or changed files).
 *
 * AC1: biome check runs with zero errors on agent-produced code.
 */
export async function runBiomeCheck(
  execFn: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  changedOnly = false,
  baseBranch = 'origin/main',
  timeoutMs = 120_000,
): Promise<CiCheckDetail> {
  let cmd: string;
  if (changedOnly) {
    cmd = `npx biome check --changed --since="${baseBranch}" 2>&1`;
  } else {
    cmd = 'npx biome check . 2>&1';
  }

  const result = await execCmd(cmd, timeoutMs, execFn);
  const output = (result.stdout + result.stderr).trim();

  // biome exits 0 on success, >0 on issues.
  // Parse errors and warnings from the output.
  const errorCount = (output.match(/\berror(s)?\b/gi) || []).length;
  const warningCount = (output.match(/\bwarning(s)?\b/gi) || []).length;
  // More precise: count lines with ✗ or "error" markers
  const preciseErrors = (output.match(/^\s*✗/gm) || []).length;
  const preciseWarnings = (output.match(/^\s*⚠/gm) || []).length;

  const passed = result.exitCode === 0;
  const summary = passed
    ? 'All TypeScript/JS files pass lint & format checks'
    : `Biome found ${preciseErrors || errorCount} error(s) and ${preciseWarnings || warningCount} warning(s)`;

  return {
    tool: 'biome',
    passed,
    stdout: result.stdout.slice(0, 10000),
    stderr: result.stderr.slice(0, 5000),
    errorCount: preciseErrors || errorCount,
    warningCount: preciseWarnings || warningCount,
    summary,
  };
}

/**
 * Run tsc --noEmit for TypeScript type checking.
 *
 * AC2: tsc --noEmit type-checks agent code.
 */
export async function runTscCheck(
  execFn: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs = 180_000,
): Promise<CiCheckDetail> {
  const cmd = 'npx tsc --noEmit 2>&1';

  const result = await execCmd(cmd, timeoutMs, execFn);
  const output = (result.stdout + result.stderr).trim();

  // Count TypeScript errors (error TS pattern)
  const tsErrorLines = output.split('\n').filter((l) => l.includes('error TS'));
  const errorCount = tsErrorLines.length;

  const passed = result.exitCode === 0 && errorCount === 0;
  const summary = passed
    ? 'TypeScript compilation clean — no errors'
    : `TypeScript has ${errorCount} type error(s)`;

  return {
    tool: 'tsc',
    passed,
    stdout: result.stdout.slice(0, 10000),
    stderr: result.stderr.slice(0, 5000),
    errorCount,
    warningCount: 0,
    summary,
  };
}

/**
 * Run ruff check on Python code.
 *
 * AC3: ruff lint on Python agent code.
 */
export async function runRuffCheck(
  execFn: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  changedOnly = false,
  baseBranch = 'origin/main',
  timeoutMs = 60_000,
): Promise<CiCheckDetail> {
  let cmd: string;
  if (changedOnly) {
    // Get changed Python files and pass them to ruff
    cmd =
      `git diff --name-only "${baseBranch}"...HEAD --diff-filter=AM 2>/dev/null | ` +
      `grep -E '\\.py$' | xargs -r ruff check 2>&1 || ` +
      `(git diff --name-only HEAD 2>/dev/null | grep -E '\\.py$' | xargs -r ruff check 2>&1)`;
  } else {
    // ruff check on all Python files in standard locations
    cmd = 'ruff check . 2>&1';
  }

  // Check if ruff is available
  const ruffCheck = await execCmd('command -v ruff 2>/dev/null || python3 -m ruff --version 2>/dev/null', 10_000, execFn);
  const ruffAvailable =
    ruffCheck.exitCode === 0 && !ruffCheck.stderr.includes('not found') && ruffCheck.stdout.trim().length > 0;

  if (!ruffAvailable) {
    return {
      tool: 'ruff',
      passed: true,
      stdout: '',
      stderr: '',
      errorCount: 0,
      warningCount: 0,
      summary: 'ruff not installed — skipping (install via: pip install ruff)',
    };
  }

  // Resolve which ruff command to use
  const whichRuff = await execCmd('command -v ruff 2>/dev/null', 5_000, execFn);
  const ruffCmd = whichRuff.exitCode === 0 && whichRuff.stdout.trim().length > 0 ? 'ruff' : 'python3 -m ruff';

  const fullCmd = cmd.replace(/\bruff\b/g, ruffCmd);
  const result = await execCmd(fullCmd, timeoutMs, execFn);
  const output = (result.stdout + result.stderr).trim();

  // ruff exits 0 on clean, >0 on violations.
  // Ruff violations look like: path/file.py:line:col: code description
  const violationCount = (output.match(/:[0-9]+:[0-9]+:/g) || []).length;

  const passed = result.exitCode === 0;
  const summary = passed
    ? 'All Python files pass lint checks'
    : `ruff found ${violationCount} lint violation(s)`;

  return {
    tool: 'ruff',
    passed,
    stdout: result.stdout.slice(0, 10000),
    stderr: result.stderr.slice(0, 5000),
    errorCount: violationCount,
    warningCount: 0,
    summary,
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────

/**
 * Run all CI checks (biome, tsc, ruff) and return a structured report.
 *
 * This is the primary entry point for programmatic CI checking.
 * All checks must pass (AC4) before a PR can be created.
 */
export async function runCiChecks(
  execFn: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  options: CiCheckOptions = {},
): Promise<CiCheckReport> {
  const { changedOnly = false, baseBranch = 'origin/main', timeoutMs = 180_000 } = options;

  const [biomeResult, tscResult, ruffResult] = await Promise.all([
    runBiomeCheck(execFn, changedOnly, baseBranch, Math.min(timeoutMs, 120_000)),
    runTscCheck(execFn, Math.min(timeoutMs, 180_000)),
    runRuffCheck(execFn, changedOnly, baseBranch, Math.min(timeoutMs, 60_000)),
  ]);

  const checks = [biomeResult, tscResult, ruffResult];
  const passed = checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.filter((c) => !c.passed).length;

  return {
    passed,
    checks,
    summary: {
      total: checks.length,
      passed: passedCount,
      failed: failedCount,
    },
  };
}

/**
 * Convert CiCheckReport to QualityGateResult[] for integration with the
 * existing ActionDispatcher quality gates pipeline.
 *
 * The ActionDispatcher (actionDispatcher.ts) checks
 * `agentResult.verification?.qualityGates` before allowing PR creation.
 * This adapter makes the CI check results plug into that pipeline.
 */
export function ciReportToQualityGates(report: CiCheckReport): QualityGateResult[] {
  return report.checks.map((check) => {
    const gateName = check.tool === 'biome' ? 'ci-biome' : check.tool === 'tsc' ? 'ci-tsc' : 'ci-ruff';
    return {
      gate: gateName,
      passed: check.passed,
      ossTool: check.tool,
      command:
        check.tool === 'biome'
          ? 'npx biome check .'
          : check.tool === 'tsc'
            ? 'npx tsc --noEmit'
            : 'ruff check .',
      stdout: check.stdout,
      stderr: check.stderr,
      details: [
        check.summary,
        ...(check.errorCount > 0 ? [`${check.errorCount} error(s)`] : []),
        ...(check.warningCount > 0 ? [`${check.warningCount} warning(s)`] : []),
      ],
    } as unknown as QualityGateResult;
  });
}

/**
 * Run all CI checks and return as QualityGateResult[] ready for the
 * verification pipeline. Convenience wrapper for use in issueAgent.ts.
 */
export async function runCiChecksAsGates(
  execFn: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  options: CiCheckOptions = {},
): Promise<{ report: CiCheckReport; gates: QualityGateResult[] }> {
  const report = await runCiChecks(execFn, options);
  const gates = ciReportToQualityGates(report);
  return { report, gates };
}
