import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  gateRealityCheck,
  gateCompileCheck,
  gateTestCheck,
  gateHallucinationCheck,
  runQualityGates,
} from '../../agent/qualityGates.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function createRealSandbox(tempDir: string) {
  const recordedCalls: Array<{ cmd: string; timeout: number }> = [];
  return {
    exec: vi.fn().mockImplementation(async (cmd: string, timeout?: number): Promise<ExecResult> => {
      recordedCalls.push({ cmd, timeout: timeout || 0 });
      try {
        const result = execSync(cmd, { cwd: tempDir, timeout: timeout || 30000, stdio: 'pipe' });
        return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: 0 };
      } catch (e: any) {
        return { stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '', exitCode: e.status || 1 };
      }
    }),
    getRecordedCalls: () => recordedCalls,
  } as any;
}

describe('gateRealityCheck (REAL execution)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-reality-'));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when no diff is provided', async () => {
    const result = await gateRealityCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects non-existent file in real filesystem', async () => {
    writeFileSync(join(tempDir, 'real.ts'), 'export const x = 1;');
    const diff = '+ import { foo } from `src/real.ts`\n+ import { bar } from `src/fake.ts`';
    sandbox.exec.mockImplementation(async (cmd: string) => {
      const parts = cmd.match(/test -f '([^']+)'/);
      if (parts) {
        const filePath = join(tempDir, parts[1]);
        try {
          const result = execSync(`test -f '${filePath}' && echo EXISTS || echo MISSING`, { cwd: tempDir });
          return { stdout: result.toString().trim(), stderr: '', exitCode: 0 };
        } catch {
          return { stdout: 'MISSING', stderr: '', exitCode: 1 };
        }
      }
      return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('fake');
  });

  it('passes when all files exist in real filesystem', async () => {
    mkdirSync(join(tempDir, 'src/utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src/utils/existing.ts'), 'export const x = 1;');
    const diff = '+ import { foo } from `src/utils/existing.ts`';
    sandbox.exec.mockImplementation(async (cmd: string) => {
      return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe('gateCompileCheck (REAL execution)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-tsc-'));
    writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        strict: true,
        noEmit: true,
      },
    }));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when tsc has no errors', async () => {
    writeFileSync(join(tempDir, 'valid.ts'), 'const x: number = 1;');
    sandbox.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(true);
  });

  it('detects real TypeScript type error', async () => {
    writeFileSync(join(tempDir, 'broken.ts'), 'const x: number = "string";');
    let stderr = '';
    try {
      execSync('npx tsc --noEmit --project tsconfig.json 2>&1', { cwd: tempDir, stdio: 'pipe' });
    } catch (e: any) {
      stderr = e.stderr?.toString() || e.stdout?.toString() || '';
    }
    expect(stderr).toMatch(/Type.*string.*number|TS2322/);
  });
});

describe('gateTestCheck (REAL execution)', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createRealSandbox('/tmp');
  });

  it('passes when no diff provided', async () => {
    const result = await gateTestCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects vacuous assertion in diff', async () => {
    const diff = `+ describe('test', () => {
+   it('should work', () => {
+     expect(true).toBe(true);
+   });
+ });`;
    const result = await gateTestCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Vacuous');
  });

  it('passes on non-vacuous test additions', async () => {
    const diff = `+ describe('test', () => {
+   it('should return 42', () => {
+     const result = myFunction();
+     expect(result).toBe(42);
+   });
+ });`;
    const result = await gateTestCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe('gateHallucinationCheck (REAL execution)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-npm-'));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when no new imports detected', async () => {
    const result = await gateHallucinationCheck(sandbox, 'console.log("hello")');
    expect(result.passed).toBe(true);
  });

  it('detects non-existent npm package', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test', dependencies: {} }));
    const diff = 'import { something } from \'this-package-definitely-does-not-exist-12345\'';
    const result = await gateHallucinationCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not found');
  });
});

describe('runQualityGates', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    } as any;
  });

  it('runs all gates and returns results', async () => {
    const result = await runQualityGates(sandbox, '', 0, 3);
    expect(result.gates).toHaveLength(4);
    expect(result.retryCount).toBe(0);
    expect(result.maxRetries).toBe(3);
  });

  it('supports retry', async () => {
    const result = await runQualityGates(sandbox, '', 2, 3);
    expect(result.canRetry).toBe(true);
    const exhausted = await runQualityGates(sandbox, '', 3, 3);
    expect(exhausted.canRetry).toBe(false);
  });
});
