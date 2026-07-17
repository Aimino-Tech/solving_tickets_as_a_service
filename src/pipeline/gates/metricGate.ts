/**
 * MetricGate — computes classification or regression metrics from a CSV that
 * contains both actual and predicted values.
 *
 * For classification tasks (binary), computes precision, recall, and F1 score.
 * For regression tasks, computes RMSE and MAE.
 *
 * If previousMetrics are available, the gate issues a *warning* (not a hard
 * failure) when the current metric drops below the previous value by more than
 * a configured degradation threshold (default 10 % relative).
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { rootLogger } from '../../utils/logger.js';
import type { GateCheckInput, GateResult, PipelineGate } from './types.js';

const log = rootLogger.child({ module: 'metric-gate' });

/** Default relative degradation threshold — warn if metric drops by > 10 %. */
export const DEFAULT_DEGRADATION_THRESHOLD = 0.1;

export class MetricGate implements PipelineGate {
  readonly name = 'metric';

  async check(input: GateCheckInput): Promise<GateResult> {
    const start = performance.now();
    const { gates, csvPath } = input;
    const config = gates.metric;

    if (!config) {
      return {
        gate: this.name,
        verdict: 'pass',
        message: 'Metric gate not configured — skipped',
        durationMs: Math.round(performance.now() - start),
      };
    }

    // Load actual & predicted values
    let actuals: number[];
    let predictions: number[];
    try {
      ({ actuals, predictions } = await loadMetricColumns(
        csvPath,
        config.actualColumn,
        config.predictedColumn,
      ));
    } catch (err) {
      log.error({ err: String(err), csvPath }, 'MetricGate: failed to load metric columns');
      return {
        gate: this.name,
        verdict: 'warning',
        message: `Cannot load metric columns: ${String(err)}`,
        durationMs: Math.round(performance.now() - start),
      };
    }

    if (actuals.length === 0) {
      return {
        gate: this.name,
        verdict: 'warning',
        message: 'No data rows found for metric computation',
        durationMs: Math.round(performance.now() - start),
      };
    }

    const durationMs = Math.round(performance.now() - start);

    if (config.task === 'classification') {
      return this.evaluateClassification(config, actuals, predictions, durationMs);
    }
    return this.evaluateRegression(config, actuals, predictions, durationMs);
  }

  private evaluateClassification(
    config: NonNullable<NonNullable<GateCheckInput['gates']>['metric']>,
    actuals: number[],
    predictions: number[],
    durationMs: number,
  ): GateResult {
    if (actuals.length !== predictions.length) {
      return {
        gate: this.name,
        verdict: 'warning',
        message: `Length mismatch: actuals (${actuals.length}) vs predictions (${predictions.length})`,
        details: { actualCount: actuals.length, predictionCount: predictions.length },
        durationMs,
      };
    }

    // Binary classification confusion matrix
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (let i = 0; i < actuals.length; i++) {
      const a = actuals[i];
      const p = predictions[i];
      if (p === 1 && a === 1) tp++;
      else if (p === 1 && a === 0) fp++;
      else if (p === 0 && a === 1) fn++;
      // tn is unused
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    const current: Record<string, number> = { precision, recall, f1 };
    const previous = config.previousMetrics;

    if (previous) {
      const warnings = this.detectDegradation('f1', current.f1, previous.f1 ?? 0);
      if (warnings.length > 0) {
        return {
          gate: this.name,
          verdict: 'warning',
          message: `F1 degraded: ${warnings.join('; ')}`,
          details: { current, previous, degradation: warnings },
          durationMs,
        };
      }
    }

    return {
      gate: this.name,
      verdict: 'pass',
      message: `Classification metrics — F1: ${f1.toFixed(4)}, Precision: ${precision.toFixed(4)}, Recall: ${recall.toFixed(4)}`,
      details: { current, sampleCount: actuals.length },
      durationMs,
    };
  }

  private evaluateRegression(
    config: NonNullable<NonNullable<GateCheckInput['gates']>['metric']>,
    actuals: number[],
    predictions: number[],
    durationMs: number,
  ): GateResult {
    if (actuals.length !== predictions.length) {
      return {
        gate: this.name,
        verdict: 'warning',
        message: `Length mismatch: actuals (${actuals.length}) vs predictions (${predictions.length})`,
        details: { actualCount: actuals.length, predictionCount: predictions.length },
        durationMs,
      };
    }

    const n = actuals.length;
    let sumSquaredError = 0;
    let sumAbsError = 0;

    for (let i = 0; i < n; i++) {
      const err = actuals[i] - predictions[i];
      sumSquaredError += err * err;
      sumAbsError += Math.abs(err);
    }

    const rmse = Math.sqrt(sumSquaredError / n);
    const mae = sumAbsError / n;

    const current: Record<string, number> = { rmse, mae };
    const previous = config.previousMetrics;

    if (previous) {
      const warnings: string[] = [];

      // For error metrics, lower is better — degradation means increase
      const rmseDegradation = previous.rmse !== undefined
        ? (rmse - previous.rmse) / Math.abs(previous.rmse)
        : 0;
      if (rmseDegradation > DEFAULT_DEGRADATION_THRESHOLD) {
        warnings.push(`RMSE increased by ${(rmseDegradation * 100).toFixed(1)}%`);
      }

      const maeDegradation = previous.mae !== undefined
        ? (mae - previous.mae) / Math.abs(previous.mae)
        : 0;
      if (maeDegradation > DEFAULT_DEGRADATION_THRESHOLD) {
        warnings.push(`MAE increased by ${(maeDegradation * 100).toFixed(1)}%`);
      }

      if (warnings.length > 0) {
        return {
          gate: this.name,
          verdict: 'warning',
          message: `Regression metrics degraded: ${warnings.join('; ')}`,
          details: { current, previous, degradation: warnings },
          durationMs,
        };
      }
    }

    return {
      gate: this.name,
      verdict: 'pass',
      message: `Regression metrics — RMSE: ${rmse.toFixed(4)}, MAE: ${mae.toFixed(4)}`,
      details: { current, sampleCount: n },
      durationMs,
    };
  }

  /**
   * Compare a current metric against its previous value and return
   * human-readable degradation warnings (empty = no degradation).
   */
  private detectDegradation(
    name: string,
    current: number,
    previous: number,
  ): string[] {
    if (previous === 0) return [];

    const relChange = (current - previous) / Math.abs(previous);
    if (relChange < -DEFAULT_DEGRADATION_THRESHOLD) {
      return [`${name} dropped by ${(Math.abs(relChange) * 100).toFixed(1)}% (${previous.toFixed(4)} → ${current.toFixed(4)})`];
    }
    return [];
  }
}

/**
 * Load actual and predicted numeric values from a CSV.
 */
async function loadMetricColumns(
  csvPath: string,
  actualColumn: string,
  predictedColumn: string,
): Promise<{ actuals: number[]; predictions: number[] }> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(csvPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let columns: string[] = [];
    const actuals: number[] = [];
    const predictions: number[] = [];
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
      const actualIdx = columns.indexOf(actualColumn);
      const predIdx = columns.indexOf(predictedColumn);

      if (actualIdx === -1 || predIdx === -1) {
        return; // missing columns — skip row
      }

      const a = parseFloat(values[actualIdx]);
      const p = parseFloat(values[predIdx]);

      if (!isNaN(a) && !isNaN(p)) {
        actuals.push(a);
        predictions.push(p);
      }
    });

    const rejectIfPending = (err: Error) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    };

    stream.on('error', rejectIfPending);
    rl.on('error', rejectIfPending);

    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve({ actuals, predictions });
      }
    });

    stream.on('end', () => {
      if (!resolved) {
        resolved = true;
        resolve({ actuals, predictions });
      }
    });
  });
}
