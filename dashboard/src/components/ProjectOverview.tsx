import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Minus,
  RefreshCw,
  Ticket,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BillingPlan, CreateTicketResult, Ticket as StoredTicket } from '@/api/client';
import { billing, runs, stats, tickets } from '@/api/client';
import type { DashboardStats, Run } from '@/api/types';
import { SkeletonCard } from '@/components/LoadingSkeleton';
import MetricCard from '@/components/MetricCard';
import ProgressBar from '@/components/ProgressBar';
import StatusBadge from '@/components/StatusBadge';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import type { ProjectEvaluation, Severity } from '@/utils/evaluation';
import { aggregateRepoHealth, computeFeedbackLoop, evaluateProject, formatUsage } from '@/utils/evaluation';
import { formatRelativeTime } from '@/utils/format';

const POLL_INTERVAL_MS = 20_000;
const SNAPSHOT_KEY = 'syntaro:project-eval-snapshot';
const USAGE_WARNING_PCT = 80;

export type PlanTier = 'free' | 'solo' | 'team' | 'enterprise' | 'selfHosted';

const TIER_ALIASES: Record<string, PlanTier> = {
  free: 'free',
  pro: 'solo',
  solo: 'solo',
  team: 'team',
  enterprise: 'enterprise',
  selfhosted: 'selfHosted',
  self_hosted: 'selfHosted',
};

export function resolveTier(planId: string | undefined | null): PlanTier {
  if (!planId) return 'free';
  return TIER_ALIASES[planId.toLowerCase()] ?? 'free';
}

function isPending(status: Run['status']): boolean {
  return status === 'queued' || status === 'pending' || status === 'running';
}

function isDone(status: Run['status']): boolean {
  return status === 'success' || status === 'completed';
}

function isFailed(status: Run['status']): boolean {
  return status === 'failed';
}

type DrillKind = 'bugs' | 'issues' | 'pending' | 'done';

interface RunWarning {
  id: string;
  kind: 'run-failure' | 'usage';
  severity: Exclude<Severity, 'empty'>;
  run: Run | null;
  usage?: { used: number; limit: number; pct: number };
}

interface TicketModalState {
  warning: RunWarning;
  phase: 'review' | 'submitting' | 'done' | 'blocked';
  runId?: string;
  error?: string;
}

const EMPTY_RUNS_RESPONSE = {
  data: [] as Run[],
  total: 0,
  page: 1,
  perPage: 100,
  totalPages: 0,
};

export default function ProjectOverview({
  onSelectRun,
  onBrowseRuns,
}: {
  onSelectRun?: (run: Run) => void;
  onBrowseRuns?: (runs: Run[], titleKey: string, descKey: string) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [statsData, setStatsData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedWarning, setExpandedWarning] = useState<string | null>(null);
  const [ticketModal, setTicketModal] = useState<TicketModalState | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [previousEval, setPreviousEval] = useState<ProjectEvaluation | null>(null);
  const [autoTicketNotice, setAutoTicketNotice] = useState<string | null>(null);
  const [ticketsList, setTicketsList] = useState<StoredTicket[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const autoSubmittedRef = useRef<Set<string>>(new Set());

  const tier = useMemo(() => resolveTier(user?.plan || plan?.id), [user?.plan, plan?.id]);
  const isUnlimited = useMemo(() => {
    const limit = plan?.monthlyFixLimit;
    return typeof limit === 'number' ? limit < 0 || limit >= 999_999 : tier !== 'free' && tier !== 'solo';
  }, [plan?.monthlyFixLimit, tier]);
  const monthlyLimit = useMemo(() => {
    const apiLimit = plan?.monthlyFixLimit;
    if (typeof apiLimit === 'number') return apiLimit;
    const fallback: Record<PlanTier, number> = {
      free: 10,
      solo: 500,
      team: 999_999,
      enterprise: 999_999,
      selfHosted: 999_999,
    };
    return fallback[tier] ?? 10;
  }, [plan?.monthlyFixLimit, tier]);
  const usedFixes = useMemo(() => {
    if (statsData && typeof statsData.fixesUsedThisMonth === 'number') return statsData.fixesUsedThisMonth;
    const days = statsData?.runsByDay ?? [];
    if (days.length === 0) return statsData?.totalRuns ?? allRuns.length;
    const now = new Date();
    let sum = 0;
    let matched = false;
    for (const day of days) {
      const d = new Date(day.date);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        sum += day.count;
        matched = true;
      }
    }
    return matched ? sum : (statsData?.totalRuns ?? allRuns.length);
  }, [statsData, allRuns]);

  const repoHealth = useMemo(() => aggregateRepoHealth(allRuns), [allRuns]);
  const totalBugs = repoHealth.reduce((s, r) => s + r.bugsDetected, 0);
  const totalIssues = repoHealth.reduce((s, r) => s + r.issuesCreated, 0);
  const totalPending = repoHealth.reduce((s, r) => s + r.pending, 0);
  const totalDone = repoHealth.reduce((s, r) => s + r.done, 0);

  const kanban = useMemo(() => {
    const pending = allRuns.filter((r) => isPending(r.status));
    const done = allRuns.filter((r) => isDone(r.status));
    const failed = allRuns.filter((r) => isFailed(r.status));
    return { pending, done, failed };
  }, [allRuns]);

  const drillRuns = useMemo<Record<DrillKind, Run[]>>(() => {
    const seen = new Map<string, Run>();
    for (const run of allRuns) {
      const key = `${run.repoOwner}/${run.repoName}#${run.issueNumber}`;
      if (!seen.has(key)) seen.set(key, run);
    }
    return { bugs: kanban.failed, issues: Array.from(seen.values()), pending: kanban.pending, done: kanban.done };
  }, [allRuns, kanban]);

  const usagePct = useMemo(() => {
    if (isUnlimited || monthlyLimit <= 0) return null;
    return (usedFixes / monthlyLimit) * 100;
  }, [usedFixes, monthlyLimit, isUnlimited]);

  const warnings = useMemo<RunWarning[]>(() => {
    const list: RunWarning[] = [];
    for (const run of kanban.failed) {
      list.push({ id: `failure-${run.id}`, kind: 'run-failure', severity: 'critical', run });
    }
    if (usagePct !== null && usagePct >= USAGE_WARNING_PCT && kanban.failed.length === 0) {
      list.push({
        id: 'usage',
        kind: 'usage',
        severity: usagePct >= 100 ? 'critical' : 'warning',
        run: null,
        usage: { used: usedFixes, limit: monthlyLimit, pct: usagePct },
      });
    }
    return list;
  }, [kanban.failed, usagePct, usedFixes, monthlyLimit]);

  const evaluation = useMemo<ProjectEvaluation>(
    () => evaluateProject({ runs: allRuns, stats: statsData, usedFixes, monthlyLimit, isUnlimited }),
    [allRuns, statsData, usedFixes, monthlyLimit, isUnlimited],
  );

  const feedback = useMemo(() => computeFeedbackLoop(previousEval, evaluation), [previousEval, evaluation]);

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    try {
      const [planData, runsData, statsDataRes, ticketsRes] = await Promise.all([
        billing.plan().catch(() => null),
        runs.list({ perPage: 100 }, { signal: ac.signal }).catch(() => EMPTY_RUNS_RESPONSE),
        stats.get().catch(() => null),
        tickets.list({ signal: ac.signal }).catch(() => ({ tickets: [] as StoredTicket[] })),
      ]);
      if (ac.signal.aborted) return;
      setPlan(planData);
      setAllRuns(runsData.data);
      setStatsData(statsDataRes);
      setTicketsList(ticketsRes.tickets);
      setLastUpdated(new Date());
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let snapshot: ProjectEvaluation | null = null;
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (raw) snapshot = JSON.parse(raw) as ProjectEvaluation;
    } catch {
      snapshot = null;
    }
    setPreviousEval(snapshot);
    loadData(true);
    const interval = setInterval(() => loadData(false), POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [loadData]);

  useEffect(() => {
    if (evaluation.score === null) return;
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(evaluation));
    } catch {
      // localStorage unavailable — snapshot is best-effort
    }
  }, [evaluation]);

  const submitTicket = useCallback(async (warning: RunWarning, opts?: { signal?: AbortSignal }) => {
    if (!warning.run) throw new Error('No run attached to warning');
    const result = await tickets.create(
      {
        repoOwner: warning.run.repoOwner,
        repoName: warning.run.repoName,
        issueTitle: `Fix: ${warning.run.issueTitle}`,
        issueBody: warning.run.errorMessage || warning.run.issueTitle,
        source: 'dashboard-warning',
      },
      opts,
    );
    return result;
  }, []);

  const handleAutoSubmit = useCallback(
    async (warning: RunWarning) => {
      if (!warning.run || autoSubmittedRef.current.has(warning.run.id)) return;
      const run = warning.run;
      autoSubmittedRef.current.add(run.id);
      setAutoTicketNotice(t('overview.autoCreating', { issue: `${run.repoOwner}/${run.repoName}#${run.issueNumber}` }));
      try {
        const result: CreateTicketResult = await submitTicket(warning);
        setSubmittedIds((prev) => new Set(prev).add(run.id));
        setAutoTicketNotice(t('overview.autoCreated', { runId: result.runId.slice(0, 8) }));
      } catch {
        autoSubmittedRef.current.delete(run.id);
        setAutoTicketNotice(null);
      }
    },
    [submitTicket, t],
  );

  useEffect(() => {
    if (tier !== 'team') return;
    for (const run of allRuns) {
      if (isFailed(run.status)) {
        const warning: RunWarning = { id: `failure-${run.id}`, kind: 'run-failure', severity: 'critical', run };
        void handleAutoSubmit(warning);
      }
    }
  }, [allRuns, tier, handleAutoSubmit]);

  function openTicketModal(warning: RunWarning) {
    if (!warning.run) return;
    setTicketModal({ warning, phase: 'review' });
  }

  async function confirmCreateTicket() {
    const warning = ticketModal?.warning;
    if (!warning?.run) return;
    const runId = warning.run.id;
    setTicketModal({ warning, phase: 'submitting' });
    try {
      const result = await submitTicket(warning);
      setSubmittedIds((prev) => new Set(prev).add(runId));
      setTicketModal({ warning, phase: 'done', runId: result.runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create ticket';
      const isBlocked =
        message.toLowerCase().includes('usage_limit_reached') || message.toLowerCase().includes('limit reached');
      setTicketModal({
        warning,
        phase: isBlocked ? 'blocked' : 'review',
        error: message,
      });
    }
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-sm text-red-600 dark:text-red-400">{t('overview.loadFailed', { error })}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {['a', 'b', 'c', 'd', 'e'].map((k) => (
            <SkeletonCard key={`metric-${k}`} />
          ))}
        </div>
      </div>
    );
  }

  const planLabel = plan?.name || tier.charAt(0).toUpperCase() + tier.slice(1);
  const usageBarClass =
    usagePct !== null && usagePct >= 100
      ? 'bg-red-500 dark:bg-red-400'
      : usagePct !== null && usagePct >= USAGE_WARNING_PCT
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-brand-600 dark:bg-brand-500';

  const hasFailed = kanban.failed.length > 0;

  return (
    <div className="space-y-6">
      {/* Plan + usage strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
          <Zap size={12} />
          {planLabel}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.fixesThisPeriod')}</span>
        {isUnlimited ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.unlimited')}</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-gray-700 dark:text-gray-300">
              {formatUsage(usedFixes, monthlyLimit, isUnlimited)}
            </span>
            <ProgressBar className="w-24" value={usedFixes} max={monthlyLimit} barClassName={usageBarClass} />
            {usagePct !== null && usagePct >= USAGE_WARNING_PCT && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle size={12} />
                {t('overview.usageWarning')}
              </span>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {autoTicketNotice && (
            <span className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400">
              <Loader2 size={12} className="animate-spin" />
              {autoTicketNotice}
            </span>
          )}
          {lastUpdated && (
            <span className="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
              {t('dashboard.updatedAgo', { time: formatRelativeTime(lastUpdated) })}
            </span>
          )}
          <button
            type="button"
            onClick={() => loadData(false)}
            disabled={refreshing}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
            aria-label={t('dashboard.refresh')}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          icon={<Bug size={16} className="text-red-500" />}
          label={t('dashboard.bugsDetected')}
          value={String(totalBugs)}
          severity={totalBugs > 0 ? 'critical' : 'good'}
          onClick={() => onBrowseRuns?.(drillRuns.bugs, DRILLDOWN_META.bugs.titleKey, DRILLDOWN_META.bugs.descKey)}
          footer={t('overview.metric.clickToView')}
        />
        <MetricCard
          icon={<Ticket size={16} className="text-brand-600 dark:text-brand-400" />}
          label={t('dashboard.issuesCreated')}
          value={String(totalIssues)}
          onClick={() => onBrowseRuns?.(drillRuns.issues, DRILLDOWN_META.issues.titleKey, DRILLDOWN_META.issues.descKey)}
          footer={t('overview.metric.clickToView')}
        />
        <MetricCard
          icon={<Clock size={16} className="text-amber-500" />}
          label={t('dashboard.pendingRuns')}
          value={String(totalPending)}
          severity={totalPending > 0 ? 'warning' : 'good'}
          onClick={() => onBrowseRuns?.(drillRuns.pending, DRILLDOWN_META.pending.titleKey, DRILLDOWN_META.pending.descKey)}
          footer={t('overview.metric.clickToView')}
        />
        <MetricCard
          icon={<CheckCircle2 size={16} className="text-green-500" />}
          label={t('dashboard.doneVerified')}
          value={String(totalDone)}
          severity="good"
          onClick={() => onBrowseRuns?.(drillRuns.done, DRILLDOWN_META.done.titleKey, DRILLDOWN_META.done.descKey)}
          footer={t('overview.metric.clickToView')}
        />
        <MetricCard
          icon={<ActivityIcon />}
          label={t('overview.healthScore')}
          value={evaluation.score === null ? '\u2014' : `${evaluation.score}/100`}
          severity={evaluation.verdict === 'empty' ? undefined : evaluation.verdict}
          footer={t('overview.verdict', { verdict: t(`overview.verdicts.${evaluation.verdict}`) })}
        />
      </div>

      {/* Compact kanban pipeline — auto-moves on poll */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KanbanColumn
          title={t('overview.column.pending')}
          count={kanban.pending.length}
          accent="border-amber-300 dark:border-amber-700"
          countClass="bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
        >
          {kanban.pending.map((run) => (
            <RunCard key={run.id} run={run} onClick={() => onSelectRun?.(run)} />
          ))}
          {kanban.pending.length === 0 && <ColumnEmpty label={t('overview.column.empty')} />}
        </KanbanColumn>
        <KanbanColumn
          title={t('overview.column.done')}
          count={kanban.done.length}
          accent="border-green-300 dark:border-green-700"
          countClass="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
        >
          {kanban.done.map((run) => (
            <RunCard key={run.id} run={run} onClick={() => onSelectRun?.(run)} />
          ))}
          {kanban.done.length === 0 && <ColumnEmpty label={t('overview.column.empty')} />}
        </KanbanColumn>
        <KanbanColumn
          title={t('overview.column.failed')}
          count={kanban.failed.length}
          accent="border-red-300 dark:border-red-700"
          countClass="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
        >
          {kanban.failed.map((run) => (
            <RunCard key={run.id} run={run} onClick={() => onSelectRun?.(run)} />
          ))}
          {kanban.failed.length === 0 && <ColumnEmpty label={t('overview.column.empty')} />}
        </KanbanColumn>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('overview.warnings.title')}
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                {warnings.length}
              </span>
            </h3>
          </div>
          <div className="mt-3 space-y-2">
            {warnings.map((warning) => (
              <WarningRow
                key={warning.id}
                warning={warning}
                expanded={expandedWarning === warning.id}
                onToggle={() => setExpandedWarning(expandedWarning === warning.id ? null : warning.id)}
                submitted={submittedIds.has(warning.run?.id ?? '')}
                tier={tier}
                onCreate={() => openTicketModal(warning)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Internal tickets — DB-first store (queryable without platform fetch) */}
      {ticketsList.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2">
            <Ticket size={16} className="text-brand-600 dark:text-brand-400" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('overview.tickets.title')}
              <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                {ticketsList.length}
              </span>
            </h3>
          </div>
          <div className="mt-3 space-y-2">
            {ticketsList.slice(0, 10).map((ticket) => (
              <div
                key={ticket.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    ticket.status === 'failed'
                      ? 'bg-red-500'
                      : ticket.status === 'fixing'
                        ? 'bg-amber-500'
                        : ticket.status === 'fixed'
                          ? 'bg-green-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{ticket.title}</span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {ticket.repoOwner}/{ticket.repoName} &middot; {ticket.source}
                  </span>
                </span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    ticket.status === 'failed'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                      : ticket.status === 'fixing'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                        : ticket.status === 'fixed'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {ticket.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evaluation panel — criteria + evidence + metrics + feedback */}
      <EvaluationPanel evaluation={evaluation} feedback={feedback} hasFailed={hasFailed} />

      {ticketModal && (
        <TicketModal
          state={ticketModal}
          usagePct={usagePct}
          usedFixes={usedFixes}
          monthlyLimit={monthlyLimit}
          isUnlimited={isUnlimited}
          onClose={() => setTicketModal(null)}
          onConfirm={() => confirmCreateTicket()}
        />
      )}
    </div>
  );
}

function ActivityIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="text-brand-600 dark:text-brand-400"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l3.75-3.75 3.75 3.75 4.5-4.5 2.25 2.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 19.5h16.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5" />
    </svg>
  );
}

function KanbanColumn({
  title,
  count,
  accent,
  countClass,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  countClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border bg-white p-3 dark:bg-gray-800 ${accent}`}>
      <div className="flex items-center justify-between px-1">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${countClass}`}>{count}</span>
      </div>
      <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function RunCard({ run, onClick }: { run: Run; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-brand-600 dark:text-brand-400">
          {run.repoOwner}/{run.repoName}#{run.issueNumber}
        </span>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300">{run.issueTitle}</p>
      <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{formatRelativeTime(run.createdAt)}</p>
    </button>
  );
}

function ColumnEmpty({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 px-2 py-3 text-center text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
      {label}
    </p>
  );
}

function WarningRow({
  warning,
  expanded,
  onToggle,
  submitted,
  tier,
  onCreate,
}: {
  warning: RunWarning;
  expanded: boolean;
  onToggle: () => void;
  submitted: boolean;
  tier: PlanTier;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const isUsage = warning.kind === 'usage';
  const run = warning.run;
  const usage = warning.usage;
  const title = isUsage
    ? usage
      ? t('overview.warnings.usageTitle', { pct: Math.round(usage.pct) })
      : ''
    : run
      ? `${run.repoOwner}/${run.repoName}#${run.issueNumber}`
      : '';
  const detail = isUsage
    ? usage
      ? t('overview.warnings.usageDetail', { used: usage.used, limit: usage.limit })
      : ''
    : (run?.issueTitle ?? '');

  return (
    <div
      className={`rounded-lg border ${warning.severity === 'critical' ? 'border-red-200 dark:border-red-700/60' : 'border-amber-200 dark:border-amber-700/60'}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg bg-red-50/60 px-3 py-2 text-left dark:bg-red-900/20"
        aria-expanded={expanded}
      >
        <AlertTriangle
          size={14}
          className={warning.severity === 'critical' ? 'shrink-0 text-red-500' : 'shrink-0 text-amber-500'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{detail}</span>
        </span>
        {submitted && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300">
            <CheckCircle2 size={10} />
            {t('overview.ticket.created')}
          </span>
        )}
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-gray-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-red-100 px-3 py-2.5 dark:border-red-800/40">
          {run?.errorMessage && (
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-red-700 dark:bg-gray-900 dark:text-red-300">
              {run.errorMessage}
            </pre>
          )}
          {run?.prUrl && (
            <a
              href={run.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              {t('overview.warnings.viewPr')}
            </a>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {isUsage ? (
              <Link
                to="/billing"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {t('overview.ticket.upgrade')} <ArrowUp size={12} />
              </Link>
            ) : tier === 'team' ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 size={12} />
                {submitted ? t('overview.ticket.autoCreatedNote') : t('overview.ticket.autoWillCreate')}
              </span>
            ) : (
              <button
                type="button"
                onClick={onCreate}
                disabled={submitted}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                <Ticket size={12} />
                {submitted ? t('overview.ticket.created') : t('overview.ticket.create')}
              </button>
            )}
            {!isUsage && warning.run && (
              <Link
                to={`/runs/${warning.run.id}`}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
              >
                {t('overview.warnings.viewRun')}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EvaluationPanel({
  evaluation,
  feedback,
  hasFailed,
}: {
  evaluation: ProjectEvaluation;
  feedback: ReturnType<typeof computeFeedbackLoop>;
  hasFailed: boolean;
}) {
  const { t } = useI18n();
  const feedbackMap = new Map(feedback.map((f) => [f.id, f]));
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('overview.evaluation.title')}</h3>
        <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {t('overview.evaluation.lastRun')}: {new Date(evaluation.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.criteria')}</th>
              <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.value')}</th>
              <th className="hidden pb-2 pr-4 font-medium sm:table-cell">{t('overview.evaluation.evidence')}</th>
              <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.verdict')}</th>
              <th className="pb-2 font-medium">{t('overview.evaluation.trend')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {evaluation.rubric.map((item) => {
              const delta = feedbackMap.get(item.id);
              return (
                <tr key={item.id}>
                  <td className="py-2 pr-4">
                    <span className="text-gray-900 dark:text-gray-100">{t(item.labelKey)}</span>
                    <span className="ml-2 hidden text-[11px] text-gray-400 md:inline">{item.criteria}</span>
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700 dark:text-gray-300">
                    {item.value === null
                      ? '\u2014'
                      : `${Math.round(item.value * 10) / 10}${item.id === 'usage' || item.id === 'failure-rate' || item.id === 'pass-rate' ? '%' : ''}`}
                  </td>
                  <td className="hidden py-2 pr-4 text-xs text-gray-500 dark:text-gray-400 sm:table-cell">
                    {item.evidence}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(item.severity)}`}
                    >
                      {t(`overview.verdicts.${item.severity}`)}
                    </span>
                  </td>
                  <td className="py-2">{delta ? <TrendCell delta={delta} /> : '\u2014'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <span className="text-sm text-gray-500 dark:text-gray-400">{t('overview.evaluation.score')}:</span>
        <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {evaluation.score === null ? '\u2014' : `${evaluation.score}/100`}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityBadge(evaluation.verdict)}`}
        >
          {t(`overview.verdicts.${evaluation.verdict}`)}
        </span>
        {hasFailed && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle size={12} />
            {t('overview.evaluation.actionHint')}
          </span>
        )}
        {evaluation.actions.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {evaluation.actions.map((action) => (
              <span
                key={action}
                className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300"
              >
                {t(action)}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function TrendCell({
  delta,
}: {
  delta: { trend: string; delta: number | null; before: number | null; after: number | null };
}) {
  const { t } = useI18n();
  if (delta.trend === 'new') {
    return <span className="text-xs text-gray-400 dark:text-gray-500">{t('overview.evaluation.trendNew')}</span>;
  }
  if (delta.trend === 'unchanged') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
        <Minus size={12} />
        {t('overview.evaluation.trendSame')}
      </span>
    );
  }
  const improved = delta.trend === 'improved';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${improved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {improved ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {delta.delta === null ? '' : `${improved ? '+' : ''}${Math.round(delta.delta * 10) / 10}`}
      {t(`overview.evaluation.trend${improved ? 'Improved' : 'Regressed'}`)}
    </span>
  );
}

function TicketModal({
  state,
  usagePct,
  usedFixes,
  monthlyLimit,
  isUnlimited,
  onClose,
  onConfirm,
}: {
  state: TicketModalState;
  usagePct: number | null;
  usedFixes: number;
  monthlyLimit: number;
  isUnlimited: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const { warning, phase, runId, error } = state;
  if (!warning.run) return null;
  // Ticket creation is free and unlimited — the fix budget only gates the
  // actual fix dispatch server-side, so the confirm action is never blocked
  // here; the usage review below is informational.
  const blocked = phase === 'blocked';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('overview.ticket.title')}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('overview.ticket.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            aria-label={t('overview.ticket.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/50">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {warning.run.repoOwner}/{warning.run.repoName}#{warning.run.issueNumber}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{warning.run.issueTitle}</p>
        </div>

        {phase === 'done' && runId ? (
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
              <CheckCircle2 size={16} />
              {t('overview.ticket.done')}
            </p>
            <Link
              to={`/runs/${runId}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              {t('overview.ticket.track')} <ChevronRight size={14} />
            </Link>
          </div>
        ) : (
          <>
            {/* Usage review — Free/Solo gate */}
            {!isUnlimited && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  {t('overview.ticket.usageReview')}
                </p>
                <div className="mt-1.5 flex items-center justify-between text-xs text-amber-800 dark:text-amber-200">
                  <span className="tabular-nums">
                    {usedFixes}/{monthlyLimit} {t('overview.ticket.fixesUsed')}
                  </span>
                  <span>{usagePct === null ? '' : `${Math.round(usagePct)}%`}</span>
                </div>
                <ProgressBar
                  className="mt-1.5 h-1.5"
                  value={usedFixes}
                  max={monthlyLimit}
                  barClassName={blocked ? 'bg-red-500' : 'bg-amber-500'}
                />
                {blocked ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t('overview.ticket.limitReached')}</p>
                ) : (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    {t('overview.ticket.limitRemaining', { remaining: Math.max(monthlyLimit - usedFixes, 0) })}
                  </p>
                )}
              </div>
            )}

            {error && phase !== 'blocked' && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t('overview.ticket.cancel')}
              </button>
              {blocked ? (
                <Link
                  to="/billing"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  {t('overview.ticket.upgrade')} <ArrowUp size={14} />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={phase === 'submitting'}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                >
                  {phase === 'submitting' && <Loader2 size={14} className="animate-spin" />}
                  {phase === 'submitting' ? t('overview.ticket.creating') : t('overview.ticket.confirmCreate')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case 'good':
      return 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300';
    case 'warning':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
    case 'critical':
      return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}

const DRILLDOWN_META: Record<DrillKind, { titleKey: string; descKey: string }> = {
  bugs: { titleKey: 'dashboard.bugsDetected', descKey: 'overview.metric.desc.bugs' },
  issues: { titleKey: 'dashboard.issuesCreated', descKey: 'overview.metric.desc.issues' },
  pending: { titleKey: 'dashboard.pendingRuns', descKey: 'overview.metric.desc.pending' },
  done: { titleKey: 'dashboard.doneVerified', descKey: 'overview.metric.desc.done' },
};

