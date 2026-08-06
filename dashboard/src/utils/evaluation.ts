import type { DashboardStats, Run } from '@/api/types';

export type Severity = 'good' | 'warning' | 'critical' | 'empty';

/**
 * Evaluate pass rate severity.
 * >= 85 → good, 50-84 → warning, < 50 → critical, null → empty.
 */
export function evaluatePassRate(rate: number | null): Severity {
  if (rate === null || rate === undefined) return 'empty';
  if (rate >= 85) return 'good';
  if (rate >= 50) return 'warning';
  return 'critical';
}

/**
 * Evaluate speed severity.
 * <= 180s → good, 181-300s → warning, > 300s → critical, null → empty.
 */
export function evaluateSpeed(seconds: number | null): Severity {
  if (seconds === null || seconds === undefined) return 'empty';
  if (seconds <= 180) return 'good';
  if (seconds <= 300) return 'warning';
  return 'critical';
}

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute health score from dashboard stats.
 * score = round(passRate * 0.5 + speedScore * 0.3 + errorScore * 0.2)
 */
export function computeHealthScore(stats: DashboardStats | null): {
  score: number | null;
  severity: Severity;
  breakdown: { passRate: number; speedScore: number; errorScore: number };
} {
  if (!stats || typeof stats.passRate !== 'number' || typeof stats.avgDurationSeconds !== 'number') {
    return {
      score: null,
      severity: 'empty',
      breakdown: { passRate: 0, speedScore: 0, errorScore: 0 },
    };
  }

  const passRateComponent = stats.passRate;
  const speedScore = clamp(100 - (Math.max(0, stats.avgDurationSeconds - 180) / 600) * 100, 0, 100);
  const dayTotal = stats.runsByDay.reduce((s, d) => s + d.count, 0);
  const dayPassed = stats.runsByDay.reduce((s, d) => s + d.passed, 0);
  const failureRate = dayTotal > 0 ? (1 - dayPassed / dayTotal) * 100 : 0;
  const errorScore = clamp(100 - failureRate, 0, 100);
  const score = Math.round(passRateComponent * 0.5 + speedScore * 0.3 + errorScore * 0.2);

  let severity: Severity = 'critical';
  if (score >= 85) severity = 'good';
  else if (score >= 50) severity = 'warning';

  return {
    score,
    severity,
    breakdown: { passRate: passRateComponent, speedScore, errorScore },
  };
}

export interface Recommendation {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  titleKey: string;
  descKey: string;
  actionKey?: string;
  to?: string;
}

/**
 * Build recommendations based on dashboard state.
 */
export function buildRecommendations(
  stats: DashboardStats | null,
  usedFixes: number,
  monthlyLimit: number,
  isUnlimited: boolean,
  hasFailedRuns: boolean,
): Recommendation[] {
  const recs: Recommendation[] = [];

  if (!isUnlimited && monthlyLimit > 0) {
    const usagePct = (usedFixes / monthlyLimit) * 100;
    if (usagePct >= 100) {
      recs.push({
        id: 'usage-exhausted',
        severity: 'critical',
        titleKey: 'dashboard.usageExhausted',
        descKey: 'dashboard.usageExhaustedDesc',
        actionKey: 'dashboard.upgrade',
        to: '/billing',
      });
    } else if (usagePct >= 80) {
      recs.push({
        id: 'usage-warning',
        severity: 'warning',
        titleKey: 'dashboard.usageWarning',
        descKey: 'dashboard.usageWarningDesc',
        actionKey: 'dashboard.upgrade',
        to: '/billing',
      });
    }
  }

  const passRate = stats && typeof stats.passRate === 'number' ? stats.passRate : null;

  if (passRate !== null) {
    if (passRate < 50) {
      recs.push({
        id: 'pass-rate-critical',
        severity: 'critical',
        titleKey: 'dashboard.passRateCritical',
        descKey: 'dashboard.passRateCriticalDesc',
        actionKey: 'dashboard.viewFailedRuns',
        to: '/runs?status=failed',
      });
    } else if (passRate < 85) {
      recs.push({
        id: 'pass-rate-warning',
        severity: 'warning',
        titleKey: 'dashboard.passRateWarning',
        descKey: 'dashboard.passRateWarningDesc',
      });
    }
  }

  const noRuns = !stats || (stats.totalRuns === 0 && !hasFailedRuns);
  const noRepos = stats && stats.activeRepos === 0;

  if (noRuns) {
    recs.push({
      id: 'no-runs',
      severity: 'info',
      titleKey: 'dashboard.noRunsRec',
      descKey: 'dashboard.noRunsRecDesc',
      actionKey: 'dashboard.connectRepos',
      to: '/repos',
    });
  }

  if (noRepos) {
    recs.push({
      id: 'no-repos',
      severity: 'info',
      titleKey: 'dashboard.noReposRec',
      descKey: 'dashboard.noReposRecDesc',
      actionKey: 'dashboard.connectRepos',
      to: '/repos',
    });
  }

  return recs;
}

/**
 * Format usage string: "0/10" style.
 */
export function formatUsage(usedFixes: number, monthlyLimit: number, isUnlimited: boolean): string {
  if (isUnlimited) return String(usedFixes);
  return `${usedFixes}/${monthlyLimit}`;
}

export interface RepoHealth {
  repo: string;
  bugsDetected: number;
  issuesCreated: number;
  pending: number;
  done: number;
  totalRuns: number;
  passRate: number;
  lastRunAt: string;
  failedRuns: Array<{ id: string; issueNumber: number; errorMessage: string | undefined }>;
}

export function aggregateRepoHealth(runs: Run[]): RepoHealth[] {
  const map = new Map<string, RepoHealth>();

  for (const run of runs) {
    const key = `${run.repoOwner}/${run.repoName}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        repo: key,
        bugsDetected: 0,
        issuesCreated: 0,
        pending: 0,
        done: 0,
        totalRuns: 0,
        passRate: 0,
        lastRunAt: run.createdAt,
        failedRuns: [],
      };
      map.set(key, entry);
    }

    entry.totalRuns++;

    if (run.status === 'failed') {
      entry.bugsDetected++;
      if (entry.failedRuns.length < 3) {
        entry.failedRuns.push({
          id: run.id,
          issueNumber: run.issueNumber,
          errorMessage: run.errorMessage,
        });
      }
    }
    if (run.status === 'success' || run.status === 'completed') entry.done++;
    if (run.status === 'queued' || run.status === 'pending' || run.status === 'running') entry.pending++;

    if (run.createdAt > entry.lastRunAt) {
      entry.lastRunAt = run.createdAt;
    }
  }

  for (const entry of map.values()) {
    const issues = new Set<number>();
    for (const run of runs) {
      if (`${run.repoOwner}/${run.repoName}` === entry.repo) {
        issues.add(run.issueNumber);
      }
    }
    entry.issuesCreated = issues.size;
    entry.passRate = entry.totalRuns > 0 ? Math.round((entry.done / entry.totalRuns) * 100) : 0;
  }

  return Array.from(map.values()).sort((a, b) => (b.lastRunAt > a.lastRunAt ? 1 : b.lastRunAt < a.lastRunAt ? -1 : 0));
}

// ── Project evaluation system ────────────────────────────────────────────────
//
// Evaluation model (user-specified framework):
//   1. Criteria  — exact thresholds defining "good" per rubric item
//   2. Evidence  — the raw data backing each score (quantitative, from runs/stats)
//   3. Rubrics   — weighted 0..100 score converting evidence into a verdict
//   4. Feedback  — computeFeedbackLoop() compares snapshots so results drive
//                  improvement (evaluate → act → re-evaluate)

export type Verdict = 'good' | 'warning' | 'critical' | 'empty';

export interface RubricItem {
  id: string;
  labelKey: string;
  value: number | null;
  criteria: string;
  severity: Severity;
  evidence: string;
  weight: number;
  higherIsBetter: boolean;
}

export interface ProjectEvaluation {
  timestamp: string;
  score: number | null;
  verdict: Verdict;
  rubric: RubricItem[];
  actions: string[];
}

export interface FeedbackDelta {
  id: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  severityBefore: Severity;
  severityAfter: Severity;
  trend: 'improved' | 'regressed' | 'unchanged' | 'new';
}

export interface ProjectEvaluationInput {
  runs: Run[];
  stats: DashboardStats | null;
  usedFixes: number;
  monthlyLimit: number;
  isUnlimited: boolean;
}

const SEVERITY_SCORE: Record<Severity, number> = { good: 100, warning: 60, critical: 20, empty: 0 };

function fmtSeconds(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '\u2014';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Evaluate project health against explicit criteria with evidence.
 * Every rubric item carries: the measured value, the acceptance threshold,
 * the severity verdict and the raw evidence backing it.
 */
export function evaluateProject(input: ProjectEvaluationInput): ProjectEvaluation {
  const { runs, stats, usedFixes, monthlyLimit, isUnlimited } = input;
  const rubric: RubricItem[] = [];

  const passRate = stats && typeof stats.passRate === 'number' ? stats.passRate : null;
  rubric.push({
    id: 'pass-rate',
    labelKey: 'overview.rubric.passRate',
    value: passRate,
    criteria: '\u2265 85% good \u00b7 50\u201384% warning \u00b7 < 50% critical',
    severity: evaluatePassRate(passRate),
    evidence: passRate === null ? '\u2014' : `${Math.round(passRate)}% of runs pass (${Math.round(passRate)}/100)`,
    weight: 0.4,
    higherIsBetter: true,
  });

  const avgSpeed = stats && typeof stats.avgDurationSeconds === 'number' ? stats.avgDurationSeconds : null;
  rubric.push({
    id: 'speed',
    labelKey: 'overview.rubric.speed',
    value: avgSpeed,
    criteria: '\u2264 3m good \u00b7 3\u20135m warning \u00b7 > 5m critical',
    severity: evaluateSpeed(avgSpeed),
    evidence: avgSpeed === null ? '\u2014' : `avg ${fmtSeconds(avgSpeed)} per run`,
    weight: 0.2,
    higherIsBetter: false,
  });

  const failed = runs.filter((r) => r.status === 'failed').length;
  const failureRate = runs.length > 0 ? (failed / runs.length) * 100 : null;
  rubric.push({
    id: 'failure-rate',
    labelKey: 'overview.rubric.failureRate',
    value: failureRate,
    criteria: '\u2264 10% good \u00b7 10\u201330% warning \u00b7 > 30% critical',
    severity:
      failureRate === null ? 'empty' : failureRate <= 10 ? 'good' : failureRate <= 30 ? 'warning' : 'critical',
    evidence: failureRate === null ? '\u2014' : `${failed}/${runs.length} runs failed (${Math.round(failureRate)}%)`,
    weight: 0.25,
    higherIsBetter: false,
  });

  const usagePct = !isUnlimited && monthlyLimit > 0 ? (usedFixes / monthlyLimit) * 100 : null;
  rubric.push({
    id: 'usage',
    labelKey: 'overview.rubric.usage',
    value: usagePct,
    criteria: '< 80% good \u00b7 80\u201399% warning \u00b7 \u2265 100% critical',
    severity:
      usagePct === null ? 'good' : usagePct >= 100 ? 'critical' : usagePct >= 80 ? 'warning' : 'good',
    evidence: isUnlimited || usagePct === null ? 'Unlimited plan' : `${usedFixes}/${monthlyLimit} fixes used (${Math.round(usagePct)}%)`,
    weight: 0.15,
    higherIsBetter: false,
  });

  const hasActivity = runs.length > 0 || (stats !== null && (stats.totalRuns ?? 0) > 0);
  const activeItems = rubric.filter((r) => r.severity !== 'empty');
  const totalWeight = activeItems.reduce((s, r) => s + r.weight, 0);
  const score =
    !hasActivity || activeItems.length === 0 || totalWeight === 0
      ? null
      : Math.round(activeItems.reduce((s, r) => s + SEVERITY_SCORE[r.severity] * r.weight, 0) / totalWeight);

  let verdict: Verdict = 'empty';
  if (hasActivity && score !== null) verdict = score >= 85 ? 'good' : score >= 50 ? 'warning' : 'critical';

  const actions: string[] = [];
  if (failed > 0) actions.push('overview.action.createTickets');
  if (passRate !== null && passRate < 50) actions.push('overview.action.reviewFailedRuns');
  if (usagePct !== null && usagePct >= 80) actions.push('overview.action.checkUsage');

  return {
    timestamp: new Date().toISOString(),
    score,
    verdict,
    rubric,
    actions,
  };
}

/**
 * Feedback loop: compare a previous evaluation snapshot with the current one
 * and report the per-metric delta so the team can see whether actions
 * (e.g. created tickets) moved the metrics.
 */
export function computeFeedbackLoop(
  previous: ProjectEvaluation | null,
  current: ProjectEvaluation,
): FeedbackDelta[] {
  if (!previous) return [];
  return current.rubric.map((item) => {
    const before = previous.rubric.find((p) => p.id === item.id);
    if (!before || before.value === null) {
      return {
        id: item.id,
        before: null,
        after: item.value,
        delta: null,
        severityBefore: 'empty',
        severityAfter: item.severity,
        trend: 'new',
      };
    }
    const delta = item.value === null ? null : item.value - before.value;
    const normDelta =
      delta === null ? null : item.higherIsBetter ? delta : -delta;
    const trend: FeedbackDelta['trend'] =
      normDelta === null
        ? 'unchanged'
        : Math.abs(normDelta) < 0.5
          ? 'unchanged'
          : normDelta > 0
            ? 'improved'
            : 'regressed';
    return {
      id: item.id,
      before: before.value,
      after: item.value,
      delta,
      severityBefore: before.severity,
      severityAfter: item.severity,
      trend,
    };
  });
}
