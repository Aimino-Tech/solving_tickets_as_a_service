/**
 * Cost Breakdown — per-tenant, per-fix cost tracking.
 *
 * Tracks and aggregates costs across three dimensions:
 *   - Model cost (LLM inference tokens)
 *   - Sandbox cost (E2B / container runtime)
 *   - Compute cost (CPU time, memory, network)
 *
 * Each FixCostEntry records a single fix run's cost. The module provides
 * aggregators for tenant-level summaries, time-window rollups, and total
 * spend reporting.
 *
 * Costs are stored in the smallest practical unit (millicents) to avoid
 * floating-point drift. Display helpers convert to cents/dollars.
 *
 * In production, the entries array would be backed by PostgreSQL or
 * Prometheus metrics. The in-memory store here serves as the reference
 * implementation for dashboards and API responses.
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'cost-breakdown' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostComponents {
  /** LLM inference cost in millicents (1/1000 of a cent) */
  modelMillicents: number;
  /** Sandbox / E2B runtime cost in millicents */
  sandboxMillicents: number;
  /** Compute (CPU + memory + network) cost in millicents */
  computeMillicents: number;
}

export interface FixCostEntry {
  id: string;
  tenantId: string;
  repo: string;
  issueNumber: number;
  timestamp: string;
  model: string;
  cost: CostComponents;
  /** Total input tokens used */
  inputTokens: number;
  /** Total output tokens generated */
  outputTokens: number;
  /** Duration of the fix run in milliseconds */
  durationMs: number;
}

export interface CostAggregate {
  tenantId: string;
  /** Number of fix runs in the aggregate */
  fixCount: number;
  /** Total cost in millicents */
  totalMillicents: number;
  /** Average cost per fix in millicents */
  avgMillicentsPerFix: number;
  /** Breakdown by cost component (totals) */
  totals: CostComponents;
  /** Breakdown by cost component (averages) */
  averages: CostComponents;
  /** Timestamp range */
  firstRun: string;
  lastRun: string;
}

export type CostSortField = 'totalMillicents' | 'fixCount' | 'avgMillicentsPerFix';
export type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// In-memory store (reference implementation)
// ---------------------------------------------------------------------------

const entries: FixCostEntry[] = [];

// Default model cost rates (millicents per 1K tokens) for cost estimation
const DEFAULT_MODEL_RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
  'claude-haiku': { input: 0.025, output: 0.125 },
  'gpt-4o': { input: 0.5, output: 1.5 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
};

// Default sandbox cost: 100 millicents/second ($0.001/s)
const DEFAULT_SANDBOX_MILLICENTS_PER_MS = 0.1;

// Default compute cost: 50 millicents/second ($0.0005/s)
const DEFAULT_COMPUTE_MILLICENTS_PER_MS = 0.05;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `fix-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate model cost from token counts.
 */
export function estimateModelCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const rates = DEFAULT_MODEL_RATES[model];
  if (!rates) {
    log.warn({ model }, 'Unknown model, using claude-sonnet-4 rates as fallback');
    const fallback = DEFAULT_MODEL_RATES['claude-sonnet-4-20250514'];
    return Math.round(
      (inputTokens / 1000) * fallback.input +
        (outputTokens / 1000) * fallback.output,
    );
  }
  return Math.round(
    (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output,
  );
}

/**
 * Estimate sandbox cost from run duration.
 */
export function estimateSandboxCost(durationMs: number): number {
  return Math.round(durationMs * DEFAULT_SANDBOX_MILLICENTS_PER_MS);
}

/**
 * Estimate compute cost from run duration.
 */
export function estimateComputeCost(durationMs: number): number {
  return Math.round(durationMs * DEFAULT_COMPUTE_MILLICENTS_PER_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a fix cost entry. Accepts partial cost data; missing components
 * are estimated from token counts and duration.
 */
export function recordFixCost(
  entry: Omit<FixCostEntry, 'id' | 'cost'> & { cost?: Partial<CostComponents> },
): FixCostEntry {
  const cost: CostComponents = {
    modelMillicents:
      entry.cost?.modelMillicents ?? estimateModelCost(entry.inputTokens, entry.outputTokens, entry.model),
    sandboxMillicents:
      entry.cost?.sandboxMillicents ?? estimateSandboxCost(entry.durationMs),
    computeMillicents:
      entry.cost?.computeMillicents ?? estimateComputeCost(entry.durationMs),
  };

  const fullEntry: FixCostEntry = {
    ...entry,
    id: generateId(),
    cost,
  };

  entries.push(fullEntry);

  log.debug(
    {
      tenantId: entry.tenantId,
      totalMillicents: cost.modelMillicents + cost.sandboxMillicents + cost.computeMillicents,
      model: entry.model,
    },
    'Fix cost recorded',
  );

  return fullEntry;
}

/**
 * Get all fix cost entries, optionally filtered by tenant.
 */
export function getFixCosts(tenantId?: string): FixCostEntry[] {
  if (tenantId) {
    return entries.filter((e) => e.tenantId === tenantId);
  }
  return [...entries];
}

/**
 * Aggregate costs for a tenant over all recorded entries.
 */
export function getTenantCostAggregate(tenantId: string): CostAggregate {
  const tenantEntries = entries.filter((e) => e.tenantId === tenantId);

  if (tenantEntries.length === 0) {
    return {
      tenantId,
      fixCount: 0,
      totalMillicents: 0,
      avgMillicentsPerFix: 0,
      totals: { modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0 },
      averages: { modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0 },
      firstRun: '',
      lastRun: '',
    };
  }

  const totals: CostComponents = tenantEntries.reduce(
    (acc, e) => ({
      modelMillicents: acc.modelMillicents + e.cost.modelMillicents,
      sandboxMillicents: acc.sandboxMillicents + e.cost.sandboxMillicents,
      computeMillicents: acc.computeMillicents + e.cost.computeMillicents,
    }),
    { modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0 },
  );

  const totalMillicents =
    totals.modelMillicents + totals.sandboxMillicents + totals.computeMillicents;

  return {
    tenantId,
    fixCount: tenantEntries.length,
    totalMillicents,
    avgMillicentsPerFix: Math.round(totalMillicents / tenantEntries.length),
    totals,
    averages: {
      modelMillicents: Math.round(totals.modelMillicents / tenantEntries.length),
      sandboxMillicents: Math.round(totals.sandboxMillicents / tenantEntries.length),
      computeMillicents: Math.round(totals.computeMillicents / tenantEntries.length),
    },
    firstRun: tenantEntries[0].timestamp,
    lastRun: tenantEntries[tenantEntries.length - 1].timestamp,
  };
}

/**
 * Aggregate costs for all tenants.
 */
export function getAllTenantCostAggregates(
  sortBy?: CostSortField,
  direction?: SortDirection,
): CostAggregate[] {
  const tenantIds = [...new Set(entries.map((e) => e.tenantId))];
  const aggregates = tenantIds.map((id) => getTenantCostAggregate(id));

  if (sortBy) {
    const dir = direction === 'desc' ? -1 : 1;
    aggregates.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      return (aVal - bVal) * dir;
    });
  }

  return aggregates;
}

/**
 * Get total cost across all tenants.
 */
export function getGlobalCostSummary(): {
  totalMillicents: number;
  totalFixes: number;
  avgCostPerFix: number;
  breakdown: CostComponents;
} {
  const totalFixes = entries.length;
  const breakdown: CostComponents = entries.reduce(
    (acc, e) => ({
      modelMillicents: acc.modelMillicents + e.cost.modelMillicents,
      sandboxMillicents: acc.sandboxMillicents + e.cost.sandboxMillicents,
      computeMillicents: acc.computeMillicents + e.cost.computeMillicents,
    }),
    { modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0 },
  );

  const totalMillicents =
    breakdown.modelMillicents + breakdown.sandboxMillicents + breakdown.computeMillicents;

  return {
    totalMillicents,
    totalFixes,
    avgCostPerFix: totalFixes > 0 ? Math.round(totalMillicents / totalFixes) : 0,
    breakdown,
  };
}

/**
 * Convert millicents to cents (2 decimal places).
 */
export function millicentsToCents(millicents: number): number {
  return Math.round(millicents) / 1000;
}

/**
 * Convert millicents to dollars (4 decimal places).
 */
export function millicentsToDollars(millicents: number): number {
  return Math.round(millicents) / 100000;
}

/**
 * Clear all stored entries (for testing).
 */
export function clearEntries(): void {
  entries.length = 0;
}
