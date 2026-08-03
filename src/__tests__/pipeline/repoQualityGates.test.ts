import { describe, expect, it } from 'vitest';
import { runRepoQualityGates } from '../../pipeline/repoQualityGates.js';

function makeExecFn(overrides: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>) {
  return async (cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    for (const [needle, result] of Object.entries(overrides)) {
      if (cmd.includes(needle)) {
        return {
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: result.exitCode ?? 0,
        };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

describe('runRepoQualityGates (AIM-4496)', () => {
  it('passes when all 6 gates are clean', async () => {
    const execFn = makeExecFn({
      'tsconfig.json': { stdout: 'ts' },
      'tsc --noEmit': { stdout: '', exitCode: 0 },
      'knip.json': { stdout: 'yes' },
      'knip --no-progress': { stdout: '', exitCode: 0 },
      'biome.json': { stdout: 'yes' },
      'biome check': { stdout: '', exitCode: 0 },
      gitleaks: { stdout: 'no' },
      'find .*test': { stdout: '', exitCode: 0 },
    });
    const report = await runRepoQualityGates({ execFn, repoDir: '/tmp/repo' });
    expect(report.passed).toBe(true);
    expect(report.gates).toHaveLength(6);
  });

  it('fails when tsc reports type errors (compile gate)', async () => {
    const execFn = makeExecFn({
      'tsconfig.json': { stdout: 'ts' },
      'tsc --noEmit': { stdout: 'src/x.ts(1,1): error TS2322: Type mismatch', exitCode: 1 },
    });
    const report = await runRepoQualityGates({ execFn, repoDir: '/tmp/repo' });
    expect(report.passed).toBe(false);
    const compile = report.gates.find((g) => g.gate === 'compile');
    expect(compile?.passed).toBe(false);
  });

  it('fails when a test file has a vacuous assertion', async () => {
    const execFn = makeExecFn({
      'find /tmp/repo': { stdout: '/tmp/repo/a.test.ts' },
      'cat "/tmp/repo/a.test.ts"': { stdout: 'expect(true).toBe(true)' },
    });
    const report = await runRepoQualityGates({ execFn, repoDir: '/tmp/repo' });
    const vacuous = report.gates.find((g) => g.gate === 'vacuous-test');
    expect(vacuous?.passed).toBe(false);
  });

  it('fails when gitleaks detects a secret', async () => {
    const execFn = makeExecFn({
      'gitleaks detect': { stdout: 'Finding:    1: ghp_1234567890abcdefghijklmnopqrstuvwxyz', exitCode: 1 },
      gitleaks: { stdout: 'yes' },
    });
    const report = await runRepoQualityGates({ execFn, repoDir: '/tmp/repo' });
    const secret = report.gates.find((g) => g.gate === 'secret');
    expect(secret?.passed).toBe(false);
  });

  it('reports summary with passed counts', async () => {
    const execFn = makeExecFn({
      'tsconfig.json': { stdout: 'ts' },
      'tsc --noEmit': { stdout: '', exitCode: 0 },
      'knip.json': { stdout: 'yes' },
      'knip --no-progress': {
        stdout: 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\nsrc/f.ts',
        exitCode: 0,
      },
      'biome.json': { stdout: 'yes' },
      'biome check': { stdout: '2 errors', exitCode: 1 },
      gitleaks: { stdout: 'no' },
    });
    const report = await runRepoQualityGates({ execFn, repoDir: '/tmp/repo' });
    expect(report.passed).toBe(false);
    expect(report.summary).toContain('6 repo quality gates');
    const deadCode = report.gates.find((g) => g.gate === 'dead-code');
    expect(deadCode?.passed).toBe(false);
    const format = report.gates.find((g) => g.gate === 'format');
    expect(format?.passed).toBe(false);
  });
});
