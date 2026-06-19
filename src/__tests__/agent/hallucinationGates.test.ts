import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  gateHallucinationGrep,
  gateGhostcheck,
  gateVerdictTestIntegrity,
  gateTraceCorePatterns,
} from '../../agent/qualityGates.js';

function createSandbox(mockImpl?: any) {
  return {
    exec: vi.fn().mockImplementation(mockImpl || (async () => ({ stdout: '', stderr: '', exitCode: 0 }))),
  } as any;
}

describe('gateHallucinationGrep', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-hg-'));
    sandbox = createSandbox();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when no agent output provided', async () => {
    const result = await gateHallucinationGrep(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects hallucinated file claim', async () => {
    const agentOutput = 'Modified src/agent/existing.ts and created src/agent/fake.ts';
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('src/agent/existing.ts')) return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
      return { stdout: 'MISSING', stderr: '', exitCode: 1 };
    });
    const result = await gateHallucinationGrep(sandbox, agentOutput);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('fake.ts');
  });

  it('passes when all file claims are real', async () => {
    const agentOutput = 'Modified src/agent/existing.ts';
    sandbox.exec.mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 });
    const result = await gateHallucinationGrep(sandbox, agentOutput);
    expect(result.passed).toBe(true);
  });
});

describe('gateGhostcheck', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  it('passes when no imports in diff', async () => {
    const result = await gateGhostcheck(sandbox, 'console.log("hello")');
    expect(result.passed).toBe(true);
  });

  it('detects non-existent package', async () => {
    const diff = 'import { something } from \'fake-package-abc-12345\'';
    sandbox.exec.mockResolvedValue({ stdout: '404 Not found', stderr: '', exitCode: 1 });
    const result = await gateGhostcheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Ghost');
  });
});

describe('gateVerdictTestIntegrity', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  it('passes when no diff provided', async () => {
    const result = await gateVerdictTestIntegrity(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects vacuous test', async () => {
    const diff = '+ it("should work", () => { expect(true).toBe(true); });';
    const result = await gateVerdictTestIntegrity(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Vacuous');
  });

  it('passes with real assertions', async () => {
    const diff = '+ it("returns 42", () => { const r = fn(); expect(r).toBe(42); });';
    const result = await gateVerdictTestIntegrity(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});

describe('gateTraceCorePatterns', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  it('passes when no diff provided', async () => {
    const result = await gateTraceCorePatterns(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('detects high-severity AI failure patterns', async () => {
    const diff = '+ try { fn(); } catch () { }';
    const result = await gateTraceCorePatterns(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('high-severity');
  });

  it('detects TODO left in code', async () => {
    const diff = '+ // TODO: implement this properly';
    const result = await gateTraceCorePatterns(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('passes on clean code', async () => {
    const diff = '+ const result = fn();\n+ return result;';
    const result = await gateTraceCorePatterns(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});
