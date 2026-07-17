import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NullRateGate } from '../../../pipeline/gates/nullRateGate.js';
import type { GateCheckInput } from '../../../pipeline/gates/types.js';

function makeInput(overrides: Partial<GateCheckInput> = {}): GateCheckInput {
  return {
    csvPath: '',
    gates: {
      nullRate: {
        keyColumns: ['email'],
        maxNullRate: 0.05,
      },
    },
    ...overrides,
  };
}

async function withCsv(rows: string[], fn: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'nullrate-gate-test-'));
  const csvPath = join(dir, 'test.csv');
  writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  try {
    await fn(csvPath);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe('NullRateGate', () => {
  const gate = new NullRateGate();

  it('returns pass when null rate is below threshold', async () => {
    withCsv([
      'id,name,email',
      '1,Alice,alice@test.com',
      '2,Bob,bob@test.com',
      '3,Charlie,charlie@test.com',
    ], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('pass');
    });
  });

  it('returns fail when null rate exceeds threshold', async () => {
    withCsv([
      'id,name,email',
      '1,Alice,alice@test.com',
      '2,Bob,',
      '3,Charlie,',
      '4,Dave,',
    ], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { nullRate: { keyColumns: ['email'], maxNullRate: 0.05 } },
      }));
      expect(result.verdict).toBe('fail');
      expect(result.message).toContain('email');
    });
  });

  it('treats literal "null" as null value', async () => {
    withCsv([
      'id,name,email',
      '1,Alice,null',
      '2,Bob,NULL',
    ], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { nullRate: { keyColumns: ['email'], maxNullRate: 0.1 } },
      }));
      expect(result.verdict).toBe('fail');
    });
  });

  it('returns pass when no null rate config is provided', async () => {
    const result = await gate.check({ csvPath: '/nonexistent.csv', gates: {} });
    expect(result.verdict).toBe('pass');
    expect(result.message).toContain('not configured');
  });

  it('returns pass when key columns list is empty', async () => {
    const result = await gate.check({
      csvPath: '/nonexistent.csv',
      gates: { nullRate: { keyColumns: [] } },
    });
    expect(result.verdict).toBe('pass');
    expect(result.message).toContain('No key columns');
  });

  it('reports missing column as 100% null rate', async () => {
    withCsv([
      'id,name',
      '1,Alice',
    ], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { nullRate: { keyColumns: ['email'], maxNullRate: 0.05 } },
      }));
      expect(result.verdict).toBe('fail');
      expect(result.details?.violations).toHaveLength(1);
      expect(result.details?.violations[0].column).toBe('email');
      expect(result.details?.violations[0].nullRate).toBe(1);
    });
  });

  it('uses default maxNullRate of 5% when not configured', async () => {
    withCsv([
      'id,name,email',
      '1,Alice,alice@test.com',
      '2,Bob,',
    ], async (csvPath) => {
      const result = await gate.check({
        csvPath,
        gates: { nullRate: { keyColumns: ['email'] } },
      });
      expect(result.verdict).toBe('fail');
    });
  });
});
