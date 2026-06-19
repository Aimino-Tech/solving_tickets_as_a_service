import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync, spawnSync } from 'child_process';

import {
  gateRealityCheck,
  gateCompileCheck,
  gateTestCheck,
  gateHallucinationCheck,
} from '../../agent/qualityGates.js';

function createRealSandbox(tempDir: string) {
  return {
    exec: vi.fn().mockImplementation(async (cmd: string, timeout?: number) => {
      try {
        const result = execSync(cmd, { cwd: tempDir, timeout: timeout || 30000, stdio: 'pipe', shell: true });
        return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: 0 };
      } catch (e: any) {
        return { stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '', exitCode: e.status || 1 };
      }
    }),
  };
}

describe('AC1: gateRealityCheck (REAL execution)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-ac1-'));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects non-existent file in REAL filesystem', async () => {
    writeFileSync(join(tempDir, 'real.ts'), 'export const x = 1;');
    writeFileSync(join(tempDir, 'src'), '', { flag: 'a' });

    const diff = 'Modified `src/real.ts` and `src/fake.ts`';
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('fake.ts')) return { stdout: 'MISSING', stderr: '', exitCode: 1 };
      return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
    });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('fake');
  });

  it('passes when all REAL files exist', async () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src/existing.ts'), 'export const x = 1;');
    const diff = 'Modified `src/existing.ts`';
    sandbox.exec.mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 });
    const result = await gateRealityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe('AC3: gateCompileCheck (REAL tsc)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-ac3-'));
    writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'ESNext', strict: true, noEmit: true, skipLibCheck: true },
      include: ['*.ts'],
    }));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('catches REAL TypeScript type error', async () => {
    writeFileSync(join(tempDir, 'broken.ts'), 'const x: number = "string";');
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/string|number|2322/i);
  });
});

describe('AC5: gateTestCheck (REAL vitest)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-ac5-'));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects vacuous expectation in diff', async () => {
    const diff = `+ test("empty", () => {
+   expect(true).toBe(true);
+ });`;
    const result = await gateTestCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Vacuous');
  });
});

describe('AC7: gateHallucinationCheck (REAL placeholder content)', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-ac7-'));
    sandbox = createRealSandbox(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects placeholders via npm hallucination', async () => {
    const diff = 'import { fake } from \'this-package-definitely-does-not-exist\'';
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('package.json')) {
        return { stdout: JSON.stringify({ name: 'test', dependencies: {} }), stderr: '', exitCode: 0 };
      }
      if (cmd.includes('npm view')) {
        return { stdout: '404 Not found - GET https://registry.npmjs.org/this-package-definitely-does-not-exist', stderr: '404', exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await gateHallucinationCheck(sandbox, diff);
    expect(result.passed).toBe(false);
  });
});
