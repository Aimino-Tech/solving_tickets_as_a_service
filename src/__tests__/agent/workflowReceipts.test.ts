import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReceipt, verifyReceipt, verifyReceiptChain, createReceiptChain } from '../../agent/workflowReceipts.js';

describe('createReceipt (REAL SHA-256)', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-receipt-'));
    filePath = join(tempDir, 'test-file.txt');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates receipt with valid SHA-256 hash matching real file', async () => {
    const content = 'Hello, this is real content for hashing!';
    writeFileSync(filePath, content, 'utf-8');
    const receipt = await createReceipt('test-step', filePath, null);
    expect(receipt.id).toContain('test-step');
    expect(receipt.hash).toHaveLength(64);
    expect(receipt.filePath).toBe(filePath);
    expect(receipt.previousHash).toBeNull();
  });

  it('verifyReceipt returns true for unmodified file', async () => {
    writeFileSync(filePath, 'unchanged content', 'utf-8');
    const receipt = await createReceipt('step-1', filePath, null);
    const result = await verifyReceipt(receipt);
    expect(result).toBe(true);
  });

  it('verifyReceipt returns false for modified file', async () => {
    writeFileSync(filePath, 'original content', 'utf-8');
    const receipt = await createReceipt('step-1', filePath, null);
    writeFileSync(filePath, 'modified content', 'utf-8');
    const result = await verifyReceipt(receipt);
    expect(result).toBe(false);
  });
});

describe('verifyReceiptChain (REAL integrity)', () => {
  let tempDir: string;
  let path1: string;
  let path2: string;
  let path3: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-chain-'));
    path1 = join(tempDir, 'step1.txt');
    path2 = join(tempDir, 'step2.txt');
    path3 = join(tempDir, 'step3.txt');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates chain integrity for unmodified files', async () => {
    writeFileSync(path1, 'investigation results', 'utf-8');
    writeFileSync(path2, 'fix implementation', 'utf-8');
    writeFileSync(path3, 'test results', 'utf-8');

    const chain = await createReceiptChain([
      { step: 'investigate', filePath: path1 },
      { step: 'fix', filePath: path2 },
      { step: 'test', filePath: path3 },
    ]);

    const result = await verifyReceiptChain(chain);
    expect(result.valid).toBe(true);
    expect(result.tampered).toHaveLength(0);
  });

  it('detects tampered file in chain', async () => {
    writeFileSync(path1, 'investigation results', 'utf-8');
    writeFileSync(path2, 'fix implementation', 'utf-8');
    writeFileSync(path3, 'test results', 'utf-8');

    const chain = await createReceiptChain([
      { step: 'investigate', filePath: path1 },
      { step: 'fix', filePath: path2 },
      { step: 'test', filePath: path3 },
    ]);

    writeFileSync(path2, 'malicious modification', 'utf-8');

    const result = await verifyReceiptChain(chain);
    expect(result.valid).toBe(false);
    expect(result.tampered).toContain(path2);
  });

  it('detects chain break from hash mismatch', async () => {
    writeFileSync(path1, 'content-1', 'utf-8');
    const receipt1 = await createReceipt('step-1', path1, null);
    const receipt2 = await createReceipt('step-2', path2, receipt1);
    const receipt3 = await createReceipt('step-3', path3, receipt2);

    receipt3.previousHash = 'fake-hash';

    const result = await verifyReceiptChain({ receipts: [receipt1, receipt2, receipt3] });
    expect(result.valid).toBe(false);
    expect(result.tampered.some(t => t.includes('chain-break'))).toBe(true);
  });
});
