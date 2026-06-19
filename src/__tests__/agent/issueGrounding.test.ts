import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractIssueClaims,
  extractAgentClaims,
  verifyClaims,
  checkIssueGrounding,
  createReceipt,
  verifyReceiptHash,
  verifyReceiptChain,
  createFileReceipt,
} from '../../agent/issueGrounding.js';

function createSandbox() {
  const realCalls: string[] = [];
  return {
    exec: vi.fn().mockImplementation(async (cmd: string) => {
      realCalls.push(cmd);
      return { stdout: '', stderr: '', exitCode: 0 };
    }),
    getRealCalls: () => realCalls,
  } as any;
}

describe('extractIssueClaims', () => {
  it('extracts file paths from issue body', () => {
    const body = 'The bug is in src/agent/issueAgent.ts when calling src/utils/helper.ts';
    const claims = extractIssueClaims(body);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.some(c => c.text.includes('issueAgent.ts'))).toBe(true);
    expect(claims.some(c => c.text.includes('helper.ts'))).toBe(true);
  });

  it('extracts function references', () => {
    const body = 'The function processData is failing when calling the method validateInput';
    const claims = extractIssueClaims(body);
    expect(claims.some(c => c.text === 'processData')).toBe(true);
  });

  it('returns empty array for empty body', () => {
    expect(extractIssueClaims('')).toEqual([]);
  });
});

describe('extractAgentClaims', () => {
  it('extracts file paths from agent output', () => {
    const output = 'Modified src/agent/qualityGates.ts and created tests/qualityGates.test.ts';
    const claims = extractAgentClaims(output);
    expect(claims.some(c => c.text.includes('qualityGates.ts'))).toBe(true);
  });
});

describe('verifyClaims with real filesystem', () => {
  let tempDir: string;
  let sandbox: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-ground-'));
    sandbox = createSandbox();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies real file exists', async () => {
    writeFileSync(join(tempDir, 'test.ts'), 'console.log("hello");');
    const claims = [{ text: join(tempDir, 'test.ts'), type: 'file' as const, found: false }];
    sandbox.exec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('test -f')) return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await verifyClaims(sandbox, claims, '.');
    expect(result.passed).toBe(true);
  });
});

describe('createReceipt and verifyReceiptHash', () => {
  it('creates receipt with valid SHA-256 hash', () => {
    const content = 'test content';
    const receipt = createReceipt('test-step', content, null);
    expect(receipt.id).toContain('test-step');
    expect(receipt.hash).toHaveLength(64);
    expect(receipt.previousHash).toBeNull();

    const isValid = verifyReceiptHash(receipt, content);
    expect(isValid).toBe(true);
  });

  it('detects content modification', () => {
    const content = 'original content';
    const receipt = createReceipt('test-step', content, null);
    const isModified = verifyReceiptHash(receipt, 'modified content');
    expect(isModified).toBe(false);
  });
});

describe('verifyReceiptChain', () => {
  it('validates chain integrity', () => {
    const r1 = createReceipt('step-1', 'content-1', null);
    const r2 = createReceipt('step-2', 'content-2', r1.hash);
    const r3 = createReceipt('step-3', 'content-3', r2.hash);
    const chain = { receipts: [r1, r2, r3] };
    const result = verifyReceiptChain(chain);
    expect(result.valid).toBe(true);
    expect(result.tamperedSteps).toHaveLength(0);
  });

  it('detects chain break', () => {
    const r1 = createReceipt('step-1', 'content-1', null);
    const r2 = createReceipt('step-2', 'content-2', 'tampered-hash');
    const chain = { receipts: [r1, r2] };
    const result = verifyReceiptChain(chain);
    expect(result.valid).toBe(false);
    expect(result.tamperedSteps.length).toBeGreaterThan(0);
  });
});
