import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RowCountGate } from '../../../pipeline/gates/rowCountGate.js';
import type { GateCheckInput } from '../../../pipeline/gates/types.js';

function makeInput(overrides: Partial<GateCheckInput> = {}): GateCheckInput {
  return {
    csvPath: '',
    gates: {
      rowCount: {
        minRows: 1,
        maxRows: 100,
      },
    },
    ...overrides,
  };
}

async function withCsv(rows: string[], fn: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'rowcount-gate-test-'));
  const csvPath = join(dir, 'test.csv');
  writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  try {
    await fn(csvPath);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe('RowCountGate', () => {
  const gate = new RowCountGate();

  it('returns pass when row count is within range', async () => {
    withCsv(['id,name', '1,Alice', '2,Bob', '3,Charlie'], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('pass');
      expect(result.message).toContain('3');
      expect(result.details?.rowCount).toBe(3);
    });
  });

  it('returns fail for zero data rows', async () => {
    withCsv(['id,name'], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('fail');
      expect(result.message).toContain('zero data rows');
    });
  });

  it('returns fail when row count is below minRows', async () => {
    withCsv(['id,name', '1,Alice'], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { rowCount: { minRows: 5, maxRows: 100 } },
      }));
      expect(result.verdict).toBe('fail');
      expect(result.message).toContain('below minimum');
    });
  });

  it('returns fail when row count exceeds maxRows', async () => {
    withCsv(['id,name', '1,Alice', '2,Bob', '3,Charlie', '4,Dave', '5,Eve'], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { rowCount: { minRows: 1, maxRows: 3 } },
      }));
      expect(result.verdict).toBe('fail');
      expect(result.message).toContain('exceeds maximum');
    });
  });

  it('returns pass when no row count config is provided', async () => {
    const result = await gate.check({ csvPath: '/nonexistent.csv', gates: {} });
    expect(result.verdict).toBe('pass');
    expect(result.message).toContain('not configured');
  });

  it('passes with only minRows set and count meets it', async () => {
    withCsv(['id,name', '1,Alice', '2,Bob'], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { rowCount: { minRows: 1 } },
      }));
      expect(result.verdict).toBe('pass');
    });
  });

  it('handles CSV with only header and empty lines gracefully', async () => {
    withCsv(['id,name', ''], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('fail');
    });
  });
});
