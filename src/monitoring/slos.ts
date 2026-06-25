/**
 * SLIs and SLOs — Service Level Indicators and Objectives.
 *
 * Defines the measurable indicators (SLIs) and their target thresholds (SLOs)
 * for production monitoring. These are used by the alerting system to determine
 * when service health is at risk.
 *
 * ── SLIs ────────────────────────────────────────────────────────────
 *   webhook_processing_latency_p99  — p99 latency of webhook processing
 *   queue_processing_time_p95       — p95 time from enqueue to completion
 *   agent_success_rate              — percentage of agent runs that succeed
 *   uptime                          — service availability percentage
 * ────────────────────────────────────────────────────────────────────
 *
 * ── SLO Targets ─────────────────────────────────────────────────────
 *   Webhook processing latency p99   < 5s
 *   Queue processing time p95        < 15min
 *   Agent success rate               > 90%
 *   Uptime                           > 99.9%
 * ────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'slos' });

// ── Types ───────────────────────────────────────────────────────────

export type SLIName =
  | 'webhook_processing_latency_p99'
  | 'queue_processing_time_p95'
  | 'agent_success_rate'
  | 'uptime';

export type SLOStatus = 'compliant' | 'warning' | 'breached';

export interface SLIDefinition {
  name: SLIName;
  description: string;
  unit: 'ms' | 'seconds' | 'minutes' | 'percent';
  target: number;
  operator: 'lt' | 'gt';
  window: string;
  currentValue: number;
  status: SLOStatus;
  errorBudgetRemaining?: number;
}

export interface SLOReport {
  timestamp: string;
  overallStatus: 'passing' | 'at_risk' | 'failing';
  compliant: number;
  warning: number;
  breached: number;
  slis: SLIDefinition[];
}

// ── SLI/SLO Definitions ────────────────────────────────────────────

export const SLO_TARGETS: Omit<SLIDefinition, 'currentValue' | 'status'>[] = [
  {
    name: 'webhook_processing_latency_p99',
    description: 'p99 latency for webhook processing (verify, log, enqueue)',
    unit: 'seconds',
    target: 5,
    operator: 'lt',
    window: '5m',
  },
  {
    name: 'queue_processing_time_p95',
    description: 'p95 time from job enqueue to completion',
    unit: 'minutes',
    target: 15,
    operator: 'lt',
    window: '1h',
  },
  {
    name: 'agent_success_rate',
    description: 'Percentage of agent fix runs that complete successfully',
    unit: 'percent',
    target: 90,
    operator: 'gt',
    window: '24h',
  },
  {
    name: 'uptime',
    description: 'Overall service availability (health check success rate)',
    unit: 'percent',
    target: 99.9,
    operator: 'gt',
    window: '30d',
  },
];

// ── Evaluator ───────────────────────────────────────────────────────

function evaluateSLI(
  sli: Omit<SLIDefinition, 'currentValue' | 'status'>,
  currentValue: number,
  errorBudgetRemaining?: number,
): SLIDefinition {
  let status: SLOStatus;
  if (sli.operator === 'lt') {
    status =
      currentValue < sli.target
        ? 'compliant'
        : currentValue < sli.target * 1.2
          ? 'warning'
          : 'breached';
  } else {
    status =
      currentValue >= sli.target
        ? 'compliant'
        : currentValue >= sli.target * 0.8
          ? 'warning'
          : 'breached';
  }

  return { ...sli, currentValue, status, errorBudgetRemaining };
}

/**
 * Generate a full SLO report from current metrics.
 */
export function generateSLOReport(
  overrides?: Partial<Record<SLIName, number>>,
): SLOReport {
  const webhookLatency =
    overrides?.webhook_processing_latency_p99 ?? getWebhookLatencyP99();
  const queueTime =
    overrides?.queue_processing_time_p95 ?? getQueueProcessingTimeP95();
  const agentSuccess = overrides?.agent_success_rate ?? getAgentSuccessRate();
  const uptimeVal = overrides?.uptime ?? getUptime();

  const slis: SLIDefinition[] = [
    evaluateSLI(SLO_TARGETS[0], webhookLatency),
    evaluateSLI(SLO_TARGETS[1], queueTime),
    evaluateSLI(SLO_TARGETS[2], agentSuccess),
    evaluateSLI(SLO_TARGETS[3], uptimeVal),
  ];

  const compliant = slis.filter((s) => s.status === 'compliant').length;
  const warning = slis.filter((s) => s.status === 'warning').length;
  const breached = slis.filter((s) => s.status === 'breached').length;

  let overallStatus: SLOReport['overallStatus'];
  if (breached > 0) overallStatus = 'failing';
  else if (warning > 0) overallStatus = 'at_risk';
  else overallStatus = 'passing';

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    compliant,
    warning,
    breached,
    slis,
  };
}

// ── Metric Readers (placeholders — wire to Prometheus in production) ─

function getWebhookLatencyP99(): number {
  return 0;
}

function getQueueProcessingTimeP95(): number {
  return 0;
}

function getAgentSuccessRate(): number {
  return 100;
}

function getUptime(): number {
  return 100;
}

/**
 * Record SLI metrics as Prometheus gauges for dashboard use.
 */
export function recordSLIMetrics(report: SLOReport): void {
  for (const sli of report.slis) {
    bridgeMetrics.setGauge(
      'sli_current_value',
      { sli: sli.name, unit: sli.unit },
      sli.currentValue,
    );
    bridgeMetrics.setGauge(
      'sli_target',
      { sli: sli.name, unit: sli.unit },
      sli.target,
    );
    bridgeMetrics.setGauge(
      'sli_status',
      { sli: sli.name },
      sli.status === 'compliant' ? 0 : sli.status === 'warning' ? 1 : 2,
    );
  }
  bridgeMetrics.setGauge(
    'slo_overall_status',
    {},
    report.overallStatus === 'passing'
      ? 0
      : report.overallStatus === 'at_risk'
        ? 1
        : 2,
  );
}
