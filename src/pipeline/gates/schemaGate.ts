/**
 * SchemaGate — validates that a CSV's columns match the expected schema.
 *
 * Reads the CSV header row and compares it against the columns declared in
 * the template's gate configuration.  Fails with a diff of missing and/or
 * unexpected columns.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { rootLogger } from '../../utils/logger.js';
import type { GateCheckInput, GateResult, PipelineGate } from './types.js';

const log = rootLogger.child({ module: 'schema-gate' });

export class SchemaGate implements PipelineGate {
  readonly name = 'schema';

  async check(input: GateCheckInput): Promise<GateResult> {
    const start = performance.now();
    const { gates, csvPath } = input;
    const config = gates.schema;

    if (!config) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: 'Schema gate not configured — skipped',
        durationMs: Math.round(performance.now() - start),
      };
    }

    const expected = config.expectedColumns;
    if (expected.length === 0) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: 'No expected columns configured — skipped',
        durationMs: Math.round(performance.now() - start),
      };
    }

    let actual: string[];
    try {
      actual = await readCsvHeader(csvPath);
    } catch (err) {
      log.error({ err: String(err), csvPath }, 'SchemaGate: failed to read CSV header');
      return {
        gate: this.name,
        verdict: 'fail',
        message: `Cannot read CSV header: ${String(err)}`,
        durationMs: Math.round(performance.now() - start),
      };
    }

    const missing = expected.filter((col) => !actual.includes(col));
    const unexpected = config.allowExtraColumns
      ? []
      : actual.filter((col) => !expected.includes(col));

    const durationMs = Math.round(performance.now() - start);

    if (missing.length === 0 && unexpected.length === 0) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: `All ${expected.length} expected columns present`,
        details: { columnCount: actual.length, columns: actual },
        durationMs,
      };
    }

    const msgParts: string[] = [];
    if (missing.length > 0) {
      msgParts.push(`missing columns: ${missing.join(', ')}`);
    }
    if (unexpected.length > 0) {
      msgParts.push(`unexpected columns: ${unexpected.join(', ')}`);
    }

    return {
      gate: this.name,
      verdict: 'fail',
      message: `Schema mismatch — ${msgParts.join('; ')}`,
      details: {
        expected,
        actual,
        missing,
        unexpected,
      },
      durationMs,
    };
  }
}

/**
 * Read the first line of a CSV file and return the header column names.
 */
async function readCsvHeader(csvPath: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const stream = createReadStream(csvPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let resolved = false;

    rl.on('line', (line: string) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      stream.destroy();

      const trimmed = line.trim();
      if (!trimmed) {
        reject(new Error('CSV file is empty — no header row found'));
        return;
      }

      // Parse respecting quoted fields (basic — handles commas inside quotes)
      const columns = parseCsvLine(trimmed);
      resolve(columns);
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
        reject(new Error('CSV file is empty or unreadable'));
      }
    });
  });
}

/**
 * Parse a single CSV line into column values, handling double-quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const columns: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next "
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        columns.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  columns.push(current.trim());
  return columns;
}
