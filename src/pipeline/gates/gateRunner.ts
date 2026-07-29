/**
 * GateRunner — orchestrates execution of all configured quality gates against
 * a pipeline step's CSV output.
 *
 * checkAll() runs every gate whose configuration is present and returns a
 * consolidated pass/fail verdict plus per-gate results.
 */

import { rootLogger } from '../../utils/logger.js';
import { SchemaGate } from './schemaGate.js';
import { RowCountGate } from './rowCountGate.js';
import { NullRateGate } from './nullRateGate.js';
import { MetricGate } from './metricGate.js';
import type {
  GateCheckInput,
  GateResult,
  GateRunnerResult,
  GatesConfig,
  PipelineGate,
} from './types.js';

const log = rootLogger.child({ module: 'gate-runner' });

/** All built-in gate implementations. */
const BUILTIN_GATES: PipelineGate[] = [
  new SchemaGate(),
  new RowCountGate(),
  new NullRateGate(),
  new MetricGate(),
];

export class GateRunner {
  private readonly gates: PipelineGate[];

  constructor(gates: PipelineGate[] = BUILTIN_GATES) {
    this.gates = gates;
  }

  /**
   * Run every gate whose configuration is present and return a consolidated
   * result.  A single 'fail' vote from any blocker gate causes
   * `passed: false`.
   */
  async checkAll(input: GateCheckInput): Promise<GateRunnerResult> {
    const results = await Promise.allSettled(
      this.gates.map((gate) => this.runGate(gate, input)),
    );

    const gateResults = results.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      log.error({ gate: 'unknown', err: String(r.reason) }, 'Gate threw unexpectedly');
      return {
        gate: 'unknown',
        verdict: 'fail' as const,
        message: `Gate threw: ${String(r.reason)}`,
        durationMs: 0,
      };
    });

    const passed = gateResults.every((r) => r.verdict !== 'fail');

    log.info(
      { passed, gateCount: gateResults.length, results: gateResults.map((r) => ({ gate: r.gate, verdict: r.verdict })) },
      'GateRunner completed',
    );

    return { passed, results: gateResults };
  }

  private async runGate(gate: PipelineGate, input: GateCheckInput): Promise<GateResult> {
    const hasConfig = hasGateConfig(input.gates, gate.name);
    if (!hasConfig) {
      log.debug({ gate: gate.name }, 'Gate has no config — skipping');
      return {
        gate: gate.name,
        verdict: 'pass',
        message: 'Not configured — skipped',
        durationMs: 0,
      };
    }

    log.debug({ gate: gate.name, csvPath: input.csvPath }, 'Running gate');
    return gate.check(input);
  }
}

/**
 * Check whether a named gate has any configuration in GatesConfig.
 */
function hasGateConfig(gates: GatesConfig, gateName: string): boolean {
  switch (gateName) {
    case 'schema':
      return gates.schema !== undefined;
    case 'rowCount':
      return gates.rowCount !== undefined;
    case 'nullRate':
      return gates.nullRate !== undefined;
    case 'metric':
      return gates.metric !== undefined;
    default:
      return true; // unknown gates run by default
  }
}
