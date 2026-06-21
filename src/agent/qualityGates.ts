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
