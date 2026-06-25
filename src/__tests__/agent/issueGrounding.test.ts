import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractClaims, verifyClaims, checkIssueGrounding } from '../../agent/issueGrounding.js';

function createSandbox() {
  return {
    exec: vi.fn().mockImplementation(async (cmd: string) => {
      return { stdout: '', stderr: '', exitCode: 0 };
    }),
  } as any;
}

describe('extractClaims', () => {
  it('extracts file paths from agent output', () => {
    const output = 'Modified src/agent/qualityGates.ts and created src/__tests__/agent/test.test.ts';
    const claims = extractClaims(output);
    expect(claims.some(c => c.claim.includes('qualityGates.ts'))).toBe(true);
    expect(claims.some(c => c.claim.includes('test.test.ts'))).toBe(true);
  });

  it('extracts function names', () => {
    const output = 'The function processData was updated in src/utils.ts';
    const claims = extractClaims(output);
    expect(claims.some(c => c.claim === 'processData')).toBe(true);
    expect(claims.some(c => c.type === 'function')).toBe(true);
  });

  it('extracts class names', () => {
    const output = 'Updated class UserService to handle new edge cases';
    const claims = extractClaims(output);
    expect(claims.some(c => c.claim === 'UserService')).toBe(true);
    expect(claims.some(c => c.type === 'class')).toBe(true);
  });

  it('returns empty array for empty output', () => {
    expect(extractClaims('')).toEqual([]);
  });
});

describe('verifyClaims with REAL codebase', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-ground-'));
    sandbox = createSandbox();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies real file path exists', async () => {
    writeFileSync(join(tempDir, 'existing-file.ts'), 'export const a = 1;');
    const claims = [{ claim: join(tempDir, 'existing-file.ts'), type: 'file' as const, found: false }];
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('test -f')) return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await verifyClaims(sandbox, claims, '.');
    expect(result.passed).toBe(true);
    expect(result.verifiedCount).toBe(1);
  });

  it('detects hallucinated file path', async () => {
    const claims = [{ claim: 'src/fake-nonexistent.ts', type: 'file' as const, found: false }];
    sandbox.exec.mockImplementation(async (cmd: string) => {
      return { stdout: 'MISSING', stderr: '', exitCode: 1 };
    });
    const result = await verifyClaims(sandbox, claims, '.');
    expect(result.passed).toBe(false);
    expect(result.hallucinatedClaims).toContain('src/fake-nonexistent.ts');
  });
});

describe('checkIssueGrounding integration', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  it('passes when no claims in agent output', async () => {
    const result = await checkIssueGrounding(sandbox, '', '.');
    expect(result.passed).toBe(true);
  });

  it('returns hallucinated claims for non-existent references', async () => {
    const agentOutput = 'Modified src/fake-nonexistent-file.ts and function nonexistentFunc';
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('test -f') || cmd.includes('grep')) return { stdout: '', stderr: '', exitCode: 1 };
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await checkIssueGrounding(sandbox, agentOutput, '.');
    expect(result.passed).toBe(false);
    expect(result.hallucinatedClaims.length).toBeGreaterThan(0);
  });
});
