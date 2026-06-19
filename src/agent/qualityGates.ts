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

export async function gateRealityCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'No diff to check' };
  const referencedPaths = new Set<string>();
  let m: RegExpExecArray | null;
  const pathRe = new RegExp(REFERENCED_PATH_RE);
  while ((m = pathRe.exec(diff)) !== null) {
    const path = m[1];
    if (path.startsWith('src/') || path.startsWith('lib/') || path.startsWith('app/') || path.startsWith('packages/')) referencedPaths.add(path);
  }
  const fileRe = new RegExp(FILE_PATH_IN_DIFF_RE);
  while ((m = fileRe.exec(diff)) !== null) { if (m[1].startsWith('.')) referencedPaths.add(m[1]); }
  if (referencedPaths.size === 0) return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'No file references' };
  const missingFiles: string[] = [];
  for (const filePath of referencedPaths) {
    try {
      const safePath = filePath.replace(/'/g, "'\\''");
      const result = await sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
      if (result.stdout.trim() !== 'EXISTS') missingFiles.push(filePath);
    } catch { missingFiles.push(filePath); }
  }
  if (missingFiles.length > 0) return { gate: 'reality-check', passed: false, duration: Date.now() - start, reason: `Missing: ${missingFiles.join(', ')}`, details: missingFiles.join('\n') };
  return { gate: 'reality-check', passed: true, duration: Date.now() - start, reason: 'All files exist' };
}

export async function gateCompileCheck(sandbox: SandboxExecutor): Promise<GateResult> {
  const start = Date.now();
  try {
    const result = await sandbox.exec('npx tsc --noEmit 2>&1 || true', 120_000);
    const output = result.stdout + result.stderr;
    if (output.includes('error')) {
      const errors = output.split('\n').filter(l => l.includes('error')).slice(0, 20);
      return { gate: 'compile-check', passed: false, duration: Date.now() - start, reason: `${errors.length} error(s)`, details: errors.join('\n') };
    }
    return { gate: 'compile-check', passed: true, duration: Date.now() - start, reason: 'Compilation succeeded' };
  } catch (err) {
    return { gate: 'compile-check', passed: false, duration: Date.now() - start, reason: `Error: ${String(err)}` };
  }
}

export async function gateTestCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: 'No diff' };
  if (!/(?:\+|\-)\s*.*(?:describe|it|test)\s*\(/g.test(diff)) return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: 'No test changes' };
  const vp = [/expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/, /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/, /\.should\s*\(\s*['"]work['"]\s*\)/];
  for (const p of vp) { if (p.test(diff)) return { gate: 'test-check', passed: false, duration: Date.now() - start, reason: 'Vacuous assertion', details: `Pattern: ${p}` }; }
  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const assertions = addedLines.filter(l => l.includes('expect(') || l.includes('.should(') || l.includes('assert.'));
  if (assertions.length === 0) return { gate: 'test-check', passed: false, duration: Date.now() - start, reason: 'No assertions' };
  return { gate: 'test-check', passed: true, duration: Date.now() - start, reason: `${assertions.length} assertions` };
}

export async function gateHallucinationCheck(sandbox: SandboxExecutor, diff: string): Promise<GateResult> {
  const start = Date.now();
  if (!diff) return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'No diff' };
  const importRe = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
  const newImports = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(diff)) !== null) {
    const modulePath = m[1];
    if (modulePath.startsWith('.')) continue;
    const pkgName = modulePath.startsWith('@') ? modulePath.split('/').slice(0, 2).join('/') : modulePath.split('/')[0];
    if (pkgName && !pkgName.startsWith('node:')) newImports.add(pkgName);
  }
  if (newImports.size === 0) return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'No new imports' };
  try {
    const pkgResult = await sandbox.exec('cat package.json 2>/dev/null || true', 10_000);
    const pj = JSON.parse(pkgResult.stdout || '{}');
    const allDeps = { ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies };
    const unknown: string[] = [];
    for (const pkg of newImports) {
      if (!allDeps[pkg]) {
        try {
          const npmResult = await sandbox.exec(`npm view ${pkg} version 2>&1 || true`, 30_000);
          if (npmResult.stdout.includes('404') || npmResult.stderr.includes('E404')) unknown.push(pkg);
        } catch { unknown.push(pkg); }
      }
    }
    if (unknown.length > 0) return { gate: 'hallucination-check', passed: false, duration: Date.now() - start, reason: `Unknown packages: ${unknown.join(', ')}`, details: unknown.join('\n') };
    return { gate: 'hallucination-check', passed: true, duration: Date.now() - start, reason: 'All packages known' };
  } catch (err) {
    return { gate: 'hallucination-check', passed: false, duration: Date.now() - start, reason: `Error: ${String(err)}` };
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
    () => gateSyntheticDataCheck(sandbox, diff),
  ];

  const results = await Promise.all(
    gateFns.map(async (gateFn) => {
      try { return await gateFn(); }
      catch (err) { return { gate: 'unknown', passed: false, duration: Date.now() - start, reason: `Error: ${String(err)}` } as GateResult; }
    }),
  );

  for (const result of results) {
    if (!result.passed) { allPassed = false; log.warn({ gate: result.gate, reason: result.reason }, 'Gate failed'); }
  }

  return { passed: allPassed, gates: results, retryCount, maxRetries, canRetry: retryCount < maxRetries };
}
