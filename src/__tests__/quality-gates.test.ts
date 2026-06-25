import { describe, expect, it, vi } from 'vitest';
import {
  gateRealityCheck,
  gateCompileCheck,
  gateVerdictTestIntegrity,
  gateHallucinationCheck,
  runQualityGates,
} from '../agent/qualityGates.js';
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

describe('gateRealityCheck', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateRealityCheck(sandbox, '');
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('reality-check');
  });

  it('fails when a referenced file does not exist', async () => {
    const diff = '+ import { foo } from `src/utils/nonexistent.ts`\n+ Uses `src/utils/also-missing.ts` for parsing.';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('nonexistent');
  });

  it('passes when diff has no file references', async () => {
    const diff = '+ const x = 1;\n+ console.log("hello");';
    const sandbox = mockSandbox();
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('passes when all referenced files exist', async () => {
    const diff = '+ import { foo } from `src/utils/existing.ts`';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('uses sandbox.exec for checks', async () => {
    const diff = '+ import { bar } from `src/services/worker.ts`';
    const execMock = vi.fn().mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 });
    const sandbox = mockSandbox({ exec: execMock });
    await gateRealityCheck(sandbox, diff);
    expect(execMock.mock.calls.some(([cmd]: [string]) => cmd.includes('test -f'))).toBe(true);
  });
});

describe('gateCompileCheck', () => {
  it('passes when tsc has no errors', async () => {
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('compile-check');
  });

  it('fails when tsc reports errors', async () => {
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({
        stdout: "src/file.ts:5:3 - error TS2322: Type 'string' is not assignable to type 'number'",
        stderr: '',
        exitCode: 2,
      }),
    });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(false);
    expect(result.details).toContain('TS2322');
  });

  it('uses sandbox.exec for compilation', async () => {
    const execMock = vi.fn().mockResolvedValue({ stdout: 'No errors', stderr: '', exitCode: 0 });
    const sandbox = mockSandbox({ exec: execMock });
    await gateCompileCheck(sandbox);
    expect(execMock.mock.calls.some(([cmd]: [string]) => cmd.includes('tsc --noEmit'))).toBe(true);
  });
});

describe('gateVerdictTestIntegrity', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateVerdictTestIntegrity(sandbox, '');
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('verdict-test-integrity');
  });

  it('fails on vacuous test with no assertions', async () => {
    const diff = '+  it("should do something", () => {\n+    console.log("testing");\n+  });';
    const sandbox = mockSandbox();
    const result = await gateVerdictTestIntegrity(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('assertion');
  });

  it('fails on vacuous expect(true).toBe(true)', async () => {
    const diff = '+  it("should work", () => {\n+    expect(true).toBe(true);\n+  });';
    const sandbox = mockSandbox();
    const result = await gateVerdictTestIntegrity(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Vacuous');
  });

  it('passes with real assertions', async () => {
    const diff = '+  it("should return correct result", () => {\n+    const result = add(2, 3);\n+    expect(result).toBe(5);\n+  });\n+  it("should handle null", () => {\n+    expect(parse(null)).toBeNull();\n+  });';
    const sandbox = mockSandbox();
    const result = await gateVerdictTestIntegrity(sandbox, diff);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('assertions');
  });
});

describe('gateHallucinationCheck', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateHallucinationCheck(sandbox, '');
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('hallucination-check');
  });

  it('passes when no external imports are present', async () => {
    const sandbox = mockSandbox();
    const result = await gateHallucinationCheck(sandbox, '+ const x = 1;');
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('No new external imports');
  });

  it('detects non-existent npm packages', async () => {
    const diff = "+ import { parseFlow } from 'nonexistent-analysis-pkg'";
    const execMock = vi.fn()
      .mockResolvedValueOnce({ stdout: '{}', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'npm ERR! code E404', exitCode: 1 });
    const sandbox = mockSandbox({ exec: execMock });
    const result = await gateHallucinationCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('nonexistent-analysis-pkg');
  });

  it('passes when all imports resolve to known packages', async () => {
    const diff = "+ import { something } from 'lodash'";
    const execMock = vi.fn()
      .mockResolvedValueOnce({ stdout: JSON.stringify({ dependencies: { lodash: '^4.17.21' } }), stderr: '', exitCode: 0 });
    const sandbox = mockSandbox({ exec: execMock });
    const result = await gateHallucinationCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('uses sandbox.exec for npm package verification', async () => {
    const diff = "+ import { parseFlow } from 'some-unknown-pkg'";
    const execMock = vi.fn()
      .mockResolvedValueOnce({ stdout: '{}', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'npm ERR! 404', exitCode: 1 });
    const sandbox = mockSandbox({ exec: execMock });
    await gateHallucinationCheck(sandbox, diff);
    expect(execMock.mock.calls.some(([cmd]: [string]) => cmd.includes('npm view'))).toBe(true);
  });
});

describe('runQualityGates', () => {
  it('runs all 4 gates and returns results', async () => {
    const diff = '+ const x = 1;';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const result = await runQualityGates(sandbox, diff);
    expect(result.gates).toHaveLength(4);
    expect(result.gates.map(r => r.gate)).toEqual(['reality-check', 'compile-check', 'test-check', 'hallucination-check']);
  });

  it('all gates return GateResult type', async () => {
    const diff = '+ const x = 1;';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const result = await runQualityGates(sandbox, diff);
    for (const r of result.gates) {
      expect(r).toHaveProperty('gate');
      expect(r).toHaveProperty('passed');
      expect(r).toHaveProperty('duration');
    }
  });

  it('runs gates concurrently', async () => {
    const diff = '+ const x = 1;';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const start = Date.now();
    await runQualityGates(sandbox, diff);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
