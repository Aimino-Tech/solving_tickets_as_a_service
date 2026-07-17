/**
 * Quality Gate types for pipeline CSV output validation.
 *
 * Gates are executable checks — they inspect pipeline CSV output and report
 * pass/fail.  They do NOT modify pipeline output.  Execution is cheap
 * (sub-second).
 */

// ---------------------------------------------------------------------------
// Per-gate configuration — embedded in template definitions
// ---------------------------------------------------------------------------

export interface SchemaGateConfig {
  /** Expected column names in order. */
  expectedColumns: string[];
  /** When true, extra columns in the CSV beyond expectedColumns are tolerated. */
  allowExtraColumns?: boolean;
}

export interface RowCountGateConfig {
  /** Minimum acceptable row count (exclusive — must be ≥ minRows). */
  minRows?: number;
  /** Maximum acceptable row count (inclusive). */
  maxRows?: number;
}

export interface NullRateGateConfig {
  /** Columns to check for null/empty values. */
  keyColumns: string[];
  /** Maximum allowed null fraction per column (0.0 – 1.0, default 0.05). */
  maxNullRate?: number;
}

export interface MetricGateConfig {
  /** The task type: 'classification' or 'regression'. */
  task: 'classification' | 'regression';
  /** Column name holding the ground-truth actual values. */
  actualColumn: string;
  /** Column name holding the predicted values. */
  predictedColumn: string;
  /** Previous metric values for trend comparison (warning only). */
  previousMetrics?: Record<string, number>;
}

export interface GatesConfig {
  schema?: SchemaGateConfig;
  rowCount?: RowCountGateConfig;
  nullRate?: NullRateGateConfig;
  metric?: MetricGateConfig;
}

// ---------------------------------------------------------------------------
// Input passed to every gate check
// ---------------------------------------------------------------------------

export interface GateCheckInput {
  /** Absolute path to the CSV output file produced by the step. */
  csvPath: string;
  /** Step-level gates configuration from the template. */
  gates: GatesConfig;
  /** Step metadata from the pipeline executor. */
  stepMeta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Gate result
// ---------------------------------------------------------------------------

export type GateVerdict = 'pass' | 'fail' | 'warning';

export interface GateResult {
  gate: string;
  verdict: GateVerdict;
  message: string;
  /** Machine-readable details (e.g. missing columns, null counts). */
  details?: Record<string, unknown>;
  /** Duration of the gate execution in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Gate interface
// ---------------------------------------------------------------------------

export interface PipelineGate {
  readonly name: string;
  check(input: GateCheckInput): GateResult | Promise<GateResult>;
}

// ---------------------------------------------------------------------------
// Runner result
// ---------------------------------------------------------------------------

export interface GateRunnerResult {
  passed: boolean;
  results: GateResult[];
}
