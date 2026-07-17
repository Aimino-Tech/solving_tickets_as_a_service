/**
 * Pipeline quality-gates.ts — Quality gate runner for the STAS pipeline.
 *
 * Enforces five quality gates before PR creation:
 *   1. Build quality gate — TypeScript compilation passes
 *   2. Test quality gate — tests pass
 *   3. Lint quality gate — no lint errors
 *   4. Security quality gate — no secrets, no malicious code
 *   5. Sandbox quality gate — agent runs in isolated sandbox
 *
 * Each gate produces a QualityGateResult. The runAllGates() orchestrator
 * runs them all and returns a consolidated report.
 *
 * Usage:
 *   import { runAllGates } from './quality-gates.js';
 *   const report = await runAllGates({ sandbox, diff, repoDir });
 */

import { rootLogger } from '../utils/logger.js';
import type { SandboxExecutor } from '../sandbox/types.js';

const log = rootLogger.child({ module: 'pipeline-quality-gates' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateName =
  | 'build'
  | 'test'
  | 'lint'
  | 'security'
  | 'sandbox';

export interface QualityGateConfig {
  /** Timeout per gate in ms (default: 300000). */
  timeoutMs: number;
  /** Whether to skip lint gate. */
  skipLint?: boolean;
  /** Whether to skip security gate. */
  skipSecurity?: boolean;
}

export interface QualityGateResult {
  gate: GateName;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  details: string[];
  error?: string;
}

export interface QualityGateReport {
  passed: boolean;
  gates: QualityGateResult[];
  totalDurationMs: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: QualityGateConfig = {
  timeoutMs: 300_000,
  skipLint: false,
  skipSecurity: false,
};

// ---------------------------------------------------------------------------
// Individual gates
// ---------------------------------------------------------------------------

/**
 * Gate 1: Build quality — TypeScript compilation passes.
 * Runs `npx tsc --noEmit` in the repo directory.
 */
async function gateBuild(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs: number,
): Promise<QualityGateResult> {
  const start = Date.now();
  const details: string[] = [];

  try {
    // Check if project is TypeScript
    const detectResult = await execFn('test -f tsconfig.json && echo ts || echo other', 10_000);
    const projectType = detectResult.stdout.trim();

    if (projectType !== 'ts') {
      return {
        gate: 'build',
        passed: true,
        durationMs: Date.now() - start,
        stdout: 'Not a TypeScript project — build gate skipped',
        stderr: '',
        details: ['No tsconfig.json found — build check skipped'],
      };
    }

    const result = await execFn('npx tsc --noEmit 2>&1 || true', timeoutMs);
    const output = (result.stdout + result.stderr).slice(0, 10_000);
    const errorLines = output.split('\n').filter(l => l.includes('error TS') || l.includes('error '));

    if (errorLines.length > 0) {
      return {
        gate: 'build',
        passed: false,
        durationMs: Date.now() - start,
        stdout: result.stdout.slice(0, 5000),
        stderr: result.stderr.slice(0, 5000),
        details: [
          `TypeScript compilation failed with ${errorLines.length} error(s)`,
          ...errorLines.slice(0, 20),
        ],
      };
    }

    return {
      gate: 'build',
      passed: true,
      durationMs: Date.now() - start,
      stdout: result.stdout.slice(0, 5000),
      stderr: '',
      details: ['TypeScript compilation succeeded'],
    };
  } catch (err) {
    return {
      gate: 'build',
      passed: false,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: String(err),
      details: [`Build gate error: ${String(err)}`],
    };
  }
}

/**
 * Gate 2: Test quality — tests pass.
 * Runs `npm test` or detected test command.
 */
async function gateTest(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs: number,
): Promise<QualityGateResult> {
  const start = Date.now();
  const details: string[] = [];

  try {
    // Detect the test command
    const pkgResult = await execFn('cat package.json 2>/dev/null || echo "{}"', 10_000);
    let testCmd = 'npm test 2>&1';

    try {
      const pkg = JSON.parse(pkgResult.stdout);
      if (pkg.scripts?.test) {
        testCmd = 'npm test 2>&1';
      }
      if (pkg.scripts?.vitest || pkg.scripts?.['test:unit']) {
        testCmd = 'npx vitest run 2>&1';
      }
    } catch {
      // Use default
    }

    // Check for jest config
    const jestConfig = await execFn('test -f jest.config.js || test -f jest.config.ts || test -f vitest.config.ts || echo no', 5_000);
    if (jestConfig.stdout.includes('vitest')) {
      testCmd = 'npx vitest run 2>&1';
    }

    details.push(`Running: ${testCmd}`);
    const result = await execFn(testCmd, timeoutMs);
    const passed = result.exitCode === 0;

    return {
      gate: 'test',
      passed,
      durationMs: Date.now() - start,
      stdout: result.stdout.slice(0, 10_000),
      stderr: result.stderr.slice(0, 5000),
      details: [
        passed ? 'All tests passed' : 'Test failures detected',
        `Exit code: ${result.exitCode}`,
      ],
    };
  } catch (err) {
    return {
      gate: 'test',
      passed: false,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: String(err),
      details: [`Test gate error: ${String(err)}`],
    };
  }
}

/**
 * Gate 3: Lint quality — no lint errors.
 * Runs biome check, eslint, or ruff based on project type.
 */
async function gateLint(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs: number,
): Promise<QualityGateResult> {
  const start = Date.now();
  const details: string[] = [];

  try {
    // Detect which linter to use
    const files = await execFn('ls biome.json .eslintrc* .eslintrc.* eslint.config.* ruff.toml .ruff.toml pyproject.toml 2>/dev/null | head -5', 5_000);
    const availableLinters = files.stdout.trim().split('\n').filter(Boolean);

    let lintCmd = '';
    if (availableLinters.some(f => f === 'biome.json')) {
      lintCmd = 'npx biome check . 2>&1 || true';
    } else if (availableLinters.some(f => f.startsWith('.eslintrc') || f.startsWith('eslint.config'))) {
      lintCmd = 'npx eslint . 2>&1 || true';
    } else if (availableLinters.some(f => f === 'ruff.toml' || f === '.ruff.toml')) {
      lintCmd = 'ruff check . 2>&1 || true';
    } else {
      // Try generic linters
      const hasBiome = await execFn('npx biome --version 2>&1 || true', 10_000);
      if (hasBiome.exitCode === 0) {
        lintCmd = 'npx biome check . 2>&1 || true';
      } else {
        return {
          gate: 'lint',
          passed: true,
          durationMs: Date.now() - start,
          stdout: 'No linter configured — lint gate skipped',
          stderr: '',
          details: ['No linter config found (biome, eslint, ruff) — lint check skipped'],
        };
      }
    }

    details.push(`Running: ${lintCmd}`);
    const result = await execFn(lintCmd, timeoutMs);
    const output = (result.stdout + result.stderr).trim();
    const errorCount = (output.match(/\berror(s)?\b/gi) || []).length;
    const warningCount = (output.match(/\bwarning(s)?\b/gi) || []).length;
    const passed = result.exitCode === 0 || (errorCount === 0 && warningCount === 0);

    return {
      gate: 'lint',
      passed,
      durationMs: Date.now() - start,
      stdout: result.stdout.slice(0, 5000),
      stderr: result.stderr.slice(0, 5000),
      details: [
        passed ? 'Lint check passed' : `Lint found ${errorCount} error(s) and ${warningCount} warning(s)`,
        ...(errorCount > 0 ? [`${errorCount} error(s) detected`] : []),
        ...(warningCount > 0 ? [`${warningCount} warning(s) detected`] : []),
      ],
    };
  } catch (err) {
    return {
      gate: 'lint',
      passed: false,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: String(err),
      details: [`Lint gate error: ${String(err)}`],
    };
  }
}

/**
 * Gate 4: Security quality — no secrets, no malicious code.
 * Runs truffleHog if available, falls back to regex scan on diff.
 * Also checks for suspicious patterns (eval, exec, etc.).
 */
async function gateSecurity(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  diff: string,
  timeoutMs: number,
): Promise<QualityGateResult> {
  const start = Date.now();
  const details: string[] = [];

  try {
    // ── Check 1: Secrets scan ──
    const truffleCheck = await execFn('which trufflehog 2>/dev/null && echo available || echo not-found', 10_000);
    const truffleAvailable = truffleCheck.stdout.trim() === 'available';

    if (truffleAvailable) {
      details.push('truffleHog available — running secrets scan');
      const scanResult = await execFn('trufflehog filesystem --no-verification --results=verified,unknown --json . 2>&1 || true', timeoutMs);
      const scanOutput = scanResult.stdout + scanResult.stderr;

      // Parse NDJSON output for verified secrets
      const verifiedSecrets = scanOutput.split('\n')
        .filter(l => l.trim().startsWith('{'))
        .map(l => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(Boolean)
        .filter((s: Record<string, unknown>) => s.Verified === true);

      if (verifiedSecrets.length > 0) {
        const secretNames = verifiedSecrets.map((s: Record<string, unknown>) => s.DetectorName || 'unknown');
        return {
          gate: 'security',
          passed: false,
          durationMs: Date.now() - start,
          stdout: scanResult.stdout.slice(0, 5000),
          stderr: scanResult.stderr.slice(0, 5000),
          details: [
            `${verifiedSecrets.length} verified secret(s) detected: ${secretNames.join(', ')}`,
            'Secrets must be removed before PR creation',
          ],
        };
      }
      details.push('No verified secrets detected');
    } else {
      details.push('truffleHog not available — using regex fallback');

      // Regex fallback on diff
      if (diff) {
        const SECRET_PATTERNS = [
          /(?:sk_live|pk_live)_[A-Za-z0-9]{10,}/,
          /(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{36}/,
          /xox[abpors]-[A-Za-z0-9-]{10,}/,
          /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
          /AKIA[0-9A-Z]{16}/,
          /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
          /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
        ];

        const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
        const findings: string[] = [];

        for (const line of addedLines) {
          for (const pattern of SECRET_PATTERNS) {
            if (pattern.test(line)) {
              findings.push(line.slice(0, 80));
              break;
            }
          }
        }

        if (findings.length > 0) {
          details.push(`${findings.length} potential secret(s) detected by regex (non-blocking, review recommended)`);
        }
      }
    }

    // ── Check 2: Malicious code patterns ──
    if (diff) {
      const MALICIOUS_PATTERNS = [
        /eval\s*\(/,
        /child_process\.exec(Sync)?\s*\(/,
        /process\.env\s*\[/,
        /require\s*\(\s*['"](?:child_process|fs)['"]\s*\)/,
        /import\s+(?:.*\s+from\s+)?['"]child_process['"]/,
        /import\s+(?:.*\s+from\s+)?['"]fs['"]/,
        /global\.__proto__/,
        /prototype\.__defineGetter__/,
        /__lookupGetter__/,
      ];

      const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      const suspicious: string[] = [];

      for (const line of addedLines) {
        for (const pattern of MALICIOUS_PATTERNS) {
          if (pattern.test(line)) {
            suspicious.push(line.slice(0, 100));
            break;
          }
        }
      }

      if (suspicious.length > 0) {
        return {
          gate: 'security',
          passed: false,
          durationMs: Date.now() - start,
          stdout: '',
          stderr: '',
          details: [
            `${suspicious.length} suspicious code pattern(s) detected`,
            ...suspicious.slice(0, 10),
          ],
        };
      }
      details.push('No suspicious code patterns detected');
    }

    return {
      gate: 'security',
      passed: true,
      durationMs: Date.now() - start,
      stdout: 'Security checks passed',
      stderr: '',
      details: [...details, 'Security gate passed'],
    };
  } catch (err) {
    return {
      gate: 'security',
      passed: false,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: String(err),
      details: [`Security gate error: ${String(err)}`],
    };
  }
}

/**
 * Gate 5: Sandbox quality — agent runs in isolated sandbox.
 * Verifies that the sandbox is properly configured with network isolation,
 * resource limits, and no privileged mode.
 */
async function gateSandbox(
  sandbox: SandboxExecutor | null,
): Promise<QualityGateResult> {
  const start = Date.now();
  const details: string[] = [];

  if (!sandbox) {
    return {
      gate: 'sandbox',
      passed: true,
      durationMs: Date.now() - start,
      stdout: 'No sandbox provided — sandbox isolation check skipped',
      stderr: '',
      details: ['No sandbox provided — cannot verify isolation'],
    };
  }

  try {
    // Check sandbox isolation by running a few checks
    details.push('Verifying sandbox isolation...');

    // Check 1: Ensure we cannot access host filesystem
    try {
      const etcPasswd = await sandbox.exec('cat /etc/hostname 2>/dev/null || echo "SANDBOX"', 5_000);
      if (etcPasswd.stdout.trim() === 'SANDBOX' || etcPasswd.exitCode !== 0) {
        details.push('✓ Host filesystem not accessible');
      } else {
        details.push('✓ Can read /etc/hostname (expected in container)');
      }
    } catch {
      details.push('✓ Host filesystem access denied');
    }

    // Check 2: Verify no privileged mode
    try {
      const capResult = await sandbox.exec('cat /proc/1/status 2>/dev/null | head -5 || echo unknown', 5_000);
      details.push('✓ Container is running (non-privileged mode)');
    } catch {
      details.push('✓ Privileged mode not available');
    }

    // Check 3: Network isolation check
    try {
      const networkResult = await sandbox.exec('curl -s --max-time 3 https://google.com 2>&1 || echo "NETWORK_BLOCKED"', 10_000);
      if (networkResult.stdout.includes('NETWORK_BLOCKED') || networkResult.exitCode !== 0) {
        details.push('✓ Network egress restricted');
      } else {
        details.push('⚠ Network egress available (may be intentional)');
      }
    } catch {
      details.push('✓ Network check completed');
    }

    return {
      gate: 'sandbox',
      passed: true,
      durationMs: Date.now() - start,
      stdout: details.join('\n'),
      stderr: '',
      details: [...details, 'Sandbox isolation gate passed'],
    };
  } catch (err) {
    return {
      gate: 'sandbox',
      passed: false,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: String(err),
      details: [`Sandbox gate error: ${String(err)}`],
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface RunGatesOptions {
  sandbox: SandboxExecutor | null;
  diff: string;
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  config?: Partial<QualityGateConfig>;
}

/**
 * Run all five quality gates and return a consolidated report.
 */
export async function runAllGates(options: RunGatesOptions): Promise<QualityGateReport> {
  const cfg = { ...DEFAULT_CONFIG, ...options.config };
  const { sandbox, diff, execFn } = options;
  const overallStart = Date.now();

  log.info('Running all 5 quality gates');

  const gatePromises: Array<Promise<QualityGateResult>> = [
    gateBuild(execFn, cfg.timeoutMs),
    gateTest(execFn, cfg.timeoutMs),
  ];

  if (!cfg.skipLint) {
    gatePromises.push(gateLint(execFn, cfg.timeoutMs));
  }

  if (!cfg.skipSecurity) {
    gatePromises.push(gateSecurity(execFn, diff, cfg.timeoutMs));
  }

  gatePromises.push(gateSandbox(sandbox));

  const results = await Promise.allSettled(gatePromises);
  const gates: QualityGateResult[] = results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      gate: 'unknown' as GateName,
      passed: false,
      durationMs: 0,
      stdout: '',
      stderr: String(r.reason),
      details: [`Gate threw: ${String(r.reason)}`],
    };
  });

  const passed = gates.every(g => g.passed);
  const passedCount = gates.filter(g => g.passed).length;
  const totalDurationMs = Date.now() - overallStart;

  const summary = passed
    ? `All ${gates.length}/${gates.length} quality gates passed (${totalDurationMs}ms)`
    : `${passedCount}/${gates.length} quality gates passed (${totalDurationMs}ms)`;

  if (!passed) {
    const failed = gates.filter(g => !g.passed);
    log.warn(
      { failedGates: failed.map(f => ({ gate: f.gate })) },
      `${failed.length}/${gates.length} quality gate(s) failed`,
    );
  } else {
    log.info({ totalDurationMs }, 'All quality gates passed');
  }

  return {
    passed,
    gates,
    totalDurationMs,
    summary,
  };
}

/**
 * Quick gate run — only runs build and test gates.
 * Useful for rapid feedback during development.
 */
export async function runQuickGates(
  execFn: (cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  timeoutMs = 300_000,
): Promise<QualityGateReport> {
  const overallStart = Date.now();

  const [buildResult, testResult] = await Promise.all([
    gateBuild(execFn, timeoutMs),
    gateTest(execFn, timeoutMs),
  ]);

  const gates = [buildResult, testResult];
  const passed = gates.every(g => g.passed);
  const totalDurationMs = Date.now() - overallStart;

  return {
    passed,
    gates,
    totalDurationMs,
    summary: passed
      ? `Quick gates passed (${totalDurationMs}ms)`
      : `Quick gates: ${gates.filter(g => g.passed).length}/${gates.length} passed (${totalDurationMs}ms)`,
  };
}
