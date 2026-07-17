/**
 * Capacity Alerts — threshold-based alerting for capacity planning.
 *
 * Alert rules:
 *   - disk warning:  storage doubling time <= 90 days
 *   - disk critical: storage doubling time <= 45 days
 *   - cost_spike:    daily cost exceeds 2x the 7-day rolling average
 *   - growth_acceleration: WoW fix growth exceeds 20%
 */

import { rootLogger } from '../utils/logger.js';
import type { DailyCapacitySnapshot } from './capacityMetrics.js';

const log = rootLogger.child({ module: 'capacity-alerts' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapacityAlertSeverity = 'info' | 'warning' | 'critical';

export interface CapacityAlertEvent {
  severity: CapacityAlertSeverity;
  rule: string;
  message: string;
  currentValue: number;
  threshold: number;
  snapshotDate: string;
}

export type AlertHandler = (event: CapacityAlertEvent) => void;

// ---------------------------------------------------------------------------
// Default thresholds
// ---------------------------------------------------------------------------

/** Warning when storage doubling time <= this many days */
export const DISK_WARN_DOUBLE_DAYS = 90;
/** Critical when storage doubling time <= this many days */
export const DISK_CRIT_DOUBLE_DAYS = 45;

/** Cost spike threshold: multiplier of 7-day rolling average */
export const COST_SPIKE_MULTIPLIER = 2.0;
export const COST_ROLLING_WINDOW_DAYS = 7;

/** Growth acceleration: WoW increase percentage */
export const GROWTH_WOW_PERCENT = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.round(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Alert dispatch
// ---------------------------------------------------------------------------

const handlers: AlertHandler[] = [];

export function onAlert(handler: AlertHandler): void {
  handlers.push(handler);
}

function fireAlert(event: CapacityAlertEvent): void {
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      log.error({ err: String(err), rule: event.rule }, 'Capacity alert handler error');
    }
  }
  log.warn(
    { rule: event.rule, severity: event.severity, currentValue: event.currentValue, threshold: event.threshold },
    event.message,
  );
}

// ---------------------------------------------------------------------------
// Alert checks
// ---------------------------------------------------------------------------

export function checkDiskUsage(snapshots: DailyCapacitySnapshot[]): void {
  if (snapshots.length < 2) return;

  const latest = snapshots[0];

  // Calculate daily growth rate from the most recent snapshots (up to 7 days)
  const recentDays = Math.min(snapshots.length, 7);
  const oldestRecent = snapshots[recentDays - 1];
  const daySpan = Math.max(1, daysBetween(oldestRecent.snapshotDate, latest.snapshotDate));
  const dailyGrowthBytes = (latest.storage.totalBytes - oldestRecent.storage.totalBytes) / daySpan;

  if (dailyGrowthBytes <= 0) return;

  // Project days until storage doubles at current rate
  const daysToDouble = latest.storage.totalBytes / dailyGrowthBytes;

  if (daysToDouble <= DISK_CRIT_DOUBLE_DAYS) {
    fireAlert({
      severity: 'critical',
      rule: 'disk_90',
      message: `Storage doubling time is ${Math.round(daysToDouble)} days (≤${DISK_CRIT_DOUBLE_DAYS}) — critical growth rate`,
      currentValue: Math.round(daysToDouble),
      threshold: DISK_CRIT_DOUBLE_DAYS,
      snapshotDate: latest.snapshotDate,
    });
  } else if (daysToDouble <= DISK_WARN_DOUBLE_DAYS) {
    fireAlert({
      severity: 'warning',
      rule: 'disk_80',
      message: `Storage doubling time is ${Math.round(daysToDouble)} days (≤${DISK_WARN_DOUBLE_DAYS}) — warning growth rate`,
      currentValue: Math.round(daysToDouble),
      threshold: DISK_WARN_DOUBLE_DAYS,
      snapshotDate: latest.snapshotDate,
    });
  }
}

export function checkCostSpike(snapshots: DailyCapacitySnapshot[]): void {
  if (snapshots.length < COST_ROLLING_WINDOW_DAYS + 1) return;

  const latest = snapshots[0];

  // Calculate 7-day rolling average (excluding latest)
  const windowSnapshots = snapshots.slice(1, COST_ROLLING_WINDOW_DAYS + 1);
  const avgCost = windowSnapshots.reduce((sum, s) => sum + s.costs.totalMillicents, 0) / windowSnapshots.length;

  if (avgCost <= 0) return;

  const spikeRatio = latest.costs.totalMillicents / avgCost;

  if (spikeRatio >= COST_SPIKE_MULTIPLIER) {
    fireAlert({
      severity: 'warning',
      rule: 'cost_spike',
      message: `Daily cost (${latest.costs.totalMillicents} m¢) is ${spikeRatio.toFixed(1)}x the 7-day rolling average (${Math.round(avgCost)} m¢)`,
      currentValue: latest.costs.totalMillicents,
      threshold: Math.round(avgCost * COST_SPIKE_MULTIPLIER),
      snapshotDate: latest.snapshotDate,
    });
  }
}

export function checkGrowthAcceleration(snapshots: DailyCapacitySnapshot[]): void {
  if (snapshots.length < 14) return;

  const latest = snapshots[0];

  // Compare latest week vs previous week
  const thisWeek = snapshots.slice(0, 7);
  const lastWeek = snapshots.slice(7, 14);

  const thisWeekTotal = thisWeek.reduce((sum, s) => sum + s.fixes.totalRuns, 0);
  const lastWeekTotal = lastWeek.reduce((sum, s) => sum + s.fixes.totalRuns, 0);

  if (lastWeekTotal <= 0) return;

  const wowGrowth = ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100;

  if (wowGrowth >= GROWTH_WOW_PERCENT) {
    fireAlert({
      severity: 'warning',
      rule: 'growth_acceleration',
      message: `WoW fix growth is ${wowGrowth.toFixed(1)}% (this week: ${thisWeekTotal}, last week: ${lastWeekTotal}) — exceeds ${GROWTH_WOW_PERCENT}% threshold`,
      currentValue: wowGrowth,
      threshold: GROWTH_WOW_PERCENT,
      snapshotDate: latest.snapshotDate,
    });
  }
}

export function runAllChecks(snapshots: DailyCapacitySnapshot[]): CapacityAlertEvent[] {
  const fired: CapacityAlertEvent[] = [];
  const capture: AlertHandler = (event) => { fired.push(event); };

  const originalHandlers = [...handlers];
  handlers.length = 0;
  handlers.push(capture);

  try {
    checkDiskUsage(snapshots);
    checkCostSpike(snapshots);
    checkGrowthAcceleration(snapshots);
  } finally {
    handlers.length = 0;
    handlers.push(...originalHandlers);
  }

  return fired;
}

export function clearHandlers(): void {
  handlers.length = 0;
}
