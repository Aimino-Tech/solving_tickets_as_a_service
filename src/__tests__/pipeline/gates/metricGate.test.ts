import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetricGate } from '../../../pipeline/gates/metricGate.js';
import type { GateCheckInput } from '../../../pipeline/gates/types.js';

function makeInput(overrides: Partial<GateCheckInput> = {}): GateCheckInput {
  return {
    csvPath: '',
    gates: {
      metric: {
        task: 'classification',
        actualColumn: 'actual',
        predictedColumn: 'predicted',
      },
    },
    ...overrides,
  };
}

async function withCsv(rows: string[], fn: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'metric-gate-test-'));
  const csvPath = join(dir, 'test.csv');
  writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  try {
    await fn(csvPath);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe('MetricGate', () => {
  const gate = new MetricGate();

  describe('classification', () => {
    const csvRows = [
      'actual,predicted',
      '1,1',
      '1,1',
      '1,0',
      '0,0',
      '0,0',
    ];

    it('returns pass with computed F1/precision/recall', async () => {
      withCsv(csvRows, async (csvPath) => {
        const result = await gate.check(makeInput({ csvPath }));
        expect(result.verdict).toBe('pass');
        expect(result.message).toContain('F1');
        expect(result.details?.current).toBeDefined();
        const cur = result.details?.current as Record<string, number>;
        expect(cur.f1).toBeGreaterThan(0);
        expect(cur.precision).toBeGreaterThan(0);
        expect(cur.recall).toBeGreaterThan(0);
      });
    });

    it('returns warning when metric drops vs previous', async () => {
      withCsv(csvRows, async (csvPath) => {
        const result = await gate.check(makeInput({
          csvPath,
          gates: {
            metric: {
              task: 'classification',
              actualColumn: 'actual',
              predictedColumn: 'predicted',
              previousMetrics: { f1: 1.0 },
            },
          },
        }));
        expect(result.verdict).toBe('warning');
        expect(result.message).toContain('degraded');
      });
    });
  });

  describe('regression', () => {
    const csvRows = [
      'actual,predicted',
      '1.0,1.1',
      '2.0,1.9',
      '3.0,3.2',
      '4.0,3.8',
      '5.0,5.1',
    ];

    it('returns pass with computed RMSE/MAE', async () => {
      withCsv(csvRows, async (csvPath) => {
        const result = await gate.check(makeInput({
          csvPath,
          gates: {
            metric: {
              task: 'regression',
              actualColumn: 'actual',
              predictedColumn: 'predicted',
            },
          },
        }));
        expect(result.verdict).toBe('pass');
        expect(result.message).toContain('RMSE');
        expect(result.details?.current).toBeDefined();
        const cur = result.details?.current as Record<string, number>;
        expect(cur.rmse).toBeGreaterThan(0);
        expect(cur.mae).toBeGreaterThan(0);
      });
    });

    it('returns warning when RMSE increases vs previous', async () => {
      withCsv(csvRows, async (csvPath) => {
        const result = await gate.check(makeInput({
          csvPath,
          gates: {
            metric: {
              task: 'regression',
              actualColumn: 'actual',
              predictedColumn: 'predicted',
              previousMetrics: { rmse: 0.05 },
            },
          },
        }));
        expect(result.verdict).toBe('warning');
        expect(result.message).toContain('RMSE');
      });
    });
  });

  it('returns pass when no metric config is provided', async () => {
    const result = await gate.check({ csvPath: '/nonexistent.csv', gates: {} });
    expect(result.verdict).toBe('pass');
    expect(result.message).toContain('not configured');
  });

  it('returns warning when metric columns are missing', async () => {
    withCsv(['id,name', '1,Alice'], async (csvPath) => {
      const result = await gate.check(makeInput({ csvPath }));
      expect(result.verdict).toBe('warning');
      expect(result.message).toContain('No data rows found');
    });
  });

  it('returns warning when CSV file does not exist', async () => {
    const result = await gate.check(makeInput({ csvPath: '/tmp/nonexistent-metric.csv' }));
    expect(result.verdict).toBe('warning');
    expect(result.message).toContain('Cannot load');
  });
});
