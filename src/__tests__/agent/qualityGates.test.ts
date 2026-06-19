import { describe, expect, it, vi } from 'vitest';
import {
  gateRealityCheck,
  gateCompileCheck,
  gateTestCheck,
  gateHallucinationCheck,
  runQualityGates,
} from '../../agent/qualityGates.js';
import type { SandboxExecutor } from '../../sandbox/types.js';

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
  });

  it('fails when a referenced file does not exist', async () => {
    const diff = `+ import { foo } from './src/utils/nonexistent.ts'\n+ const x = require('src/utils/also-missing.ts')`;
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('nonexistent');
  });

  it('passes when all referenced files exist', async () => {
    const diff = '+ import { foo } from `src/utils/existing.ts`';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 }),
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe('gateCompileCheck', () => {
  it('passes when tsc has no errors', async () => {
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'No errors found', stderr: '', exitCode: 0 }),
    });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(true);
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
    expect(result.reason).toContain('error');
  });
});

describe('gateTestCheck', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateTestCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('fails on vacuous expect(true).toBe(true)', async () => {
    const diff = `+  it('should work', () => {\n+    expect(true).toBe(true);\n+  });`;
    const sandbox = mockSandbox();
    const result = await gateTestCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Vacuous');
  });

  it('passes with real assertions', async () => {
    const diff = `+  it('should return correct result', () => {\n+    const result = add(2, 3);\n+    expect(result).toBe(5);\n+  });\n+  it('should handle null', () => {\n+    expect(parse(null)).toBeNull();\n+  });`;
    const sandbox = mockSandbox();
    const result = await gateTestCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('fails when no assertions found in added code', async () => {
    const diff = `+  it('should pass', () => {\n+    const x = 1;\n+  });`;
    const sandbox = mockSandbox();
    const result = await gateTestCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('No assertions');
  });
});

describe('gateHallucinationCheck', () => {
  it('passes when no diff is provided', async () => {
    const sandbox = mockSandbox();
    const result = await gateHallucinationCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('passes when packages are in package.json', async () => {
    const diff = "+ import { z } from 'zod'";
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ dependencies: { zod: '^3.0.0' } }),
        stderr: '',
        exitCode: 0,
      }),
    });
    const result = await gateHallucinationCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('flags unknown npm packages', async () => {
    const diff = "+ import { parseFlow } from 'nonexistent-analysis-pkg'";
    const sandbox = mockSandbox();
    const execMock = vi.fn()
      .mockResolvedValueOnce({ stdout: '{}', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'npm ERR! 404 Not Found', exitCode: 1 });
    sandbox.exec = execMock;
    const result = await gateHallucinationCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('nonexistent-analysis-pkg');
  });
});

describe('runQualityGates', () => {
  it('runs all 4 gates and passes when all pass', async () => {
    const diff = '+ import { foo } from `src/utils/existing.ts`';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 }),
    });
    const result = await runQualityGates(sandbox, diff);
    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(4);
  });

  it('reports failure when any gate fails', async () => {
    const diff = '+ import { parseFlow } from `src/utils/nonexistent.ts`';
    const sandbox = mockSandbox({
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    });
    const result = await runQualityGates(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.gates.some(g => !g.passed)).toBe(true);
  });

  it('tracks retry count', async () => {
    const sandbox = mockSandbox();
    const result = await runQualityGates(sandbox, '', 2, 3);
    expect(result.retryCount).toBe(2);
    expect(result.maxRetries).toBe(3);
    expect(result.canRetry).toBe(true);
  });

  it('canRetry is false when retries exhausted', async () => {
    const sandbox = mockSandbox();
    const result = await runQualityGates(sandbox, '', 3, 3);
    expect(result.canRetry).toBe(false);
  });
});
