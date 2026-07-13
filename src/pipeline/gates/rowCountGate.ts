/**
 * RowCountGate — verifies that a CSV's row count falls within [minRows, maxRows].
 *
 * Counts data rows (everything after the header).  Fails immediately for zero
 * rows.  Also fails if the count is below minRows or above maxRows when those
 * limits are configured.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { rootLogger } from '../../utils/logger.js';
import type { GateCheckInput, GateResult, PipelineGate } from './types.js';

const log = rootLogger.child({ module: 'row-count-gate' });

export class RowCountGate implements PipelineGate {
  readonly name = 'rowCount';

  async check(input: GateCheckInput): Promise<GateResult> {
    const start = performance.now();
    const { gates, csvPath } = input;
    const config = gates.rowCount;

    if (!config) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: 'Row count gate not configured — skipped',
        durationMs: Math.round(performance.now() - start),
      };
    }

    let rowCount: number;
    try {
      rowCount = await countDataRows(csvPath);
    } catch (err) {
      log.error({ err: String(err), csvPath }, 'RowCountGate: failed to count rows');
      return {
        gate: this.name,
        verdict: 'fail',
        message: `Cannot count CSV rows: ${String(err)}`,
        durationMs: Math.round(performance.now() - start),
      };
    }

    const durationMs = Math.round(performance.now() - start);

    // Zero rows is always a hard failure
    if (rowCount === 0) {
      return {
        gate: this.name,
        verdict: 'fail',
        message: 'CSV has zero data rows',
        details: { rowCount: 0 },
        durationMs,
      };
    }

    const minRows = config.minRows ?? 0;
    const maxRows = config.maxRows;

    if (rowCount < minRows) {
      return {
        gate: this.name,
        verdict: 'fail',
        message: `Row count ${rowCount} is below minimum ${minRows}`,
        details: { rowCount, minRows, maxRows },
        durationMs,
      };
    }

    if (maxRows !== undefined && rowCount > maxRows) {
      return {
        gate: this.name,
        verdict: 'fail',
        message: `Row count ${rowCount} exceeds maximum ${maxRows}`,
        details: { rowCount, minRows, maxRows },
        durationMs,
      };
    }

    const range = maxRows !== undefined
      ? `[${minRows}, ${maxRows}]`
      : `≥ ${minRows}`;

    return {
      gate: this.name,
      verdict: 'pass',
      message: `Row count ${rowCount} within ${range}`,
      details: { rowCount, minRows, maxRows },
      durationMs,
    };
  }
}

/**
 * Count data rows in a CSV (lines after the header).
 */
async function countDataRows(csvPath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const stream = createReadStream(csvPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let isHeader = true;
    let count = 0;
    let resolved = false;

    rl.on('line', (line: string) => {
      if (isHeader) {
        isHeader = false;
        return;
      }
      const trimmed = line.trim();
      if (trimmed) {
        count++;
      }
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
        resolve(count);
      }
    });

    // Also resolve on end-of-stream
    stream.on('end', () => {
      if (!resolved) {
        resolved = true;
        resolve(count);
      }
    });
  });
}
