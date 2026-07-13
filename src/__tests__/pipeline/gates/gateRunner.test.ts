import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GateRunner } from '../../../pipeline/gates/gateRunner.js';
import type { GateCheckInput, PipelineGate } from '../../../pipeline/gates/types.js';

async function withCsv(rows: string[], fn: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'gaterunner-test-'));
  const csvPath = join(dir, 'test.csv');
  writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  try {
    await fn(csvPath);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

class AlwaysFailGate implements PipelineGate {
  readonly name = 'alwaysFail';
  async check() {
    return { gate: this.name, verdict: 'fail' as const, message: 'Always fails', durationMs: 0 };
  }
}

class AlwaysPassGate implements PipelineGate {
  readonly name = 'alwaysPass';
  async check() {
    return { gate: this.name, verdict: 'pass' as const, message: 'Always passes', durationMs: 0 };
  }
}

describe('GateRunner', () => {
  it('returns passed=true when all gates pass', async () => {
    const runner = new GateRunner([new AlwaysPassGate()]);
    const result = await runner.checkAll({ csvPath: '/nonexistent.csv', gates: {} });
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].verdict).toBe('pass');
  });

  it('returns passed=false when any gate fails', async () => {
    const runner = new GateRunner([new AlwaysPassGate(), new AlwaysFailGate()]);
    const result = await runner.checkAll({ csvPath: '/nonexistent.csv', gates: {} });
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results.filter((r) => r.verdict === 'fail')).toHaveLength(1);
  });

  it('runs schema + rowCount gates against a valid CSV', async () => {
    const runner = new GateRunner();
    withCsv(['id,name,email', '1,Alice,alice@test.com', '2,Bob,bob@test.com'], async (csvPath) => {
      const result = await runner.checkAll({
        csvPath,
        gates: {
          schema: { expectedColumns: ['id', 'name', 'email'] },
          rowCount: { minRows: 1, maxRows: 10 },
        },
      });
      expect(result.passed).toBe(true);
    });
  });

  it('handles gate execution error gracefully', async () => {
    const runner = new GateRunner([new AlwaysPassGate(), new AlwaysFailGate()]);
    const result = await runner.checkAll({ csvPath: '/nonexistent.csv', gates: {} });
    expect(result.passed).toBe(false);
  });
});
