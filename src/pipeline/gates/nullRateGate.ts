/**
 * NullRateGate — verifies that null/empty values in key columns stay below a
 * configurable threshold.
 *
 * Loads the CSV, scans each column listed in `config.keyColumns`, and counts
 * cells that are empty, whitespace-only, or the literal string "null" (case-
 * insensitive).  Fails if any column's null fraction exceeds
 * `config.maxNullRate` (default 5 %).
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { rootLogger } from '../../utils/logger.js';
import type { GateCheckInput, GateResult, PipelineGate } from './types.js';

const log = rootLogger.child({ module: 'null-rate-gate' });

export const DEFAULT_MAX_NULL_RATE = 0.05;

export class NullRateGate implements PipelineGate {
  readonly name = 'nullRate';

  async check(input: GateCheckInput): Promise<GateResult> {
    const start = performance.now();
    const { gates, csvPath } = input;
    const config = gates.nullRate;

    if (!config) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: 'Null rate gate not configured — skipped',
        durationMs: Math.round(performance.now() - start),
      };
    }

    const keyColumns = config.keyColumns;
    if (keyColumns.length === 0) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: 'No key columns configured — skipped',
        durationMs: Math.round(performance.now() - start),
      };
    }

    const maxNullRate = config.maxNullRate ?? DEFAULT_MAX_NULL_RATE;

    let columns: string[];
    let rows: Record<string, string>[];
    try {
      ({ columns, rows } = await loadCsv(csvPath));
    } catch (err) {
      log.error({ err: String(err), csvPath }, 'NullRateGate: failed to load CSV');
      return {
        gate: this.name,
        verdict: 'fail',
        message: `Cannot load CSV: ${String(err)}`,
        durationMs: Math.round(performance.now() - start),
      };
    }

    const violations: Array<{ column: string; nullRate: number; nullCount: number; total: number }> = [];
    const totalRows = rows.length;

    for (const col of keyColumns) {
      if (!columns.includes(col)) {
        violations.push({
          column: col,
          nullRate: 1,
          nullCount: totalRows,
          total: totalRows,
        });
        continue;
      }

      let nullCount = 0;
      for (const row of rows) {
        const val = row[col];
        if (val === undefined || val === null || val.trim() === '' || val.trim().toLowerCase() === 'null') {
          nullCount++;
        }
      }

      const rate = totalRows > 0 ? nullCount / totalRows : 0;
      if (rate > maxNullRate) {
        violations.push({ column: col, nullRate: rate, nullCount, total: totalRows });
      }
    }

    const durationMs = Math.round(performance.now() - start);

    if (violations.length === 0) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: `All ${keyColumns.length} key column(s) within null rate ≤ ${(maxNullRate * 100).toFixed(1)}%`,
        details: { keyColumns, maxNullRate, rowsChecked: totalRows },
        durationMs,
      };
    }

    return {
      gate: this.name,
      verdict: 'fail',
      message: `${violations.length} column(s) exceed null rate threshold: ${violations.map((v) => `${v.column} (${(v.nullRate * 100).toFixed(1)}%)`).join(', ')}`,
      details: { violations, maxNullRate, keyColumns, rowsChecked: totalRows },
      durationMs,
    };
  }
}

/**
 * Load a CSV into a header array and an array of row dicts.
 */
async function loadCsv(
  csvPath: string,
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(csvPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let columns: string[] = [];
    const rows: Record<string, string>[] = [];
    let lineNum = 0;
    let resolved = false;

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      lineNum++;
      if (lineNum === 1) {
        columns = trimmed.split(',').map((c) => c.trim());
        return;
      }

      const values = trimmed.split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      for (let i = 0; i < columns.length; i++) {
        row[columns[i]] = i < values.length ? values[i] : '';
      }
      rows.push(row);
    });

    rl.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve({ columns, rows });
      }
    });

    stream.on('end', () => {
      if (!resolved) {
        resolved = true;
        resolve({ columns, rows });
      }
    });
  });
}
