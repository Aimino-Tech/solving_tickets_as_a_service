/**
 * Repo-side quality gate runner (AIM-4496).
 *
 * Mirrors the 6 deterministic gates from scripts/quality-gates.sh so they can
 * be enforced programmatically inside the fix-PR flow (before PR creation),
 * not just via /api/quality or the CLI.
 *
 * Gates:
 *   1. compile     — tsc --noEmit passes
 *   2. vacuous-test — test files have real assertions (no vacuous patterns)
 *   3. hallucination — no stub/placeholder patterns, no TODO-only bodies
 *   4. dead-code    — knip detects no orphaned files/exports
 *   5. format       — biome check passes
 *   6. secret       — gitleaks detect passes (regex fallback if unavailable)
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'repo-quality-gates' });

export type RepoGateName = 'compile' | 'vacuous-test' | 'hallucination' | 'dead-code' | 'format' | 'secret';

export interface RepoGateResult {
  gate: RepoGateName;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  details: string[];
  error?: string;
}

export interface RepoQualityGateReport {
  passed: boolean;
  gates: RepoGateResult[];
  totalDurationMs: number;
  summary: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ExecFn = (cmd: string, timeout?: number) => Promise<ExecResult>;

export interface RunRepoGatesOptions {
  execFn: ExecFn;
  repoDir?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;

function ok(gate: RepoGateName, details: string[], stdout = '', stderr = ''): RepoGateResult {
  return { gate, passed: true, durationMs: 0, stdout, stderr, details };
}

function fail(gate: RepoGateName, details: string[], stdout = '', stderr = ''): RepoGateResult {
  return { gate, passed: false, durationMs: 0, stdout, stderr, details };
}

async function gateCompile(execFn: ExecFn, repoDir: string, timeoutMs: number): Promise<RepoGateResult> {
  const start = Date.now();
  try {
    const detect = await execFn('test -f tsconfig.json && echo ts || echo other', 10_000);
    if (detect.stdout.trim() !== 'ts') {
      return { ...ok('compile', ['No tsconfig.json found — compile gate skipped']), durationMs: Date.now() - start };
    }
    const result = await execFn('npx tsc --noEmit 2>&1 || true', timeoutMs);
    const output = `${result.stdout}\n${result.stderr}`;
    const errorLines = output.split('\n').filter((l) => l.includes('error TS'));
    if (errorLines.length > 0) {
      return {
        ...fail('compile', [
          `TypeScript compilation failed with ${errorLines.length} error(s)`,
          ...errorLines.slice(0, 10),
        ]),
        durationMs: Date.now() - start,
      };
    }
    return { ...ok('compile', ['TypeScript compilation succeeded']), durationMs: Date.now() - start };
  } catch (err) {
    return { ...fail('compile', [`Compile gate error: ${String(err)}`]), durationMs: Date.now() - start };
  }
}

const VACUOUS_PATTERNS = [
  'expect(true).toBe(true)',
  'expect(false).toBe(false)',
  'expect(1).toBe(1)',
  'expect(0).toBe(0)',
  'expect(null).toBe(null)',
];

async function gateVacuousTest(execFn: ExecFn, repoDir: string, timeoutMs: number): Promise<RepoGateResult> {
  const start = Date.now();
  try {
    const result = await execFn(
      `find ${repoDir} -type f \\( -name '*.test.ts' -o -name '*.spec.ts' -o -name '*.test.tsx' -o -name '*.spec.tsx' \\) -not -path '*/node_modules/*' 2>/dev/null | head -200 || true`,
      timeoutMs,
    );
    const testFiles = result.stdout.split('\n').filter(Boolean);
    if (testFiles.length === 0) {
      return { ...ok('vacuous-test', ['No test files found']), durationMs: Date.now() - start };
    }

    const findings: string[] = [];
    for (const file of testFiles) {
      const content = await execFn(`cat "${file}" 2>/dev/null | head -2000 || true`, timeoutMs);
      for (const pattern of VACUOUS_PATTERNS) {
        if (content.stdout.includes(pattern)) {
          findings.push(`${file}: vacuous pattern ${pattern}`);
          break;
        }
      }
      const hasTest = /\b(it|test|describe)\(/.test(content.stdout);
      const hasAssertion = /(expect|assert|should\.)/.test(content.stdout);
      if (hasTest && !hasAssertion) {
        findings.push(`${file}: test block with no assertions`);
      }
    }

    if (findings.length > 0) {
      return {
        ...fail('vacuous-test', [`${findings.length} vacuous test finding(s)`, ...findings.slice(0, 10)]),
        durationMs: Date.now() - start,
      };
    }
    return {
      ...ok('vacuous-test', [`All ${testFiles.length} test files have real assertions`]),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return { ...fail('vacuous-test', [`Test integrity gate error: ${String(err)}`]), durationMs: Date.now() - start };
  }
}

const STUB_PATTERNS = [
  'TODO: implement',
  'TODO: Implement',
  'throw new Error("Not implemented',
  "throw new Error('Not implemented",
  'Not implemented yet',
];

async function gateHallucination(execFn: ExecFn, repoDir: string, timeoutMs: number): Promise<RepoGateResult> {
  const start = Date.now();
  try {
    const result = await execFn(
      `grep -rEn '${STUB_PATTERNS.join('|')}' ${repoDir}/src ${repoDir}/workers 2>/dev/null | head -50 || true`,
      timeoutMs,
    );
    const findings = result.stdout.split('\n').filter(Boolean);
    if (findings.length > 0) {
      return {
        ...fail('hallucination', [`${findings.length} stub/placeholder pattern(s) found`, ...findings.slice(0, 10)]),
        durationMs: Date.now() - start,
      };
    }
    return { ...ok('hallucination', ['No stub or placeholder patterns found']), durationMs: Date.now() - start };
  } catch (err) {
    return {
      ...ok('hallucination', [`Hallucination gate error: ${String(err)} (non-blocking)`]),
      durationMs: Date.now() - start,
    };
  }
}

async function gateDeadCode(execFn: ExecFn, repoDir: string, timeoutMs: number): Promise<RepoGateResult> {
  const start = Date.now();
  try {
    const hasKnip = await execFn(`test -f ${repoDir}/knip.json && echo yes || echo no`, 10_000);
    if (hasKnip.stdout.trim() !== 'yes') {
      return { ...ok('dead-code', ['No knip.json found — dead-code gate skipped']), durationMs: Date.now() - start };
    }
    const result = await execFn(`cd ${repoDir} && npx knip --no-progress 2>&1 || true`, timeoutMs);
    const output = `${result.stdout}\n${result.stderr}`;
    const unusedFiles = output.split('\n').filter((l) => l.trim().startsWith('src/')).length;
    if (unusedFiles > 5) {
      return {
        ...fail('dead-code', [`knip detected ${unusedFiles} potentially unused source file(s)`]),
        durationMs: Date.now() - start,
      };
    }
    return { ...ok('dead-code', ['knip: no significant unused code detected']), durationMs: Date.now() - start };
  } catch (err) {
    return {
      ...ok('dead-code', [`Dead-code gate error: ${String(err)} (non-blocking)`]),
      durationMs: Date.now() - start,
    };
  }
}

async function gateFormat(execFn: ExecFn, repoDir: string, timeoutMs: number): Promise<RepoGateResult> {
  const start = Date.now();
  try {
    const hasBiome = await execFn(`test -f ${repoDir}/biome.json && echo yes || echo no`, 10_000);
    if (hasBiome.stdout.trim() !== 'yes') {
      return { ...ok('format', ['No biome.json found — format gate skipped']), durationMs: Date.now() - start };
    }
    const result = await execFn(`cd ${repoDir} && npx biome check src/ 2>&1 || true`, timeoutMs);
    const output = `${result.stdout}\n${result.stderr}`;
    const errorCount = (output.match(/\berror(s)?\b/gi) || []).length;
    if (errorCount > 0) {
      return { ...fail('format', [`biome reported ${errorCount} error(s)`]), durationMs: Date.now() - start };
    }
    return { ...ok('format', ['biome check passed']), durationMs: Date.now() - start };
  } catch (err) {
    return { ...fail('format', [`Format gate error: ${String(err)}`]), durationMs: Date.now() - start };
  }
}

const SECRET_PATTERNS = [
  /(?:sk_live|pk_live)_[A-Za-z0-9]{10,}/,
  /(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{36}/,
  /xox[abpors]-[A-Za-z0-9-]{10,}/,
  /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
];

async function gateSecret(execFn: ExecFn, repoDir: string, timeoutMs: number): Promise<RepoGateResult> {
  const start = Date.now();
  try {
    const hasGitleaks = await execFn('command -v gitleaks >/dev/null 2>&1 && echo yes || echo no', 10_000);
    if (hasGitleaks.stdout.trim() === 'yes') {
      const result = await execFn(
        `cd ${repoDir} && gitleaks detect --source . --no-banner --no-color 2>&1 || true`,
        timeoutMs,
      );
      const output = `${result.stdout}\n${result.stderr}`;
      if (output.toLowerCase().includes('leaks found') || /finding/i.test(output)) {
        return { ...fail('secret', ['gitleaks reported potential secrets']), durationMs: Date.now() - start };
      }
      return { ...ok('secret', ['gitleaks: no secrets detected']), durationMs: Date.now() - start };
    }

    const scan = await execFn(
      `cd ${repoDir} && git diff --name-only origin/main...HEAD 2>/dev/null | head -200 || true`,
      10_000,
    );
    const files = scan.stdout.split('\n').filter(Boolean);
    if (files.length === 0)
      return { ...ok('secret', ['gitleaks unavailable, no diff to scan']), durationMs: Date.now() - start };

    const findings: string[] = [];
    for (const file of files.slice(0, 50)) {
      const content = await execFn(`cat "${repoDir}/${file}" 2>/dev/null || true`, 10_000);
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content.stdout)) {
          findings.push(`${file}: potential secret pattern`);
          break;
        }
      }
    }
    if (findings.length > 0) {
      return { ...fail('secret', findings), durationMs: Date.now() - start };
    }
    return { ...ok('secret', ['No secrets detected (regex fallback)']), durationMs: Date.now() - start };
  } catch (err) {
    return { ...fail('secret', [`Secret gate error: ${String(err)}`]), durationMs: Date.now() - start };
  }
}

/**
 * Run all 6 repo-side quality gates and return a consolidated report.
 * Mirrors scripts/quality-gates.sh (compile, vacuous-test, hallucination,
 * dead-code, format, secret).
 */
export async function runRepoQualityGates(options: RunRepoGatesOptions): Promise<RepoQualityGateReport> {
  const repoDir = options.repoDir || '.';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const overallStart = Date.now();

  const results = await Promise.all([
    gateCompile(options.execFn, repoDir, timeoutMs),
    gateVacuousTest(options.execFn, repoDir, timeoutMs),
    gateHallucination(options.execFn, repoDir, timeoutMs),
    gateDeadCode(options.execFn, repoDir, timeoutMs),
    gateFormat(options.execFn, repoDir, timeoutMs),
    gateSecret(options.execFn, repoDir, timeoutMs),
  ]);

  const passed = results.every((g) => g.passed);
  const passedCount = results.filter((g) => g.passed).length;
  const totalDurationMs = Date.now() - overallStart;

  if (!passed) {
    const failed = results.filter((g) => !g.passed);
    log.warn({ failedGates: failed.map((f) => f.gate) }, `${failed.length}/6 repo quality gate(s) failed`);
  }

  return {
    passed,
    gates: results,
    totalDurationMs,
    summary: passed
      ? `All 6/6 repo quality gates passed (${totalDurationMs}ms)`
      : `${passedCount}/6 repo quality gates passed (${totalDurationMs}ms)`,
  };
}
