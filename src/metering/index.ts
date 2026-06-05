/**
 * Metering service entry point.
 *
 * Exports all public API for the usage metering & tracking service.
 * To integrate:
 *   1. Import `initMetering()` in your server startup.
 *   2. Mount `usageRouter` on `/api/v1/credits/usage`.
 *   3. Use `UsageTracker` or `withUsageTracking()` to wrap pipeline runs.
 */

export { UsageTracker, withUsageTracking, getUsageStore } from './tracker.js';
export type { UsageTrackerOptions, AgentRunInfo } from './tracker.js';

export { getCostConfig, resetCostConfig, setCostConfig, calculatePipelineCost, computeSandboxMultiplier, isWithinFreeTier } from './costs.js';
export type { CostConfig } from './costs.js';

export { meteringEvents } from './events.js';
export type { UsageRecord, PhaseUsage, MeteringEvents } from './events.js';

export { usageRouter } from './routes.js';

import { rootLogger } from '../utils/logger.js';
import { getCostConfig } from './costs.js';

const log = rootLogger.child({ module: 'metering' });

/**
 * Initialize the metering service.
 * Call this once at server startup.
 */
export function initMetering(): void {
  const cfg = getCostConfig();

  log.info(
    {
      triage: cfg.triage,
      opencodePrimary: cfg.opencodePrimary,
      opencodeFallback: cfg.opencodeFallback,
      prCreation: cfg.prCreation,
      retryPenalty: cfg.retryPenalty,
      freeMonthlyCredits: cfg.freeMonthlyCredits,
    },
    'Usage metering initialized',
  );
}
