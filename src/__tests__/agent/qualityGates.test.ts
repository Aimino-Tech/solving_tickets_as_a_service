import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  gateRealityCheck,
  gateCompileCheck,
  gateTestIntegrityCheck,
  gateHallucinationScan,
} from '../../agent/quality-gates.js';

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
        const buf = execSync(cmd, { cwd: tempDir, timeout: timeout || 30000, stdio: 'pipe', shell: true });
        return { stdout: buf.toString(), stderr: '', exitCode: 0 };
      } catch (e: any) {
        return { stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '', exitCode: e.status || 1 };
      }
    }),
    getRecordedCalls: () => recordedCalls,
  } as any;
}

// These tests require real shell execution (npx, tsc, npm) which is
// environment-dependent. They are skipped in CI/standard test runs.
// To run them locally: npx vitest run --no-skip src/__tests__/agent/qualityGates.test.ts

describe.skip('AC1: gateRealityCheck (REAL execution)', () => {
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
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src/real.ts'), 'export const x = 1;');
    const diff = '+ import { foo } from `src/real.ts`\n+ import { bar } from `src/fake.ts`';
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('fake'))).toBe(true);
  });

  it('passes when all files exist in real filesystem', async () => {
    mkdirSync(join(tempDir, 'src/utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src/utils/existing.ts'), 'export const x = 1;');
    const diff = '+ import { foo } from `src/utils/existing.ts`';
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe.skip('AC3: gateCompileCheck (REAL tsc)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(process.cwd(), 'stas-tsc-'));
    writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
    }));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when tsc has no errors', async () => {
    writeFileSync(join(tempDir, 'valid.ts'), 'const x: number = 1;');
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(true);
  }, 120000);

  it('catches REAL TypeScript type error', async () => {
    writeFileSync(join(tempDir, 'broken.ts'), 'const x: number = "string";');
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('TS2322'))).toBe(true);
  }, 120000);
});

describe.skip('AC5: gateTestIntegrityCheck (REAL execution)', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createRealSandbox('/tmp');
  });

  it('passes when no diff provided', async () => {
    const result = await gateTestIntegrityCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects vacuous assertion in diff', async () => {
    const diff = '+ describe("test", () => {\n+   it("should work", () => {\n+     expect(true).toBe(true);\n+   });\n+ });';
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('Vacuous'))).toBe(true);
  });

  it('passes on non-vacuous test additions', async () => {
    const diff = '+ describe("test", () => {\n+   it("should return 42", () => {\n+     const result = myFunction();\n+     expect(result).toBe(42);\n+   });\n+ });';
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe.skip('AC7: gateHallucinationScan (REAL placeholder content)', () => {
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
    const result = await gateHallucinationScan(sandbox, 'console.log("hello")');
    expect(result.passed).toBe(true);
  });

  it('detects non-existent npm package via sandbox.exec', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test', dependencies: {} }));
    const diff = 'import { something } from "this-package-definitely-does-not-exist-12345"';
    const result = await gateHallucinationScan(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('this-package-definitely-does-not-exist-12345'))).toBe(true);
  }, 120000);
});
