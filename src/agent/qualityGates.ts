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

const DATA_PATTERN_RE = /(?:const|let|var)\s+\w+\s*=\s*\[\s*\n(?:\s*\{[^}]*\},\s*\n){5,}/g;
const API_CLAIM_RE = /\b(?:fetch|get|query|load|retrieve|pull)\s+(?:data|users|items|records|results)\s+(?:from|via|using)\s+(?:API|endpoint|service)\b/i;
const FETCH_CALL_RE = /\b(?:fetch|axios|http\.get|https\.get|\$http|\$\.get|superagent|request)\s*\(/g;
const DB_QUERY_RE = /\b(?:db\.|query|find|findMany|findAll|select|knex\.|prisma\.|typeorm\.)/g;

const AI_FAILURE_PATTERNS = [
  { pattern: /TODO/i, category: 'leftover-todo', severity: 'medium' },
  { pattern: /FIXME/i, category: 'leftover-fixme', severity: 'medium' },
  { pattern: /HACK/i, category: 'leftover-hack', severity: 'medium' },
  { pattern: /console\.(log|debug|info|warn|error)/, category: 'leftover-console', severity: 'low' },
  { pattern: /debugger;/, category: 'leftover-debugger', severity: 'high' },
  { pattern: /\.only\s*\(/, category: 'test-only-left', severity: 'high' },
  { pattern: /http:\/\/example\.com/, category: 'placeholder-url', severity: 'medium' },
  { pattern: /placeholder/i, category: 'placeholder-text', severity: 'medium' },
  { pattern: /changeme/i, category: 'placeholder-text', severity: 'medium' },
  { pattern: /as\s+any/, category: 'unsafe-cast', severity: 'low' },
  { pattern: /@ts-ignore/, category: 'ts-ignore', severity: 'medium' },
  { pattern: /@ts-expect-error/, category: 'ts-expect-error', severity: 'low' },
  { pattern: /\/\/\s+TODO/, category: 'todo-comment', severity: 'low' },
  { pattern: /skip\s*:\s*true/i, category: 'test-skip', severity: 'medium' },
  { pattern: /xit\s*\(/, category: 'test-skip', severity: 'medium' },
  { pattern: /xdescribe\s*\(/, category: 'test-skip', severity: 'medium' },
  { pattern: /it\.skip\s*\(/, category: 'test-skip', severity: 'medium' },
  { pattern: /describe\.skip\s*\(/, category: 'test-skip', severity: 'medium' },
  { pattern: /catch\s*\(\s*\)\s*\{/, category: 'empty-catch', severity: 'high' },
  { pattern: /catch\s*\(\s*_\s*\)\s*\{/, category: 'empty-catch', severity: 'high' },
  { pattern: /throw\s+new\s+Error\s*\(\s*['"]['"]\s*\)/, category: 'empty-error', severity: 'medium' },
  { pattern: /\/\/\s+replace\s+with/i, category: 'placeholder-text', severity: 'medium' },
  { pattern: /\/\/\s+implement\s+this/i, category: 'placeholder-text', severity: 'medium' },
  { pattern: /\/\/\s+your\s+code\s+here/i, category: 'placeholder-text', severity: 'medium' },
];

export async function gateRealityCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };

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
    if (importPath.startsWith('.')) referencedPaths.add(importPath);
  }

  if (referencedPaths.size === 0) return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'No file references found in diff' };

  const missingFiles: string[] = [];
  for (const filePath of referencedPaths) {
    try {
      const safePath = filePath.replace(/'/g, "'\\''");
      const result = await sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
      if (result.stdout.trim() !== 'EXISTS') missingFiles.push(filePath);
    } catch { missingFiles.push(filePath); }
  }

  if (missingFiles.length > 0) return { gate: 'reality-check', passed: false, duration: Date.now() - start, reason: `Referenced files do not exist: ${missingFiles.join(', ')}`, details: missingFiles.join('\n') };
  return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'All referenced files exist' };
}

export async function gateCompileCheck(sandbox: SandboxExecutor): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await sandbox.exec('npx tsc --noEmit 2>&1 || true', 120_000);
    const output = result.stdout + result.stderr;
    if (output.includes('error')) {
      const errors = output.split('\n').filter(l => l.includes('error')).slice(0, 20);
      return { gate: 'compile-check', passed: false, duration: Date.now() - start, reason: `Compilation failed with ${errors.length} error(s)`, details: errors.join('\n') };
    }
    return { gate: 'compile-check', passed: true, duration: Date.now() - start, reason: 'Compilation succeeded' };
  } catch (err) {
    return { gate: 'compile-check', passed: false, duration: Date.now() - start, reason: `Compilation check error: ${String(err)}` };
  }
}

export async function gateTestCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };

  const hasTestChanges = /(?:\+|\-)\s*.*(?:describe|it|test)\s*\(/g.test(diff);
  if (!hasTestChanges) return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: 'No test changes in diff' };

  const vacuousPatterns = [/expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/, /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/, /expect\(\s*1\s*\)\.toBe\(\s*1\s*\)/, /\.should\s*\(\s*['"]work['"]\s*\)/, /expect\(\s*\.\.\.\s*\)/];
  for (const pattern of vacuousPatterns) {
    if (pattern.test(diff)) return { gate: 'test-check', passed: false, duration: Date.now() - start, reason: 'Vacuous assertion detected', details: `Pattern: ${pattern}` };
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const nonVacuousAssertions = addedLines.filter(l => l.includes('expect(') || l.includes('.should(') || l.includes('assert.') || l.includes('assertEquals') || l.includes('assertThat'));
  if (nonVacuousAssertions.length === 0) return { gate: 'test-check', passed: false, duration: Date.now() - start, reason: 'No assertions found in added test code' };
  return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: `Found ${nonVacuousAssertions.length} non-vacuous assertions` };
}

export async function gateHallucinationCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };

  const importRe = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
  const newImports = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(diff)) !== null) {
    const modulePath = m[1];
    if (modulePath.startsWith('.')) continue;
    const pkgName = modulePath.startsWith('@') ? modulePath.split('/').slice(0, 2).join('/') : modulePath.split('/')[0];
    if (pkgName && !pkgName.startsWith('node:') && pkgName !== '') newImports.add(pkgName);
  }
  if (newImports.size === 0) return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'No new external imports detected' };

  try {
    const pkgResult = await sandbox.exec('cat package.json 2>/dev/null || true', 10_000);
    const pj = JSON.parse(pkgResult.stdout || '{}');
    const allDeps = { ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies };
    const unknownPackages: string[] = [];
    for (const pkg of newImports) {
      if (!allDeps[pkg]) {
        try {
          const npmResult = await sandbox.exec(`npm view ${pkg} version 2>&1 || true`, 30_000);
          if (npmResult.stdout.includes('404') || npmResult.stderr.includes('404') || npmResult.stderr.includes('E404')) unknownPackages.push(pkg);
        } catch { unknownPackages.push(pkg); }
      }
    }
    if (unknownPackages.length > 0) return { gate: 'hallucination-check', passed: false, duration: Date.now() - start, reason: `Packages not found: ${unknownPackages.join(', ')}`, details: unknownPackages.join('\n') };
    return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'All imports resolve to known packages' };
  } catch (err) {
    return { gate: 'hallucination-check', passed: false, duration: Date.now() - start, reason: `Error: ${String(err)}` };
  }
}

export async function gateHallucinationGrep(sandbox: SandboxExecutor, agentOutput: string): Promise<GateResult> {
  const start = Date.now();
  if (!agentOutput) return { gate: 'hallucination-grep', passed: true, duration: Date.now() - start, reason: 'No agent output to check' };

  const fileClaimRe = /(?:modified|created|updated|changed|wrote|added|deleted|removed)\s+(?:file\s+)?(.+?)(?:\s|$)/gi;
  const pathClaimRe = /(?:src|lib|app|packages|tests)\/[^\s,;`'"]+(?:\.ts|\.tsx|\.js|\.jsx|\.py|\.go|\.rs|\.json)/g;
  const claims = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = fileClaimRe.exec(agentOutput)) !== null) claims.add(match[1].trim());
  while ((match = pathClaimRe.exec(agentOutput)) !== null) claims.add(match[0]);

  if (claims.size === 0) return { gate: 'hallucination-grep', passed: true, duration: Date.now() - start, reason: 'No file claims in agent output' };

  const missing: string[] = [];
  for (const claim of claims) {
    try {
      const result = await sandbox.exec(`test -f '${claim.replace(/'/g, "'\\''")}' && echo EXISTS || echo MISSING`, 10_000);
      if (result.stdout.trim() !== 'EXISTS') missing.push(claim);
    } catch { missing.push(claim); }
  }

  if (missing.length > 0) return { gate: 'hallucination-grep', passed: false, duration: Date.now() - start, reason: `Hallucinated file claims: ${missing.join(', ')}`, details: missing.join('\n') };
  return { gate: 'hallucination-grep', passed: true, duration: Date.now() - start, reason: 'All file claims verified against real filesystem' };
}

export async function gateGhostcheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'ghostcheck', passed: true, duration: Date.now() - start, reason: 'No diff to check' };

  const importRe = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
  const imports = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(diff)) !== null) {
    const modPath = m[1];
    if (modPath.startsWith('.')) continue;
    const pkgName = modPath.startsWith('@') ? modPath.split('/').slice(0, 2).join('/') : modPath.split('/')[0];
    if (pkgName && !pkgName.startsWith('node:')) imports.add(pkgName);
  }
  if (imports.size === 0) return { gate: 'ghostcheck', passed: true, duration: Date.now() - start, reason: 'No new imports' };

  const missing: string[] = [];
  for (const pkg of imports) {
    try {
      const result = await sandbox.exec(`npm view ${pkg} version 2>&1 || true`, 30_000);
      if (result.stdout.includes('404') || result.stderr.includes('E404')) missing.push(pkg);
    } catch { missing.push(pkg); }
  }
  if (missing.length > 0) return { gate: 'ghostcheck', passed: false, duration: Date.now() - start, reason: `Ghost packages: ${missing.join(', ')}`, details: missing.join('\n') };
  return { gate: 'ghostcheck', passed: true, duration: Date.now() - start, reason: 'All packages verified on npm' };
}

export async function gateVerdictTestIntegrity(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'verdict-test-integrity', passed: true, duration: Date.now() - start, reason: 'No diff to check' };

  const hasTests = /(?:\+|\-)\s*.*(?:describe|it|test)\s*\(/g.test(diff);
  if (!hasTests) return { gate: 'verdict-test-integrity', passed: true, duration: Date.now() - start, reason: 'No test changes' };

  const vacuous = [/expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/, /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/, /\.should\s*\(\s*['"]work['"]\s*\)/];
  for (const vp of vacuous) {
    if (vp.test(diff)) return { gate: 'verdict-test-integrity', passed: false, duration: Date.now() - start, reason: 'Vacuous test detected', details: `Pattern: ${vp}` };
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const assertionLines = addedLines.filter(l => l.includes('expect(') || l.includes('.should(') || l.includes('assert.'));
  if (assertionLines.length === 0) return { gate: 'verdict-test-integrity', passed: false, duration: Date.now() - start, reason: 'No assertions found in new test code' };

  return { gate: 'verdict-test-integrity', passed: true, duration: Date.now() - start, reason: `${assertionLines.length} real assertions found` };
}

export async function gateTraceCorePatterns(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'trace-core-patterns', passed: true, duration: Date.now() - start, reason: 'No diff to check' };

  const findings: Array<{ pattern: string; category: string; severity: string }> = [];
  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));

  for (const line of addedLines) {
    for (const fp of AI_FAILURE_PATTERNS) {
      if (fp.pattern.test(line)) {
        findings.push({ pattern: fp.pattern.toString(), category: fp.category, severity: fp.severity });
      }
    }
  }

  if (findings.length > 0) {
    const highSeverity = findings.filter(f => f.severity === 'high');
    const details = findings.map(f => `[${f.severity}] ${f.category}: ${f.pattern}`).join('\n');
    if (highSeverity.length > 0) {
      return { gate: 'trace-core-patterns', passed: false, duration: Date.now() - start, reason: `${highSeverity.length} high-severity AI failure patterns detected`, details };
    }
    return { gate: 'trace-core-patterns', passed: true, duration: Date.now() - start, reason: `${findings.length} low/medium patterns (non-blocking)`, details };
  }

  return { gate: 'trace-core-patterns', passed: true, duration: Date.now() - start, reason: 'No AI failure patterns detected' };
}

export async function gateSyntheticDataCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) {
    return { gate: 'synthetic-data-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const addedCode = addedLines.join('\n');

  const hasLargeInlineArray = DATA_PATTERN_RE.test(addedCode);
  const hasApiClaim = API_CLAIM_RE.test(addedCode);
  const hasFetchCall = FETCH_CALL_RE.test(addedCode);
  const hasDbQuery = DB_QUERY_RE.test(addedCode);

  const warnings: string[] = [];

  if (hasLargeInlineArray && !hasFetchCall && !hasDbQuery) {
    warnings.push('Large inline data array (>5 rows) detected without matching fetch/DB call — possible hardcoded synthetic data');
  }

  const apiClaimMatches = addedCode.match(/(?:fetch|get|query|retrieve)\s+\w+/gi) || [];
  if (apiClaimMatches.length > 0 && !hasFetchCall && !hasDbQuery) {
    warnings.push(`Code claims to "${apiClaimMatches[0]}" but no fetch/axios/http call found in diff — possible fake data claim`);
  }

  const nullCount = (addedCode.match(/\bnull\b/g) || []).length;
  if (addedCode.length > 200 && nullCount === 0 && hasLargeInlineArray) {
    const nonNullCheck = addedCode.match(/\w+\s*!==\s*null|\w+\s*!=\s*null|\.filter|\?\./g);
    if (!nonNullCheck || nonNullCheck.length < 2) {
      warnings.push('Inline data has zero null checks and no null values — suspicious uniformity (real data has nulls)');
    }
  }

  const sampleData = addedCode.match(/"\w+":\s*"(?:test|foo|bar|example|sample)"/gi);
  if (sampleData && sampleData.length > 3) {
    warnings.push(`${sampleData.length} placeholder values (test/foo/bar/example) detected in generated data — possible synthetic data`);
  }

  if (warnings.length > 0) {
    return {
      gate: 'synthetic-data-check',
      passed: false,
      duration: Date.now() - start,
      reason: warnings.join('; '),
      details: warnings.join('\n'),
    };
  }

  return { gate: 'synthetic-data-check', passed: true, duration: Date.now() - start, reason: 'No synthetic data patterns detected' };
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
    () => gateHallucinationGrep(sandbox, diff),
    () => gateGhostcheck(sandbox, diff),
    () => gateVerdictTestIntegrity(sandbox, diff),
    () => gateTraceCorePatterns(sandbox, diff),
    () => gateSyntheticDataCheck(sandbox, diff),
  ];

  const results = await Promise.all(
    gateFns.map(async (gateFn) => {
      try { return await gateFn(); }
      catch (err) { return { gate: 'unknown', passed: false, duration: Date.now() - start, reason: `Gate threw: ${String(err)}` } as GateResult; }
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
