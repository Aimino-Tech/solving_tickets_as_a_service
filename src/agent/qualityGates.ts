import { rootLogger } from '../utils/logger.js';
import type { SandboxExecutor } from '../sandbox/types.js';

const log = rootLogger.child({ module: 'quality-gates' });

export interface GateResult {
  gate: string;
  passed: boolean;
  duration: number;
  reason?: string;
  details?: string;
}

export interface QualityGatesResult {
  passed: boolean;
  gates: GateResult[];
  retryCount: number;
  maxRetries: number;
  canRetry: boolean;
}

export interface QualityGateResult {
  gate: string;
  passed: boolean;
  duration: number;
  output: string;
}

const FILE_PATH_IN_DIFF_RE = /(?:\+|\-)\s*(?:import\s+.*\s+from\s+['"]|require\s*\(\s*['"]|export\s+\w+\s+from\s+['"])([^'"]+)['"]/g;
const REFERENCED_PATH_RE = /(?:\+|\-)\s*(?:.*`([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|c|cpp|h|cs|dart|vue|svelte|css|scss|less|json|yaml|yml|toml|md|sql))`)/g;

export async function gateRealityCheck(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!diff) {
    return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const referencedPaths = new Set<string>();
  let m: RegExpExecArray | null;

  const pathRe = new RegExp(REFERENCED_PATH_RE);
  while ((m = pathRe.exec(diff)) !== null) {
    const path = m[1];
    if (path.startsWith('src/') || path.startsWith('lib/') || path.startsWith('app/') || path.startsWith('packages/')) {
      referencedPaths.add(path);
    }
  }

  const fileRe = new RegExp(FILE_PATH_IN_DIFF_RE);
  while ((m = fileRe.exec(diff)) !== null) {
    const importPath = m[1];
    if (importPath.startsWith('.')) {
      referencedPaths.add(importPath);
    }
  }

  if (referencedPaths.size === 0) {
    return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'No file references found in diff' };
  }

  const missingFiles: string[] = [];
  for (const filePath of referencedPaths) {
    try {
      const safePath = filePath.replace(/'/g, "'\\''");
      const result = await sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
      if (result.stdout.trim() !== 'EXISTS') {
        missingFiles.push(filePath);
      }
    } catch {
      missingFiles.push(filePath);
    }
  }

  if (missingFiles.length > 0) {
    return {
      gate: 'reality-check',
      passed: false,
      duration: Date.now() - start,
      reason: `Referenced files do not exist: ${missingFiles.join(', ')}`,
      details: missingFiles.join('\n'),
    };
  }

  return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'All referenced files exist' };
}

export async function gateCompileCheck(
  sandbox: SandboxExecutor,
): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await sandbox.exec('npx tsc --noEmit 2>&1 || true', 120_000);
    const output = result.stdout + result.stderr;
    if (output.includes('error')) {
      const errors = output.split('\n').filter(l => l.includes('error')).slice(0, 20);
      return {
        gate: 'compile-check',
        passed: false,
        duration: Date.now() - start,
        reason: `TypeScript compilation failed with ${errors.length} error(s)`,
        details: errors.join('\n'),
      };
    }
    return { gate: 'compile-check', passed: true, duration: Date.now() - start, reason: 'Compilation succeeded' };
  } catch (err) {
    return {
      gate: 'compile-check',
      passed: false,
      duration: Date.now() - start,
      reason: `Compilation check error: ${String(err)}`,
    };
  }
}

export async function gateTestCheck(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!diff) {
    return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const testFileRegex = /(?:\+|\-)\s*.*(?:describe|it|test)\s*\(/g;
  const hasTestChanges = testFileRegex.test(diff);
  if (!hasTestChanges) {
    return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: 'No test changes in diff' };
  }

  const vacuousPatterns = [
    /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/,
    /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/,
    /expect\(\s*1\s*\)\.toBe\(\s*1\s*\)/,
    /\.should\s*\(\s*['"]work['"]\s*\)/,
    /expect\(\s*\.\.\.\s*\)/,
  ];
  for (const pattern of vacuousPatterns) {
    if (pattern.test(diff)) {
      return {
        gate: 'test-check',
        passed: false,
        duration: Date.now() - start,
        reason: 'Vacuous assertion detected',
        details: `Pattern matched: ${pattern}`,
      };
    }
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const nonVacuousAssertions = addedLines.filter(l =>
    l.includes('expect(') || l.includes('.should(') || l.includes('assert.') || l.includes('assertEquals') || l.includes('assertThat'),
  );
  if (nonVacuousAssertions.length === 0) {
    return {
      gate: 'test-check',
      passed: false,
      duration: Date.now() - start,
      reason: 'No assertions found in added test code',
    };
  }

  return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: `Found ${nonVacuousAssertions.length} non-vacuous assertions` };
}

export async function gateHallucinationCheck(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!diff) {
    return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const importRe = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
  const newImports = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = importRe.exec(diff)) !== null) {
    const modulePath = m[1];
    if (modulePath.startsWith('.')) continue;
    const pkgName = modulePath.startsWith('@')
      ? modulePath.split('/').slice(0, 2).join('/')
      : modulePath.split('/')[0];
    if (pkgName && !pkgName.startsWith('node:') && pkgName !== '') {
      newImports.add(pkgName);
    }
  }

  if (newImports.size === 0) {
    return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'No new external imports detected' };
  }

  try {
    const packageJson = await sandbox.exec('cat package.json 2>/dev/null || true', 10_000);
    const pj = JSON.parse(packageJson.stdout || '{}');
    const allDeps = { ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies };

    const unknownPackages: string[] = [];
    for (const pkg of newImports) {
      if (!allDeps[pkg]) {
        try {
          const npmResult = await sandbox.exec(`npm view ${pkg} version 2>&1 || true`, 30_000);
          if (npmResult.stdout.includes('404') || npmResult.stderr.includes('404') || npmResult.stderr.includes('E404')) {
            unknownPackages.push(pkg);
          }
        } catch {
          unknownPackages.push(pkg);
        }
      }
    }

    if (unknownPackages.length > 0) {
      return {
        gate: 'hallucination-check',
        passed: false,
        duration: Date.now() - start,
        reason: `Packages not found on npm: ${unknownPackages.join(', ')}`,
        details: unknownPackages.join('\n'),
      };
    }

    return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'All imports resolve to known packages' };
  } catch (err) {
    return {
      gate: 'hallucination-check',
      passed: false,
      duration: Date.now() - start,
      reason: `Hallucination check error: ${String(err)}`,
    };
  }
}

export async function runQualityGates(
  sandbox: SandboxExecutor,
  diff: string,
  retryCount: number = 0,
  maxRetries: number = 3,
): Promise<QualityGatesResult> {
  const start = Date.now();
  let allPassed = true;

  const gateFns: Array<() => Promise<GateResult>> = [
    () => gateRealityCheck(sandbox, diff),
    () => gateCompileCheck(sandbox),
    () => gateTestCheck(sandbox, diff),
    () => gateHallucinationCheck(sandbox, diff),
  ];

  const results = await Promise.all(
    gateFns.map(async (gateFn) => {
      try {
        return await gateFn();
      } catch (err) {
        return {
          gate: 'unknown',
          passed: false,
          duration: Date.now() - start,
          reason: `Gate threw an error: ${String(err)}`,
        } as GateResult;
      }
    }),
  );

  for (const result of results) {
    if (!result.passed) {
      allPassed = false;
      log.warn({ gate: result.gate, reason: result.reason }, 'Quality gate failed');
    }
  }

  return {
    passed: allPassed,
    gates: results,
    retryCount,
    maxRetries,
    canRetry: retryCount < maxRetries,
  };
}

// ── Hallucination gates ──────────────────────────────────────────────────────

export async function gateHallucinationGrep(
  _sandbox: import('../sandbox/types.js').SandboxExecutor,
  _agentOutput: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!_agentOutput) {
    return { gate: 'hallucination-grep', passed: true, duration: Date.now() - start, reason: 'No agent output to check' };
  }

  // Parse agent output for file path claims
  const fileClaimRe = /(?:created|modified|updated|added|changed)\s+(?:file\s+)?`?([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|c|cpp|h|cs|dart|vue|svelte|css|scss|less|json|yaml|yml|toml|md|sql))`?/gi;
  const claims: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fileClaimRe.exec(_agentOutput)) !== null) {
    claims.push(m[1]);
  }

  if (claims.length === 0) {
    return { gate: 'hallucination-grep', passed: true, duration: Date.now() - start, reason: 'No file claims in agent output' };
  }

  // Check each claimed file
  const missing: string[] = [];
  for (const filePath of claims) {
    try {
      const safePath = filePath.replace(/'/g, "'\\''");
      const result = await _sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
      if (result.stdout.trim() !== 'EXISTS') {
        missing.push(filePath);
      }
    } catch {
      missing.push(filePath);
    }
  }

  if (missing.length > 0) {
    return {
      gate: 'hallucination-grep',
      passed: false,
      duration: Date.now() - start,
      reason: `Referenced files do not exist: ${missing.join(', ')}`,
      details: missing.join('\n'),
    };
  }

  return { gate: 'hallucination-grep', passed: true, duration: Date.now() - start, reason: 'All claimed files exist' };
}

export async function gateGhostcheck(
  _sandbox: import('../sandbox/types.js').SandboxExecutor,
  _diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!_diff) {
    return { gate: 'ghostcheck', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const importRe = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
  const externalImports = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(_diff)) !== null) {
    const modulePath = m[1];
    if (!modulePath.startsWith('.')) {
      const pkgName = modulePath.startsWith('@')
        ? modulePath.split('/').slice(0, 2).join('/')
        : modulePath.split('/')[0];
      if (pkgName && !pkgName.startsWith('node:') && pkgName !== '') {
        externalImports.add(pkgName);
      }
    }
  }

  if (externalImports.size === 0) {
    return { gate: 'ghostcheck', passed: true, duration: Date.now() - start, reason: 'No new external imports detected' };
  }

  const phantomPackages: string[] = [];
  for (const pkg of externalImports) {
    try {
      const result = await _sandbox.exec(`npm view ${pkg} version 2>&1 || true`, 30_000);
      if (result.stderr.includes('E404') || result.stderr.includes('404') || result.stdout.includes('404')) {
        phantomPackages.push(pkg);
      }
    } catch {
      phantomPackages.push(pkg);
    }
  }

  if (phantomPackages.length > 0) {
    return {
      gate: 'ghostcheck',
      passed: false,
      duration: Date.now() - start,
      reason: `Ghost packages detected: ${phantomPackages.join(', ')}`,
      details: `Non-existent packages: ${phantomPackages.join(', ')}`,
    };
  }

  return { gate: 'ghostcheck', passed: true, duration: Date.now() - start, reason: 'All imports resolve to known packages' };
}

export async function gateVerdictTestIntegrity(
  _sandbox: import('../sandbox/types.js').SandboxExecutor,
  _diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!_diff) {
    return { gate: 'verdict-test-integrity', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  // Check for vacuous test patterns
  const vacuousPatterns = [
    /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/,
    /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/,
    /expect\(\s*1\s*\)\.toBe\(\s*1\s*\)/,
  ];

  for (const pattern of vacuousPatterns) {
    if (pattern.test(_diff)) {
      return {
        gate: 'verdict-test-integrity',
        passed: false,
        duration: Date.now() - start,
        reason: 'Vacuous assertion detected',
        details: `Vacuous test: ${pattern}`,
      };
    }
  }

  const addedLines = _diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const hasAssertions = addedLines.some(l =>
    l.includes('expect(') || l.includes('.should(') || l.includes('assert.') || l.includes('assertEquals'),
  );

  if (!hasAssertions) {
    return {
      gate: 'verdict-test-integrity',
      passed: false,
      duration: Date.now() - start,
      reason: 'No real assertions found in test code',
    };
  }

  return { gate: 'verdict-test-integrity', passed: true, duration: Date.now() - start, reason: 'Tests contain real assertions' };
}

export async function gateTraceCorePatterns(
  _sandbox: import('../sandbox/types.js').SandboxExecutor,
  _diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!_diff) {
    return { gate: 'trace-core-patterns', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const highSeverityPatterns = [
    /try\s*\{[^}]*\}\s*catch\s*\(\s*\)\s*\{/,
    /catch\s*\([^)]*\)\s*\{\s*\}/,
  ];

  const reasons: string[] = [];
  for (const pattern of highSeverityPatterns) {
    if (pattern.test(_diff)) {
      reasons.push(`high-severity`);
    }
  }

  if (reasons.length > 0) {
    return {
      gate: 'trace-core-patterns',
      passed: false,
      duration: Date.now() - start,
      reason: 'high-severity AI failure patterns detected',
      details: `Detected ${reasons.length} high-severity patterns`,
    };
  }

  return { gate: 'trace-core-patterns', passed: true, duration: Date.now() - start, reason: 'No AI failure patterns detected' };
}

export async function gateSyntheticDataCheck(
  _sandbox: import('../sandbox/types.js').SandboxExecutor,
  diff: string,
): Promise<GateResult> {
  const start = Date.now();
  if (!diff) {
    return { gate: 'synthetic-data-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const addedCode = addedLines.map(l => l.slice(1)).join('\n').toLowerCase();

  const hasFetch = /fetch\s*\(/.test(addedCode);
  const hasLargeData = (addedCode.match(/\{.*id.*name.*\}/g) || []).length >= 4;
  const hasPlaceholderValues = /test@example\.com|foo@bar\.com|placeholder|sample@test\.com/.test(addedCode);
  const hasDataClaim = /fetch|get|load|query/.test(addedCode) && !hasFetch;

  if (hasPlaceholderValues) {
    return {
      gate: 'synthetic-data-check',
      passed: false,
      duration: Date.now() - start,
      reason: 'Placeholder values detected in generated data',
      details: 'hardcoded',
    };
  }

  if (hasLargeData && !hasFetch) {
    return {
      gate: 'synthetic-data-check',
      passed: false,
      duration: Date.now() - start,
      reason: 'Large hardcoded data array without fetch call',
      details: 'hardcoded',
    };
  }

  if (hasLargeData && hasFetch) {
    return { gate: 'synthetic-data-check', passed: true, duration: Date.now() - start, reason: 'Large array has matching fetch call' };
  }

  if (hasDataClaim) {
    return {
      gate: 'synthetic-data-check',
      passed: false,
      duration: Date.now() - start,
      reason: 'Data claim without matching fetch call',
      details: 'fetch',
    };
  }

  return { gate: 'synthetic-data-check', passed: true, duration: Date.now() - start, reason: 'Legitimate code with real API calls' };
}
