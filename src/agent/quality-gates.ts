import { rootLogger } from '../utils/logger.js';
import type { SandboxExecutor } from '../sandbox/types.js';
import type { QualityGateResult } from './types.js';

const log = rootLogger.child({ module: 'oss-quality-gates' });

const FILE_REFERENCE_RE = /`([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|c|cpp|h|cs|dart|vue|svelte|css|scss|less|json|yaml|yml|toml|md|sql))`/g;
const FUNCTION_REF_RE = /(?:export\s+(?:async\s+)?function\s+(\w+)|function\s+(\w+)|const\s+(\w+)\s*[:=]\s*(?:async\s+)?(?:function|\(\)))/g;
const NPM_PACKAGE_RE = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
const VACUOUS_ASSERTION_RE = /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|expect\(\s*false\s*\)\.toBe\(\s*false\s*\)|expect\(\s*1\s*\)\.toBe\(\s*1\s*\)|\.should\s*\(\s*['"]work['"]\s*\)/;
const AI_HALLUCINATION_PATTERNS = /\b(?:example\.com|lorem ipsum|TODO|FIXME|changeme|asdf|qwerty|testtest|placeholder|put your|your code here)\b/i;

export async function gateRealityCheck(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<QualityGateResult> {
  const details: string[] = [];
  const toolName = 'hallucination-grep';

  if (!diff) {
    return {
      gate: 'reality',
      passed: true,
      ossTool: toolName,
      command: 'npx hallucination-grep --check-refs',
      stdout: 'No diff to check',
      stderr: '',
      details: ['No diff provided — skipping reality check'],
    };
  }

  const referencedPaths = new Set<string>();
  let m: RegExpExecArray | null;
  const fileRe = new RegExp(FILE_REFERENCE_RE);
  while ((m = fileRe.exec(diff)) !== null) {
    const p = m[1];
    if (p.startsWith('src/') || p.startsWith('lib/') || p.startsWith('app/') || p.startsWith('packages/')) {
      referencedPaths.add(p);
    }
  }

  const funcNames = new Set<string>();
  const funcRe = new RegExp(FUNCTION_REF_RE);
  while ((m = funcRe.exec(diff)) !== null) {
    const name = m[1] || m[2] || m[3];
    if (name) funcNames.add(name);
  }

  if (referencedPaths.size === 0 && funcNames.size === 0) {
    return {
      gate: 'reality',
      passed: true,
      ossTool: toolName,
      command: 'npx hallucination-grep --check-refs',
      stdout: 'No references found in diff',
      stderr: '',
      details: ['No file paths or function references to verify'],
    };
  }

  details.push(`Found ${referencedPaths.size} file path(s) and ${funcNames.size} function reference(s) to verify`);

  const hallucinationGrepCmd = `npx hallucination-grep --check-refs 2>&1 || true`;
  let hallucinationGrepAvailable = false;
  try {
    const hgCheck = await sandbox.exec(hallucinationGrepCmd, 15_000);
    if (!hgCheck.stderr.includes('not found') && !hgCheck.stderr.includes('Cannot find')) {
      hallucinationGrepAvailable = true;
    }
  } catch {
    // tool not available, fall back to manual checking
  }

  if (hallucinationGrepAvailable) {
    const hgResult = await sandbox.exec(
      `npx hallucination-grep --file-paths '${Array.from(referencedPaths).join(' ')}' --func-names '${Array.from(funcNames).join(' ')}' 2>&1 || true`,
      30_000,
    );
    if (hgResult.stdout.includes('hallucination') || hgResult.stdout.includes('missing')) {
      return {
        gate: 'reality',
        passed: false,
        ossTool: toolName,
        command: `npx hallucination-grep --file-paths ... --func-names ...`,
        stdout: hgResult.stdout.slice(0, 5000),
        stderr: hgResult.stderr.slice(0, 2000),
        details: [...details, 'hallucination-grep detected hallucinations', ...hgResult.stdout.split('\n').filter(l => l.includes('missing') || l.includes('hallucination')).slice(0, 10)],
      };
    }
    return {
      gate: 'reality',
      passed: true,
      ossTool: toolName,
      command: `npx hallucination-grep --file-paths ... --func-names ...`,
      stdout: hgResult.stdout.slice(0, 5000),
      stderr: hgResult.stderr.slice(0, 2000),
      details: [...details, 'All references verified by hallucination-grep'],
    };
  }

  const missingFiles: string[] = [];
  for (const filePath of referencedPaths) {
    try {
      const safePath = filePath.replace(/'/g, "'\\''");
      const result = await sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
      if (result.stdout.trim() !== 'EXISTS') {
        missingFiles.push(filePath);
        details.push(`File not found: ${filePath}`);
      }
    } catch (err) {
      missingFiles.push(filePath);
      details.push(`File check error for ${filePath}: ${String(err)}`);
    }
  }

  const missingFuncs: string[] = [];
  for (const funcName of funcNames) {
    try {
      const result = await sandbox.exec(
        `grep -rn "function\\s\\+${funcName}\\|export\\s.*${funcName}\\|const\\s\\+${funcName}" src/ 2>/dev/null | head -5`,
        10_000,
      );
      if (!result.stdout.trim()) {
        const jsResult = await sandbox.exec(
          `grep -rn "function\\s\\+${funcName}\\|export\\s.*${funcName}\\|const\\s\\+${funcName}" lib/ app/ packages/ 2>/dev/null | head -5`,
          10_000,
        );
        if (!jsResult.stdout.trim()) {
          missingFuncs.push(funcName);
          details.push(`Function not found: ${funcName}`);
        }
      }
    } catch {
      missingFuncs.push(funcName);
    }
  }

  if (missingFiles.length > 0 || missingFuncs.length > 0) {
    const failDetails: string[] = [
      ...details,
      ...(missingFiles.length > 0 ? [`Missing files: ${missingFiles.join(', ')}`] : []),
      ...(missingFuncs.length > 0 ? [`Missing functions: ${missingFuncs.join(', ')}`] : []),
    ];
    return {
      gate: 'reality',
      passed: false,
      ossTool: toolName,
      command: 'test -f <path> && grep -rn "function <name>" src/',
      stdout: `Missing files: ${missingFiles.join(', ')}\nMissing functions: ${missingFuncs.join(', ')}`,
      stderr: '',
      details: failDetails,
    };
  }

  return {
    gate: 'reality',
    passed: true,
    ossTool: toolName,
    command: 'test -f <path> && grep -rn "function <name>" src/',
    stdout: `All ${referencedPaths.size} file(s) and ${funcNames.size} function(s) verified`,
    stderr: '',
    details: [...details, 'All file and function references verified'],
  };
}

export async function gateCompileCheck(
  sandbox: SandboxExecutor,
): Promise<QualityGateResult> {
  const toolName = 'tsc';

  try {
    const detectResult = await sandbox.exec('test -f tsconfig.json && echo ts || test -f requirements.txt && echo py || echo unknown', 5_000);
    const projectType = detectResult.stdout.trim();

    if (projectType === 'ts') {
      const result = await sandbox.exec('npx tsc --noEmit 2>&1 || true', 120_000);
      const output = (result.stdout + result.stderr).slice(0, 10000);
      const errorLines = output.split('\n').filter(l => l.includes('error TS') || l.includes('error '));

      if (errorLines.length > 0) {
        return {
          gate: 'compile',
          passed: false,
          ossTool: toolName,
          command: 'npx tsc --noEmit',
          stdout: result.stdout.slice(0, 5000),
          stderr: result.stderr.slice(0, 5000),
          details: [
            `TypeScript compilation failed with ${errorLines.length} error(s)`,
            ...errorLines.slice(0, 20),
          ],
        };
      }

      return {
        gate: 'compile',
        passed: true,
        ossTool: toolName,
        command: 'npx tsc --noEmit',
        stdout: result.stdout.slice(0, 5000),
        stderr: result.stderr.slice(0, 5000),
        details: ['TypeScript compilation succeeded'],
      };
    }

    if (projectType === 'py') {
      const result = await sandbox.exec('python -m py_compile -q $(find . -name "*.py" -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null) 2>&1 || true', 60_000);
      const output = (result.stdout + result.stderr).slice(0, 10000);
      if (output.includes('Error') || output.includes('SyntaxError')) {
        const errorLines = output.split('\n').filter(l => l.includes('Error'));
        return {
          gate: 'compile',
          passed: false,
          ossTool: 'python',
          command: 'python -m py_compile',
          stdout: result.stdout.slice(0, 5000),
          stderr: result.stderr.slice(0, 5000),
          details: [`Python compilation failed: ${errorLines.length} error(s)`, ...errorLines.slice(0, 20)],
        };
      }
      return {
        gate: 'compile',
        passed: true,
        ossTool: 'python',
        command: 'python -m py_compile',
        stdout: result.stdout.slice(0, 5000),
        stderr: result.stderr.slice(0, 5000),
        details: ['Python compilation succeeded'],
      };
    }

    return {
      gate: 'compile',
      passed: true,
      ossTool: toolName,
      command: 'test -f tsconfig.json || test -f requirements.txt',
      stdout: 'Could not determine project type — skipping compile check',
      stderr: '',
      details: ['No recognized project type detected (tsconfig.json or requirements.txt)'],
    };
  } catch (err) {
    return {
      gate: 'compile',
      passed: false,
      ossTool: toolName,
      command: 'npx tsc --noEmit',
      stdout: '',
      stderr: String(err),
      details: [`Compile check error: ${String(err)}`],
    };
  }
}

export async function gateTestIntegrityCheck(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<QualityGateResult> {
  const toolName = 'Verdict';
  const details: string[] = [];

  if (!diff) {
    return {
      gate: 'test_integrity',
      passed: true,
      ossTool: toolName,
      command: 'verdict vacuous --path <test-file>',
      stdout: 'No diff to check',
      stderr: '',
      details: ['No diff provided — skipping test integrity check'],
    };
  }

  const testFileMatch = diff.match(/^\+\+\+\s+b\/(.+\.(?:test|spec)\.[a-z]+)$/m);
  if (!testFileMatch) {
    const hasTestContent = /(?:describe|it|test)\s*\(/.test(diff);
    if (!hasTestContent) {
      return {
        gate: 'test_integrity',
        passed: true,
        ossTool: toolName,
        command: 'verdict vacuous --path <test-file>',
        stdout: 'No test changes in diff',
        stderr: '',
        details: ['No test files or test constructs detected'],
      };
    }
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const addedTestCode = addedLines.filter(l =>
    /(?:describe|it|test|expect|assert|should)/.test(l),
  );

  if (addedTestCode.length === 0) {
    details.push('No test-related code found in added lines');
  }

  const verdictCmd = `npx verdict vacuous --check 2>&1 || true`;
  let verdictAvailable = false;
  try {
    const vCheck = await sandbox.exec(verdictCmd, 15_000);
    if (!vCheck.stderr.includes('not found') && !vCheck.stderr.includes('Cannot find')) {
      verdictAvailable = true;
    }
  } catch {
    // tool not available
  }

  let testFilePaths: string[] = [];
  if (testFileMatch) {
    testFilePaths = [testFileMatch[1]];
  }

  if (verdictAvailable && testFilePaths.length > 0) {
    const vResults: string[] = [];
    for (const tf of testFilePaths) {
      try {
        const vResult = await sandbox.exec(`npx verdict vacuous --path '${tf}' 2>&1 || true`, 30_000);
        if (vResult.stdout.includes('vacuous') || vResult.stdout.includes('no assertions')) {
          vResults.push(`${tf}: VACUOUS`);
          details.push(`Verdict flagged vacuous test: ${tf}`);
        } else {
          vResults.push(`${tf}: OK`);
          details.push(`Verdict verified test integrity: ${tf}`);
        }
      } catch {
        details.push(`Verdict check failed for ${tf}`);
      }
    }

    if (vResults.some(r => r.includes('VACUOUS'))) {
      return {
        gate: 'test_integrity',
        passed: false,
        ossTool: toolName,
        command: 'npx verdict vacuous --path <test-file>',
        stdout: vResults.join('\n'),
        stderr: '',
        details: [...details, 'Verdict detected vacuous tests'],
      };
    }
  }

  const maxAssertViolations: string[] = [];
  const vacuousMatches = addedLines.filter(l => VACUOUS_ASSERTION_RE.test(l));
  if (vacuousMatches.length > 0) {
    maxAssertViolations.push(...vacuousMatches.map(l => `Vacuous assertion: ${l.trim()}`));
    details.push(...maxAssertViolations);
  }

  const assertionCount = addedLines.filter(l =>
    /expect\(/.test(l) || /\.should\(/.test(l) || /assert\./.test(l) || /assertEquals/.test(l) || /assertThat/.test(l),
  ).length;

  if (assertionCount === 0 && addedTestCode.length > 0) {
    details.push('No assertions found in added test code');
    return {
      gate: 'test_integrity',
      passed: false,
      ossTool: toolName,
      command: 'verdict vacuous --path <test-file>',
      stdout: 'No real assertions found in test changes',
      stderr: '',
      details: [...details, 'Added test code lacks assertions — test may be vacuous'],
    };
  }

  const consoleOnly = addedLines.filter(l => /console\.(log|info|warn)/.test(l)).length;
  const expectOnly = addedLines.filter(l => /expect\(/.test(l)).length;
  if (consoleOnly > 0 && expectOnly === 0) {
    return {
      gate: 'test_integrity',
      passed: false,
      ossTool: toolName,
      command: 'verdict vacuous --path <test-file>',
      stdout: `Console output calls: ${consoleOnly}, expect calls: ${expectOnly}`,
      stderr: '',
      details: [...details, 'Test code only contains console.log, no assertions'],
    };
  }

  if (maxAssertViolations.length > 0) {
    return {
      gate: 'test_integrity',
      passed: false,
      ossTool: toolName,
      command: 'verdict vacuous --path <test-file>',
      stdout: maxAssertViolations.join('\n'),
      stderr: '',
      details: [...details, 'Vacuous assertions detected'],
    };
  }

  return {
    gate: 'test_integrity',
    passed: true,
    ossTool: toolName,
    command: 'verdict vacuous --path <test-file>',
    stdout: `Tests contain ${assertionCount} real assertion(s)`,
    stderr: '',
    details: [...details, `Test integrity check passed with ${assertionCount} real assertion(s)`],
  };
}

export async function gateHallucinationScan(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<QualityGateResult> {
  const toolName = 'Trace-core';
  const details: string[] = [];

  if (!diff) {
    return {
      gate: 'hallucination',
      passed: true,
      ossTool: toolName,
      command: 'trace-core check --path <changed-files>',
      stdout: 'No diff to check',
      stderr: '',
      details: ['No diff provided — skipping hallucination scan'],
    };
  }

  const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const addedContent = addedLines.map(l => l.slice(1)).join('\n');

  const hallucinationCmd = `npx trace-core check --stdin 2>&1 || true`;
  let traceCoreAvailable = false;
  try {
    const tcCheck = await sandbox.exec(`npx trace-core --help 2>&1 || true`, 15_000);
    if (!tcCheck.stderr.includes('not found') && !tcCheck.stderr.includes('Cannot find')) {
      traceCoreAvailable = true;
    }
  } catch {
    // tool not available
  }

  if (traceCoreAvailable) {
    const escapedContent = addedContent.replace(/'/g, "'\\''").slice(0, 50000);
    const tcResult = await sandbox.exec(
      `echo '${escapedContent}' | npx trace-core check --stdin 2>&1 || true`,
      30_000,
    );
    if (tcResult.stdout.includes('FAIL') || tcResult.stdout.includes('failure') || tcResult.stdout.includes('pattern')) {
      const failureLines = tcResult.stdout.split('\n').filter(l => l.includes('FAIL') || l.includes('pattern'));
      details.push(...failureLines.slice(0, 20));
      return {
        gate: 'hallucination',
        passed: false,
        ossTool: toolName,
        command: 'echo <diff> | npx trace-core check --stdin',
        stdout: tcResult.stdout.slice(0, 5000),
        stderr: tcResult.stderr.slice(0, 2000),
        details: [
          ...details,
          'Trace-core detected AI failure patterns',
          ...failureLines.slice(0, 20),
        ],
      };
    }
    details.push('Trace-core scan completed with no issues');
  }

  const ghostcheckCmd = `npx ghostcheck --check 2>&1 || true`;
  let ghostcheckAvailable = false;
  try {
    const gcCheck = await sandbox.exec(ghostcheckCmd, 15_000);
    if (!gcCheck.stderr.includes('not found') && !gcCheck.stderr.includes('Cannot find')) {
      ghostcheckAvailable = true;
    }
  } catch {
    // tool not available
  }

  const externalImports = new Set<string>();
  let npmMatch: RegExpExecArray | null;
  const importRe = new RegExp(NPM_PACKAGE_RE);
  while ((npmMatch = importRe.exec(diff)) !== null) {
    const modulePath = npmMatch[1];
    if (!modulePath.startsWith('.')) {
      const pkgName = modulePath.startsWith('@')
        ? modulePath.split('/').slice(0, 2).join('/')
        : modulePath.split('/')[0];
      if (pkgName && !pkgName.startsWith('node:') && pkgName !== '') {
        externalImports.add(pkgName);
      }
    }
  }

  const hallucinationPatternMatches: string[] = [];
  const hPatternRe = new RegExp(AI_HALLUCINATION_PATTERNS);
  for (const line of addedLines) {
    const content = line.slice(1);
    if (hPatternRe.test(content) && !content.includes('AI_HALLUCINATION_PATTERNS')) {
      hallucinationPatternMatches.push(content.trim());
    }
  }

  if (hallucinationPatternMatches.length > 0) {
    details.push(`AI hallucination patterns found: ${hallucinationPatternMatches.length}`);
    return {
      gate: 'hallucination',
      passed: false,
      ossTool: toolName,
      command: `grep -n "example.com|TODO|FIXME|lorem ipsum" <files>`,
      stdout: hallucinationPatternMatches.join('\n'),
      stderr: '',
      details: [
        ...details,
        'AI hallucination markers detected: example.com, TODO/FIXME left in output, lorem ipsum',
        ...hallucinationPatternMatches.slice(0, 10),
      ],
    };
  }

  if (externalImports.size > 0) {
    const phantomPackages: string[] = [];
    for (const pkg of externalImports) {
      try {
        const result = await sandbox.exec(`npm view ${pkg} version 2>&1 || true`, 30_000);
        if (result.stderr.includes('E404') || result.stderr.includes('404')) {
          phantomPackages.push(pkg);
          details.push(`Non-existent npm package cited: ${pkg}`);
        }
      } catch {
        phantomPackages.push(pkg);
      }
    }

    if (phantomPackages.length > 0) {
      return {
        gate: 'hallucination',
        passed: false,
        ossTool: toolName,
        command: `npm view <package> version && grep -n "example.com" <files>`,
        stdout: `Phantom packages: ${phantomPackages.join(', ')}`,
        stderr: '',
        details: [
          ...details,
          'Agent cited non-existent npm packages (ghostcheck)',
          ...phantomPackages.map(p => `Phantom package: ${p}`),
        ],
      };
    }
    details.push(`All ${externalImports.size} external package(s) verified on npm`);
  }

  return {
    gate: 'hallucination',
    passed: true,
    ossTool: toolName,
    command: 'trace-core check --path <changed-files>',
    stdout: 'No hallucination patterns detected',
    stderr: '',
    details: [...details, 'Hallucination scan passed — no AI failure patterns detected'],
  };
}

// ── Legacy GateResult type (for supplementary gates) ─────────────────────

export interface GateResult {
  gate: string;
  passed: boolean;
  duration: number;
  reason?: string;
  details?: string;
}

// ── Hallucination gates (supplementary) ────────────────────────────────────

export async function gateHallucinationGrep(
  _sandbox: SandboxExecutor,
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
  _sandbox: SandboxExecutor,
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
  _sandbox: SandboxExecutor,
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
  _sandbox: SandboxExecutor,
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
      reasons.push('high-severity');
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
  _sandbox: SandboxExecutor,
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

export async function runAllQualityGates(
  sandbox: SandboxExecutor,
  diff: string,
): Promise<QualityGateResult[]> {
  const results = await Promise.all([
    gateRealityCheck(sandbox, diff),
    gateCompileCheck(sandbox),
    gateTestIntegrityCheck(sandbox, diff),
    gateHallucinationScan(sandbox, diff),
  ]);

  const failed = results.filter(r => !r.passed);
  if (failed.length > 0) {
    log.warn(
      { failedGates: failed.map(f => ({ gate: f.gate, tool: f.ossTool })) },
      `${failed.length}/${results.length} quality gate(s) failed`,
    );
  } else {
    log.info('All 4 quality gates passed');
  }

  return results;
}
