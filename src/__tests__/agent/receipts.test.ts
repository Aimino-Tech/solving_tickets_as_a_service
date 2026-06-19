import { describe, expect, it } from 'vitest';
import {
  addReceipt,
  computeHash,
  createManifest,
  createReceipt,
  REQUIRED_PHASES,
  type ReceiptPhase,
  receiptsToMarkdown,
  serializeReceiptsJson,
  verifyAllReceipts,
} from '../../agent/receipts.js';

describe('computeHash', () => {
  it('produces a deterministic 64-char hex string for the same input', () => {
    const a = computeHash('hello');
    const b = computeHash('hello');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    const a = computeHash('hello');
    const b = computeHash('world');
    expect(a).not.toBe(b);
  });

  it('accepts objects and arrays', () => {
    const hash = computeHash({ foo: [1, 2, 3] });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts numbers and booleans', () => {
    const hash = computeHash(42);
    expect(hash).toHaveLength(64);
    const boolHash = computeHash(true);
    expect(boolHash).toHaveLength(64);
  });

  it('produces the same hash for deeply equal objects', () => {
    const a = computeHash({ a: 1, b: { c: [1, 2] } });
    const b = computeHash({ a: 1, b: { c: [1, 2] } });
    expect(a).toBe(b);
  });

  it('handles null and undefined', () => {
    expect(computeHash(null)).toHaveLength(64);
    expect(computeHash(undefined)).toHaveLength(64);
  });
});

describe('createReceipt', () => {
  it('creates a receipt with all required fields', () => {
    const receipt = createReceipt('triage', { issue: 'title' }, { type: 'bug' }, 'https://example.com/triage');

    expect(receipt.phase).toBe('triage');
    expect(receipt.inputHash).toHaveLength(64);
    expect(receipt.outputHash).toHaveLength(64);
    expect(receipt.artifactUrl).toBe('https://example.com/triage');
    expect(receipt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accepts string inputs and outputs', () => {
    const receipt = createReceipt('investigate', 'raw input', 'raw output', 'https://example.com/investigate');
    expect(receipt.phase).toBe('investigate');
    expect(typeof receipt.inputHash).toBe('string');
    expect(typeof receipt.outputHash).toBe('string');
  });

  it('supports all 4 receipt phases', () => {
    const phases: ReceiptPhase[] = ['triage', 'investigate', 'fix', 'verify'];
    for (const phase of phases) {
      const receipt = createReceipt(phase, { input: true }, { output: true }, `https://example.com/${phase}`);
      expect(receipt.phase).toBe(phase);
      expect(receipt.timestamp).toBeTruthy();
    }
  });

  it('each receipt gets a unique timestamp', async () => {
    const a = createReceipt('triage', 'a', 'a', 'url');
    await new Promise((r) => setTimeout(r, 5));
    const b = createReceipt('triage', 'b', 'b', 'url');
    expect(a.timestamp).not.toBe(b.timestamp);
  });

  it('hashes are 64-character lowercase hex strings', () => {
    const receipt = createReceipt('fix', 'input data', 'output data', 'url');
    expect(receipt.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createManifest and addReceipt', () => {
  it('createManifest returns an empty manifest', () => {
    const manifest = createManifest();
    expect(manifest.receipts).toEqual({});
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('addReceipt adds a receipt to the manifest', () => {
    const manifest = createManifest();
    const receipt = createReceipt('triage', 'input', 'output', 'url');
    const updated = addReceipt(manifest, receipt);
    expect(updated.receipts.triage).toBe(receipt);
    expect(updated.receipts.investigate).toBeUndefined();
  });

  it('addReceipt does not mutate the original manifest', () => {
    const manifest = createManifest();
    const receipt = createReceipt('triage', 'in', 'out', 'url');
    addReceipt(manifest, receipt);
    expect(manifest.receipts.triage).toBeUndefined();
  });

  it('addReceipt accumulates multiple receipts', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'in1', 'out1', 'url1'));
    manifest = addReceipt(manifest, createReceipt('investigate', 'in2', 'out2', 'url2'));
    manifest = addReceipt(manifest, createReceipt('fix', 'in3', 'out3', 'url3'));
    expect(Object.keys(manifest.receipts)).toHaveLength(3);
    expect(manifest.receipts.triage?.phase).toBe('triage');
    expect(manifest.receipts.investigate?.phase).toBe('investigate');
    expect(manifest.receipts.fix?.phase).toBe('fix');
  });
});

describe('verifyAllReceipts', () => {
  it('returns valid=true when all phases have receipts', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'i1', 'o1', 'u1'));
    manifest = addReceipt(manifest, createReceipt('investigate', 'i2', 'o2', 'u2'));
    manifest = addReceipt(manifest, createReceipt('fix', 'i3', 'o3', 'u3'));
    manifest = addReceipt(manifest, createReceipt('verify', 'i4', 'o4', 'u4'));

    const result = verifyAllReceipts(manifest);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns valid=false with missing phases listed', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'i1', 'o1', 'u1'));
    manifest = addReceipt(manifest, createReceipt('fix', 'i3', 'o3', 'u3'));

    const result = verifyAllReceipts(manifest);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('investigate');
    expect(result.missing).toContain('verify');
    expect(result.missing).not.toContain('triage');
    expect(result.missing).not.toContain('fix');
  });

  it('returns all phases as missing for an empty manifest', () => {
    const manifest = createManifest();
    const result = verifyAllReceipts(manifest);
    expect(result.valid).toBe(false);
    expect(result.missing.sort()).toEqual([...REQUIRED_PHASES].sort());
  });

  it('returns valid=false when only one receipt is present', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'i', 'o', 'u'));
    const result = verifyAllReceipts(manifest);
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(3);
  });
});

describe('serializeReceiptsJson', () => {
  it('serializes manifest to pretty-printed JSON', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'in', 'out', 'url'));
    const json = serializeReceiptsJson(manifest);
    const parsed = JSON.parse(json);
    expect(parsed.receipts.triage.phase).toBe('triage');
    expect(parsed.receipts.triage.inputHash).toHaveLength(64);
    expect(parsed.createdAt).toBeTruthy();
  });

  it('JSON can be round-tripped', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'in', 'out', 'url'));
    manifest = addReceipt(manifest, createReceipt('verify', 'in2', 'out2', 'url2'));
    const json = serializeReceiptsJson(manifest);
    const parsed = JSON.parse(json);
    expect(parsed.receipts.triage.phase).toBe('triage');
    expect(parsed.receipts.verify.phase).toBe('verify');
  });
});

describe('receiptsToMarkdown', () => {
  it('generates a table with all phases', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'in1', 'out1', 'https://example.com/1'));
    manifest = addReceipt(manifest, createReceipt('investigate', 'in2', 'out2', 'https://example.com/2'));
    manifest = addReceipt(manifest, createReceipt('fix', 'in3', 'out3', 'https://example.com/3'));
    manifest = addReceipt(manifest, createReceipt('verify', 'in4', 'out4', 'https://example.com/4'));

    const md = receiptsToMarkdown(manifest);
    expect(md).toContain('## Workflow Receipts');
    expect(md).toContain('| Phase | Input Hash | Output Hash | Artifact | Timestamp |');
    expect(md).toContain('triage');
    expect(md).toContain('investigate');
    expect(md).toContain('fix');
    expect(md).toContain('verify');
    expect(md).toContain('https://example.com/1');
  });

  it('shows ❌ Missing for absent phases', () => {
    let manifest = createManifest();
    manifest = addReceipt(manifest, createReceipt('triage', 'i', 'o', 'u'));
    const md = receiptsToMarkdown(manifest);
    expect(md).toContain('| investigate | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |');
    expect(md).toContain('| fix | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |');
    expect(md).toContain('| verify | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |');
    expect(md).not.toContain('| triage | ❌ Missing');
  });
});
