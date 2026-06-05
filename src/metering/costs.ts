/**
 * Credit cost configuration per model.
 *
 * Costs are read from the Zod-validated config object.
 * The base cost for each model/layer is multiplied by a sandbox time factor
 * when the actual sandbox duration deviates from the baseline.
 *
 * ── Credit Cost Formula ───────────────────────────────────────────────
 *   total = triage_cost
 *         + primary_run_cost × sandbox_multiplier
 *         + fallback_run_cost × fallback_retries × sandbox_multiplier
 *         + retry_penalty × retry_attempts
 *         + pr_creation_cost
 *
 *   sandbox_multiplier = max(0.5, min(2.0, actual_duration / baseline_duration))
 *
 *   Free tier: limited to FREE_MONTHLY_CREDITS credits/month, resets monthly.
 * ──────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostConfig {
  /** Credits for the cheap triage/classification call */
  triage: number;

  /** Credits per primary OpenCode agent run */
  opencodePrimary: number;

  /** Credits per fallback model invocation */
  opencodeFallback: number;

  /** Fixed cost for creating a PR */
  prCreation: number;

  /** Penalty in credits per retry attempt (added on top of the run cost) */
  retryPenalty: number;

  /** Baseline sandbox duration in ms used for the time multiplier denominator */
  baselineSandboxDurationMs: number;

  /** Free tier monthly credit allowance (0 = unlimited) */
  freeMonthlyCredits: number;

  /** Sandbox multiplier clamp — minimum factor */
  sandboxMultiplierMin: number;

  /** Sandbox multiplier clamp — maximum factor */
  sandboxMultiplierMax: number;
}

const DEFAULTS: CostConfig = {
  triage: 1,
  opencodePrimary: 10,
  opencodeFallback: 5,
  prCreation: 2,
  retryPenalty: 3,
  baselineSandboxDurationMs: 300_000,
  freeMonthlyCredits: 100,
  sandboxMultiplierMin: 0.5,
  sandboxMultiplierMax: 2.0,
};

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let _costConfig: CostConfig | null = null;

function loadFromConfig(): CostConfig | null {
  try {
    const mod = require('../config.js');
    const cfg = mod.config;
    return {
      triage: cfg.metering.costTriage,
      opencodePrimary: cfg.metering.costOpencodePrimary,
      opencodeFallback: cfg.metering.costOpencodeFallback,
      prCreation: cfg.metering.costPrCreation,
      retryPenalty: cfg.metering.costRetryPenalty,
      baselineSandboxDurationMs: cfg.metering.baselineSandboxMs,
      freeMonthlyCredits: cfg.metering.freeMonthlyCredits,
      sandboxMultiplierMin: cfg.metering.sandboxMultiplierMin,
      sandboxMultiplierMax: cfg.metering.sandboxMultiplierMax,
    };
  } catch {
    return null;
  }
}

function loadFromEnv(): CostConfig {
  return {
    triage: envInt('METERING_COST_TRIAGE', DEFAULTS.triage),
    opencodePrimary: envInt('METERING_COST_OPENCODE_PRIMARY', DEFAULTS.opencodePrimary),
    opencodeFallback: envInt('METERING_COST_OPENCODE_FALLBACK', DEFAULTS.opencodeFallback),
    prCreation: envInt('METERING_COST_PR_CREATION', DEFAULTS.prCreation),
    retryPenalty: envInt('METERING_COST_RETRY_PENALTY', DEFAULTS.retryPenalty),
    baselineSandboxDurationMs: envInt('METERING_BASELINE_SANDBOX_MS', DEFAULTS.baselineSandboxDurationMs),
    freeMonthlyCredits: envInt('METERING_FREE_MONTHLY_CREDITS', DEFAULTS.freeMonthlyCredits),
    sandboxMultiplierMin: envFloat('METERING_SANDBOX_MULTIPLIER_MIN', DEFAULTS.sandboxMultiplierMin),
    sandboxMultiplierMax: envFloat('METERING_SANDBOX_MULTIPLIER_MAX', DEFAULTS.sandboxMultiplierMax),
  };
}

export function getCostConfig(): CostConfig {
  if (_costConfig) return _costConfig;
  _costConfig = loadFromConfig() ?? loadFromEnv();
  return _costConfig;
}

/**
 * Reset the cached config (useful for tests).
 */
export function resetCostConfig(): void {
  _costConfig = null;
}

/**
 * Override the cost config (useful for tests).
 */
export function setCostConfig(overrides: Partial<CostConfig>): CostConfig {
  const current = getCostConfig();
  _costConfig = { ...current, ...overrides };
  return _costConfig;
}

// ---------------------------------------------------------------------------
// Cost calculation helpers
// ---------------------------------------------------------------------------

/**
 * Compute the sandbox time multiplier.
 * Clamped between [min, max] so costs don't go to zero or infinity.
 */
export function computeSandboxMultiplier(
  actualDurationMs: number,
  baselineMs?: number,
  min?: number,
  max?: number,
): number {
  const cfg = getCostConfig();
  const baseline = baselineMs ?? cfg.baselineSandboxDurationMs;
  const lo = min ?? cfg.sandboxMultiplierMin;
  const hi = max ?? cfg.sandboxMultiplierMax;

  if (baseline <= 0) return 1.0;
  const raw = actualDurationMs / baseline;
  return Math.min(hi, Math.max(lo, raw));
}

/**
 * Calculate total credits for a full pipeline run.
 */
export function calculatePipelineCost(params: {
  triagePerformed: boolean;
  primaryRunCount: number;
  fallbackRunCount: number;
  retryCount: number;
  prCreated: boolean;
  sandboxDurationMs: number;
  sandboxBaselineMs?: number;
}): number {
  const cfg = getCostConfig();
  const multiplier = computeSandboxMultiplier(
    params.sandboxDurationMs,
    params.sandboxBaselineMs,
  );

  let total = 0;

  // Triage
  if (params.triagePerformed) {
    total += cfg.triage;
  }

  // Primary runs (rounded to avoid fractional credits)
  total += params.primaryRunCount * Math.round(cfg.opencodePrimary * multiplier);

  // Fallback runs
  total += params.fallbackRunCount * Math.round(cfg.opencodeFallback * multiplier);

  // Retry penalty (per retry attempt)
  total += params.retryCount * cfg.retryPenalty;

  // PR creation
  if (params.prCreated) {
    total += cfg.prCreation;
  }

  return total;
}

/**
 * Check if a given credit usage exceeds the free tier limit.
 */
export function isWithinFreeTier(monthlyCreditsUsed: number): boolean {
  const limit = getCostConfig().freeMonthlyCredits;
  if (limit <= 0) return true; // unlimited
  return monthlyCreditsUsed < limit;
}
