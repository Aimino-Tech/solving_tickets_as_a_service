import { AlertTriangle, ArrowLeft, CheckCircle2, GitPullRequest, ShieldAlert, Timer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { incidents } from '@/api/client';
import type { Incident, IncidentStats } from '@/api/types';
import ErrorState from '@/components/ErrorState';
import { SkeletonCard } from '@/components/LoadingSkeleton';
import { useI18n } from '@/i18n/I18nProvider';
import { formatDateTime, formatDurationShort } from '@/utils/format';

const LIVE_REFRESH_MS = 30_000;

function sevBadgeClass(sev: string): string {
  if (sev === 'SEV1') return 'badge-error';
  if (sev === 'SEV2') return 'badge-warning';
  return 'badge-neutral';
}

function statusBadgeClass(status: string): string {
  return status === 'active' ? 'badge-error' : 'badge-success';
}

interface TimelineStep {
  key: string;
  time?: string;
  prUrl?: string;
}

export default function IncidentDetail() {
  const { fingerprint = '' } = useParams();
  const { t } = useI18n();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      return incidents
        .get(fingerprint, { signal })
        .then((res) => {
          setIncident(res.incident);
          setStats(res.stats);
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') setError(err.message);
        })
        .finally(() => setLoading(false));
    },
    [fingerprint],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    if (!live) return;
    const interval = setInterval(() => {
      void load(controller.signal);
    }, LIVE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load, live]);

  if (loading && !incident) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error && !incident) {
    return <ErrorState message={error} onRetry={() => void load()} retryLabel={t('common.retry')} />;
  }

  if (!incident) return null;

  const steps: TimelineStep[] = [
    { key: 'alert', time: incident.firstSeenAt },
    { key: 'dispatched', time: incident.dispatchedAt },
    { key: 'fixRuns', time: incident.dispatchedAt },
    ...incident.prs.map((pr) => ({ key: 'pr' as const, time: undefined, prUrl: pr.prUrl })),
    { key: 'resolved', time: incident.resolvedAt },
  ].filter((s) => s.key !== 'fixRuns' || incident.dispatchedAt);

  const gatePassed = incident.status === 'resolved' || incident.difficulty <= 3;

  return (
    <div className="space-y-6">
      <Link
        to="/incidents"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft size={16} />
        {t('incidents.backToList')}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={sevBadgeClass(incident.severityLabel)}>{incident.severityLabel}</span>
            <span className={statusBadgeClass(incident.status)}>{incident.status}</span>
            <span className="badge-neutral">{incident.service}</span>
            {incident.environment && <span className="badge-info">{incident.environment}</span>}
          </div>
          <h1 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-100">{incident.title}</h1>
          <p className="mt-1 font-mono text-xs text-gray-400 dark:text-gray-500">{incident.fingerprint}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          {t('incidents.liveTracking')}
        </label>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('common.retry')} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('incidents.detail.confidenceGate')}
          </h3>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              {gatePassed ? (
                <CheckCircle2 size={20} className="text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle size={20} className="text-amber-500 dark:text-amber-400" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t('incidents.detail.difficulty')}: Tier {incident.difficulty}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('incidents.detail.variant')}: {incident.variant ?? '\u2014'}
                </p>
              </div>
            </div>
            <p
              className={`rounded-lg px-3 py-2 text-sm ${gatePassed ? 'bg-green-50 dark:bg-green-900/40 text-green-800 dark:text-green-200' : 'bg-amber-50 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'}`}
            >
              {gatePassed ? t('incidents.detail.gatePassed') : t('incidents.detail.gateBlocked')}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('incidents.detail.metadata')}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Row
              label={t('incidents.detail.firstSeen')}
              value={incident.firstSeenAt ? formatDateTime(incident.firstSeenAt) : '\u2014'}
            />
            <Row
              label={t('incidents.detail.lastSeen')}
              value={incident.lastSeenAt ? formatDateTime(incident.lastSeenAt) : '\u2014'}
            />
            <Row
              label={t('incidents.detail.dispatchedAt')}
              value={incident.dispatchedAt ? formatDateTime(incident.dispatchedAt) : '\u2014'}
            />
            <Row
              label={t('incidents.detail.resolvedAt')}
              value={incident.resolvedAt ? formatDateTime(incident.resolvedAt) : '\u2014'}
            />
            <Row
              label="Trace ID"
              value={incident.traceId ? <code className="font-mono text-xs">{incident.traceId}</code> : '\u2014'}
            />
            {incident.repos.length > 0 && <Row label={t('incidents.detail.repos')} value={incident.repos.join(', ')} />}
            {incident.labels.length > 0 && (
              <Row label={t('incidents.detail.labels')} value={incident.labels.join(', ')} />
            )}
          </dl>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('incidents.detail.timeline')}
        </h3>
        <ol className="mt-4 space-y-0">
          {steps.map((step, idx) => (
            <li key={`${step.key}-${step.prUrl ?? step.time ?? idx}`} className="relative flex gap-4 pb-6 last:pb-0">
              {idx < steps.length - 1 && (
                <span className="absolute left-[9px] top-6 h-full w-px bg-gray-200 dark:bg-gray-700" />
              )}
              <span className="relative mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/40">
                {step.key === 'resolved' ? (
                  <CheckCircle2 size={14} className="text-green-600 dark:text-green-400" />
                ) : step.key === 'pr' ? (
                  <GitPullRequest size={14} className="text-brand-600 dark:text-brand-400" />
                ) : step.key === 'dispatched' || step.key === 'fixRuns' ? (
                  <Timer size={14} className="text-brand-600 dark:text-brand-400" />
                ) : (
                  <ShieldAlert size={14} className="text-amber-500 dark:text-amber-400" />
                )}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t(`incidents.detail.step.${step.key}`)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {step.time ? formatDateTime(step.time) : '\u2014'}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {incident.prs.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('incidents.detail.fixPrs')} {incident.prs.length > 1 ? `(${incident.prs.length})` : ''}
          </h3>
          <ul className="mt-3 space-y-2">
            {incident.prs.map((pr) => (
              <li
                key={pr.prUrl}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
              >
                <GitPullRequest size={16} className="text-brand-600 dark:text-brand-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{pr.repo}</span>
                <a
                  href={pr.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary min-h-[44px] text-xs"
                >
                  {t('incidents.detail.viewPr')}
                </a>
                {pr.status && <span className="badge-neutral">{pr.status}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && (
        <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
          <span>
            {t('incidents.statsActive')}: {stats.active}
          </span>
          <span>
            {t('incidents.statsResolved')}: {stats.resolved}
          </span>
          <span>
            {t('incidents.statsMttr')}: {stats.mttrSeconds != null ? formatDurationShort(stats.mttrSeconds) : '\u2014'}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-right text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}
