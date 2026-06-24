import { describe, expect, it, vi } from 'vitest';
import {
  gateRealityCheck,
  gateCompileCheck,
  gateTestIntegrityCheck,
  gateHallucinationScan,
  runAllQualityGates,
} from '../agent/quality-gates.js';
import type { SandboxExecutor } from '../sandbox/types.js';

function mockSandbox(overrides?: Partial<SandboxExecutor>): SandboxExecutor {
  return {
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    boot: vi.fn(),
    destroy: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    pushBranch: vi.fn(),
    hasTestSuite: vi.fn().mockReturnValue(true),
    runTests: vi.fn(),
    runSpecificTest: vi.fn(),
    formatCode: vi.fn(),
    analyzeCode: vi.fn(),
    detectRuntime: vi.fn(),
    installDeps: vi.fn(),
    execForTools: vi.fn(),
    ...overrides,
  } as unknown as SandboxExecutor;
}

describe('gateRealityCheck (AC1: hallucination-grep)', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateRealityCheck(sandbox, '');
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('reality');
    expect(result.ossTool).toBe('hallucination-grep');
  });

  it('fails when a referenced file does not exist — AC1', async () => {
    const diff = '+ import { foo } from `src/utils/nonexistent.ts`\n+ Uses `src/utils/also-missing.ts` for parsing.';
    let callCount = 0;
    const sandbox = mockSandbox({
      exec: vi.fn().mockImplementation(async (cmd: string) => {
        callCount++;
        if (callCount === 1) return { stdout: '', stderr: 'command not found', exitCode: 127 };
        return { stdout: 'MISSING', stderr: '', exitCode: 1 };
      }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.ossTool).toBe('hallucination-grep');
    expect(result.details.some(d => d.includes('nonexistent'))).toBe(true);
    expect(result.details.some(d => d.includes('not found'))).toBe(true);
  });

  it('fails when a referenced function does not exist', async () => {
    const diff = '+ Uses `src/utils/helper.ts` which has `export function optimizeResults()`';
    let callCount = 0;
    const sandbox = mockSandbox({
      exec: vi.fn().mockImplementation(async (cmd: string) => {
        callCount++;
        if (callCount === 1) return { stdout: '', stderr: 'command not found', exitCode: 127 };
        if (callCount === 2) return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 1 };
      }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some(d => d.includes('optimizeResults'))).toBe(true);
  });

  it('passes when all referenced files exist', async () => {
    const diff = '+ import { foo } from `src/utils/existing.ts`';
    let callCount = 0;
    const sandbox = mockSandbox({
      exec: vi.fn().mockImplementation(async (cmd: string) => {
        callCount++;
        if (callCount === 1) return { stdout: '', stderr: 'command not found', exitCode: 127 };
        return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
      }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('uses sandbox.exec for all checks — AC8', async () => {
    const diff = '+ import { bar } from `src/services/worker.ts`';
    let callCount = 0;
    const execMock = vi.fn().mockImplementation(async (cmd: string) => {
      callCount++;
      if (callCount === 1) return { stdout: '', stderr: 'command not found', exitCode: 127 };
      return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
    });
    const sandbox = mockSandbox({ exec: execMock });
    await gateRealityCheck(sandbox, diff);
    const execCalls = execMock.mock.calls;
    expect(execCalls.length).toBeGreaterThan(0);
    expect(execCalls.some(([cmd]: [string]) => cmd.includes('test -f'))).toBe(true);
  });
});

describe('gateCompileCheck (AC4: tsc --noEmit)', () => {
  it('passes when tsc has no errors — AC4', async () => {
    const sandbox = mockSandbox({
      exec: vi.fn()
        .mockResolvedValueOnce({ stdout: 'ts', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'No errors found', stderr: '', exitCode: 0 }),
    });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('compile');
    expect(result.ossTool).toBe('tsc');
  });

  it('fails when tsc reports errors — AC4', async () => {
    const sandbox = mockSandbox({
      exec: vi.fn()
        .mockResolvedValueOnce({ stdout: 'ts', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({
          stdout: "src/file.ts:5:3 - error TS2322: Type 'string' is not assignable to type 'number'",
          stderr: '',
          exitCode: 2,
        }),
    });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(false);
    expect(result.details.some(d => d.includes('TS2322'))).toBe(true);
  });

  it('handles Python projects', async () => {
    const sandbox = mockSandbox({
      exec: vi.fn()
        .mockResolvedValueOnce({ stdout: 'py', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(true);
    expect(result.ossTool).toBe('python');
  });

  it('uses sandbox.exec for compilation — AC8', async () => {
    const execMock = vi.fn()
      .mockResolvedValueOnce({ stdout: 'ts', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'No errors', stderr: '', exitCode: 0 });
    const sandbox = mockSandbox({ exec: execMock });
    await gateCompileCheck(sandbox);
    expect(execMock.mock.calls.some(([cmd]: [string]) => cmd.includes('tsc --noEmit'))).toBe(true);
  });
});

describe('gateTestIntegrityCheck (AC3: Verdict)', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateTestIntegrityCheck(sandbox, '');
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('test_integrity');
    expect(result.ossTool).toBe('Verdict');
  });

  it('fails on vacuous test with no assertions — AC3', async () => {
    const diff = '+  it("should do something", () => {\n+    console.log("testing");\n+  });';
    const sandbox = mockSandbox();
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some(d => d.includes('console.log') || d.includes('no assertions') || d.includes('vacuous'))).toBe(true);
  });

  it('fails on vacuous expect(true).toBe(true)', async () => {
    const diff = '+  it("should work", () => {\n+    expect(true).toBe(true);\n+  });';
    const sandbox = mockSandbox();
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some(d => d.includes('Vacuous'))).toBe(true);
  });

  it('passes with real assertions', async () => {
    const diff = '+  it("should return correct result", () => {\n+    const result = add(2, 3);\n+    expect(result).toBe(5);\n+  });\n+  it("should handle null", () => {\n+    expect(parse(null)).toBeNull();\n+  });';
    const sandbox = mockSandbox();
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
    expect(result.details.some(d => d.includes('2 real assertion'))).toBe(true);
  });

  it('uses sandbox.exec for Verdict — AC8', async () => {
    const diff = '+ it("test", () => { expect(x).toBe(y); });';
    const execMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'not found', exitCode: 1 });
    const sandbox = mockSandbox({ exec: execMock });
    await gateTestIntegrityCheck(sandbox, diff);
    expect(execMock.mock.calls.some(([cmd]: [string]) => cmd.includes('verdict'))).toBe(true);
  });
});

describe('gateHallucinationScan', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateHallucinationScan(sandbox, '');
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('hallucination');
    expect(result.ossTool).toBe('Trace-core');
  });

  it('detects AI hallucination patterns (example.com, TODO) — AC2', async () => {
    const diff = '+ const url = "https://example.com/api"\n+ // TODO: implement error handling';
    let callCount = 0;
    const sandbox = mockSandbox({
      exec: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) return { stdout: '', stderr: 'command not found', exitCode: 127 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }),
    });
    const result = await gateHallucinationScan(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some(d => d.includes('example.com') || d.includes('hallucination'))).toBe(true);
  });

  it('detects non-existent npm packages via sandbox.exec — AC2', async () => {
    const diff = "+ import { parseFlow } from 'nonexistent-analysis-pkg'";
    const sandbox = mockSandbox();
    let callCount = 0;
    const execMock = vi.fn().mockImplementation(async (cmd: string) => {
      callCount++;
      if (callCount === 1) return { stdout: '', stderr: 'command not found', exitCode: 127 };
      if (callCount === 2) return { stdout: '', stderr: 'command not found', exitCode: 127 };
      if (callCount === 3) return { stdout: '', stderr: 'npm ERR! 404 Not Found', exitCode: 1 };
      return { stdout: '', stderr: 'npm ERR! 404 Not Found', exitCode: 1 };
    });
    sandbox.exec = execMock;
    const result = await gateHallucinationScan(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some(d => d.includes('nonexistent-analysis-pkg'))).toBe(true);
  });

  it('passes with clean diff — no hallucination patterns', async () => {
    const diff = '+ const result = calculateSum(items);\n+ expect(result).toBe(42);';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: 'command not found', exitCode: 127 }),
    });
    const result = await gateHallucinationScan(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('uses sandbox.exec for Trace-core and npm — AC8', async () => {
    const diff = '+ const x = 1;';
    const execMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'command not found', exitCode: 127 });
    const sandbox = mockSandbox({ exec: execMock });
    await gateHallucinationScan(sandbox, diff);
    const execCalls = execMock.mock.calls.map(([cmd]: [string]) => cmd);
    expect(execCalls.some(c => c.includes('trace-core'))).toBe(true);
    expect(execCalls.some(c => c.includes('ghostcheck'))).toBe(true);
  });
});

describe('runAllQualityGates (AC5: parallel execution)', () => {
  it('runs all 4 gates and returns results', async () => {
    const diff = '+ const x = 1;';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const results = await runAllQualityGates(sandbox, diff);
    expect(results).toHaveLength(4);
    expect(results.map(r => r.gate)).toEqual(['reality', 'compile', 'test_integrity', 'hallucination']);
  });

  it('all gates return QualityGateResult type — AC9', async () => {
    const diff = '+ const x = 1;';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const results = await runAllQualityGates(sandbox, diff);
    for (const r of results) {
      expect(r).toHaveProperty('gate');
      expect(r).toHaveProperty('passed');
      expect(r).toHaveProperty('ossTool');
      expect(r).toHaveProperty('command');
      expect(r).toHaveProperty('stdout');
      expect(r).toHaveProperty('stderr');
      expect(r).toHaveProperty('details');
      expect(Array.isArray(r.details)).toBe(true);
    }
  });

  it('runs gates concurrently — AC5', async () => {
    const diff = '+ const x = 1;';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const start = Date.now();
    await runAllQualityGates(sandbox, diff);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
