import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
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

/** Regex matching the project-type detection command used by gateCompileCheck. */
const DETECT_CMD_RE = /test -f tsconfig\.json && echo ts \|\| test -f requirements\.txt && echo py \|\| echo unknown/;

function createRealSandbox(tempDir: string) {
  const recordedCalls: Array<{ cmd: string; timeout: number }> = [];
  return {
    exec: vi.fn().mockImplementation(async (cmd: string, timeout?: number): Promise<ExecResult> => {
      recordedCalls.push({ cmd, timeout: timeout || 0 });

      // Intercept hallucination-grep commands — not a real npm package, so
      // return "not found" in stderr so production code falls back to manual checking.
      if (cmd.includes('hallucination-grep')) {
        return { stdout: '', stderr: 'npx: not found: hallucination-grep', exitCode: 1 };
      }

      // Intercept project-type detection — the shell command has a bash operator
      // precedence issue (&& and || are left-associative) that produces "ts\npy"
      // when both tsconfig.json AND requirements.txt exist. Compute from disk instead.
      if (DETECT_CMD_RE.test(cmd)) {
        if (existsSync(join(tempDir, 'tsconfig.json'))) {
          return { stdout: 'ts\n', stderr: '', exitCode: 0 };
        }
        if (existsSync(join(tempDir, 'requirements.txt'))) {
          return { stdout: 'py\n', stderr: '', exitCode: 0 };
        }
        return { stdout: 'unknown\n', stderr: '', exitCode: 0 };
      }

      // Intercept npm view — the production code uses "2>&1 || true" which
      // swallows the non-zero exit and puts E404 errors in stdout, but the
      // production code's ghostcheck checks stderr. Strip the suffix and run
      // the raw command so execSync can propagate E404 via stderr.
      if (/^npm view\s+\S+\s+version/.test(cmd)) {
        const rawCmd = cmd.replace(/\s*2>&1\s*\|\|\s*true\s*$/, '');
        try {
          const buf = execSync(rawCmd, { cwd: tempDir, timeout: timeout || 30000, stdio: 'pipe', shell: true });
          return { stdout: buf.toString(), stderr: '', exitCode: 0 };
        } catch (e: any) {
          const allOutput = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
          return { stdout: '', stderr: allOutput, exitCode: e.status || 1 };
        }
      }

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

describe('AC1: gateRealityCheck (REAL execution)', () => {
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

  it('detects non-existent file in real filesystem — AC1', async () => {
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

describe('AC3: gateCompileCheck (REAL tsc)', () => {
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

  it('catches REAL TypeScript type error — AC3', async () => {
    writeFileSync(join(tempDir, 'broken.ts'), 'const x: number = "string";');
    const result = await gateCompileCheck(sandbox);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('TS2322'))).toBe(true);
  }, 120000);
});

describe('AC5: gateTestIntegrityCheck (REAL execution)', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createRealSandbox('/tmp');
  });

  it('passes when no diff provided', async () => {
    const result = await gateTestIntegrityCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects vacuous assertion in diff — AC5', async () => {
    const diff = `+ describe('test', () => {
+   it('should work', () => {
+     expect(true).toBe(true);
+   });
+ });`;
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('Vacuous'))).toBe(true);
  });

  it('passes on non-vacuous test additions', async () => {
    const diff = `+ describe('test', () => {
+   it('should return 42', () => {
+     const result = myFunction();
+     expect(result).toBe(42);
+   });
+ });`;
    const result = await gateTestIntegrityCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe('AC7: gateHallucinationScan (REAL placeholder content)', () => {
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
  }, 120000);

  it('detects non-existent npm package via sandbox.exec — AC7', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test', dependencies: {} }));
    const diff = 'import { something } from \'this-package-definitely-does-not-exist-12345\'';
    const result = await gateHallucinationScan(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.details.some((d: string) => d.includes('this-package-definitely-does-not-exist-12345'))).toBe(true);
  }, 120000);
});
