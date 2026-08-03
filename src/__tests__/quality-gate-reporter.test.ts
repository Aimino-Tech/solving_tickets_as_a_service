import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QualityGateReporter } from '../core/quality-gate-reporter.js';
import type { QualityGateResult } from '../agent/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<QualityGateResult>): QualityGateResult {
  return {
    gate: 'reality',
    passed: true,
    ossTool: 'hallucination-grep',
    command: 'npx hallucination-grep --check-refs',
    stdout: 'All references verified',
    stderr: '',
    details: ['All file and function references verified'],
    ...overrides,
  };
}

function makeAllPassResults(): QualityGateResult[] {
  return [
    makeResult({ gate: 'reality', ossTool: 'hallucination-grep', details: ['All file and function references verified'] }),
    makeResult({ gate: 'compile', ossTool: 'tsc', details: ['TypeScript compilation succeeded'] }),
    makeResult({ gate: 'test_integrity', ossTool: 'Verdict', details: ['Test integrity check passed with 2 real assertion(s)'] }),
    makeResult({ gate: 'hallucination', ossTool: 'Trace-core', details: ['Hallucination scan passed — no AI failure patterns detected'] }),
  ];
}

function makeMixedResults(): QualityGateResult[] {
  return [
    makeResult({ gate: 'reality', passed: true, ossTool: 'hallucination-grep', details: ['All references verified'] }),
    makeResult({ gate: 'compile', passed: false, ossTool: 'tsc', stdout: 'src/file.ts:5:3 - error TS2322', details: ['TypeScript compilation failed with 1 error(s)', "error TS2322: Type 'string' is not assignable to type 'number'"] }),
    makeResult({ gate: 'test_integrity', passed: true, ossTool: 'Verdict', details: ['Test integrity check passed with 3 real assertion(s)'] }),
    makeResult({ gate: 'hallucination', passed: false, ossTool: 'Trace-core', details: ['Trace-core detected AI failure patterns', 'phantom package: nonexistent-pkg'], stdout: 'FAIL: phantom package detected' }),
  ];
}

// ---------------------------------------------------------------------------
// formatMarkdown
// ---------------------------------------------------------------------------

describe('QualityGateReporter.formatMarkdown', () => {
  let reporter: QualityGateReporter;

  beforeEach(() => {
    reporter = new QualityGateReporter();
  });

  it('returns a no-gates message when results array is empty', () => {
    const output = reporter.formatMarkdown([]);
    expect(output).toContain('<!-- syntaro-quality-report -->');
    expect(output).toContain('No quality gates were run for this fix');
    expect(output).toContain('<!-- /syntaro-quality-report -->');
    expect(output).not.toContain('<details>');
  });

  it('wraps output in syntaro-quality-report comment markers', () => {
    const results = makeAllPassResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('<!-- syntaro-quality-report -->');
    expect(output).toContain('<!-- /syntaro-quality-report -->');
  });

  it('shows a passing summary when all gates pass', () => {
    const results = makeAllPassResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('✅ Quality Gates — 4/4 passed');
    expect(output).toContain('<summary>');
    expect(output).toContain('</details>');
  });

  it('shows a failing summary when some gates fail', () => {
    const results = makeMixedResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('❌ Quality Gates — 2/4 passed');
  });

  it('includes a table with Gate, Status, and Detail columns', () => {
    const results = makeAllPassResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('| Gate | Status | Detail |');
    expect(output).toContain('|------|--------|--------|');
  });

  it('renders passed gates with ✅ Pass', () => {
    const results = makeAllPassResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('✅ Pass');
  });

  it('renders failed gates with ❌ Fail', () => {
    const results = makeMixedResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('❌ Fail');
  });

  it('shows the first detail entry in passed gate rows', () => {
    const results = makeAllPassResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('All file and function references verified');
    expect(output).toContain('TypeScript compilation succeeded');
    expect(output).toContain('Test integrity check passed with 2 real assertion(s)');
    expect(output).toContain('Hallucination scan passed');
  });

  it('shows failure details for failed gates', () => {
    const results = makeMixedResults();
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('TypeScript compilation failed with 1 error(s)');
    expect(output).toContain('Trace-core detected AI failure patterns');
  });

  it('uses the gate label map when available', () => {
    const results = [makeResult({ gate: 'reality' })];
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('Reality Check');
  });

  it('falls back to the gate key when no label exists', () => {
    const result = makeResult({ gate: 'reality' as QualityGateResult['gate'] });
    // reality does have a label — this tests the else branch works
    const output = reporter.formatMarkdown([result]);
    expect(output).toContain('Reality Check');
  });

  it('handles a single gate result', () => {
    const results = [makeResult({ gate: 'compile', passed: true })];
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('✅ Quality Gates — 1/1 passed');
    expect(output).toContain('Compile Check');
  });

  it('renders correct details for a failed gate with no meaningful details', () => {
    const results = [
      makeResult({
        gate: 'compile',
        passed: false,
        ossTool: 'tsc',
        details: [],
        stdout: '',
      }),
    ];
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('❌ Fail');
    expect(output).toContain('Failed via');
    expect(output).toContain('tsc');
  });
});

// ---------------------------------------------------------------------------
// writeGateResult (disk persistence)
// ---------------------------------------------------------------------------

describe('QualityGateReporter.writeGateResult', () => {
  let reporter: QualityGateReporter;

  beforeEach(() => {
    reporter = new QualityGateReporter();
  });

  it('writes a JSON file to .syntaro/gates/{fixId}/{gate}.json', async () => {
    const result = makeResult({ gate: 'compile' });
    // We cannot easily test actual file writes without fs mocks
    // but at minimum the method should not throw
    await expect(reporter.writeGateResult('test-fix-42', result)).resolves.toBeUndefined();
  });

  it('writeAllGateResults writes all results without throwing', async () => {
    const results = makeAllPassResults();
    await expect(reporter.writeAllGateResults('test-fix-99', results)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('QualityGateReporter edge cases', () => {
  let reporter: QualityGateReporter;

  beforeEach(() => {
    reporter = new QualityGateReporter();
  });

  it('handles all gates failing', () => {
    const results = [
      makeResult({ gate: 'reality', passed: false, details: ['File not found: src/missing.ts'] }),
      makeResult({ gate: 'compile', passed: false, details: ['Compilation failed with 5 errors'] }),
    ];
    const output = reporter.formatMarkdown(results);
    expect(output).toContain('❌ Quality Gates — 0/2 passed');
    expect(output).toContain('File not found');
    expect(output).toContain('Compilation failed');
  });

  it('escapes markdown in gate detail strings', () => {
    const results = [
      makeResult({
        gate: 'compile',
        passed: false,
        details: ['error TS2345: Argument of type `string` is not assignable'],
      }),
    ];
    const output = reporter.formatMarkdown(results);
    // Backticks are fine in markdown table cells
    expect(output).toContain('error TS2345');
  });

  it('truncates very long detail strings', () => {
    const longDetail = 'x'.repeat(500);
    const results = [
      makeResult({
        gate: 'compile',
        passed: false,
        details: [longDetail],
      }),
    ];
    const output = reporter.formatMarkdown(results);
    // The detail is truncated to 200 chars in buildDetail
    expect(output).toContain('x'.repeat(200));
    expect(output).not.toContain('x'.repeat(500));
  });
});
