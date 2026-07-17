import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SchemaGate } from '../../../pipeline/gates/schemaGate.js';
import type { GateCheckInput } from '../../../pipeline/gates/types.js';

function makeInput(overrides: Partial<GateCheckInput> = {}): GateCheckInput {
  return {
    csvPath: '',
    gates: {
      schema: {
        expectedColumns: ['id', 'name', 'email'],
      },
    },
    ...overrides,
  };
}

async function withCsv(rows: string[], fn: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-gate-test-'));
  const csvPath = join(dir, 'test.csv');
  writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  try {
    await fn(csvPath);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe('SchemaGate', () => {
  const gate = new SchemaGate();

  it('returns pass when CSV columns match expected', async () => {
    withCsv(['id,name,email', '1,Alice,alice@test.com', '2,Bob,bob@test.com'], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('pass');
      expect(result.message).toContain('All');
      expect(result.details?.columnCount).toBe(3);
    });
  });

  it('returns fail when columns are missing', async () => {
    withCsv(['id,name', '1,Alice'], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('fail');
      expect(result.message).toContain('missing');
      expect(result.details?.missing).toEqual(['email']);
    });
  });

  it('returns fail when extra columns are present (strict mode)', async () => {
    withCsv(['id,name,email,extra_col', '1,Alice,alice@test.com,extra'], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('fail');
      expect(result.message).toContain('unexpected');
      expect(result.details?.unexpected).toEqual(['extra_col']);
    });
  });

  it('passes with extra columns when allowExtraColumns is true', async () => {
    withCsv(['id,name,email,extra_col', '1,Alice,alice@test.com,extra'], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { schema: { expectedColumns: ['id', 'name', 'email'], allowExtraColumns: true } },
      }));
      expect(result.verdict).toBe('pass');
    });
  });

  it('returns pass when no schema config is provided', async () => {
    const result = await gate.check({
      csvPath: '/nonexistent.csv',
      gates: {},
    });
    expect(result.verdict).toBe('pass');
    expect(result.message).toContain('not configured');
  });

  it('returns pass when expected columns list is empty', async () => {
    const result = await gate.check({
      csvPath: '/nonexistent.csv',
      gates: { schema: { expectedColumns: [] } },
    });
    expect(result.verdict).toBe('pass');
    expect(result.message).toContain('No expected columns');
  });

  it('returns fail when CSV file does not exist', async () => {
    const result = await gate.check(makeInput({ csvPath: '/tmp/nonexistent-file.csv' }));
    expect(result.verdict).toBe('fail');
    expect(result.message).toContain('Cannot read CSV header');
  });

  it('handles quoted CSV fields with commas inside', async () => {
    withCsv(['id,"full,name",email', '1,"Alice,Smith",alice@test.com'], async (csvPath) => {
      const result = await gate.check(makeInput({
        csvPath,
        gates: { schema: { expectedColumns: ['id', 'full,name', 'email'] } },
      }));
      expect(result.verdict).toBe('pass');
    });
  });
});
