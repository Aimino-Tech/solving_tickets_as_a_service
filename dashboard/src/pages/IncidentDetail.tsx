import { useState, useEffect } from 'react';
import { incidents } from '@/api/client';
import type { IncidentDetail, IncidentRepo } from '@/api/types';
import { useParams, Link } from 'react-router-dom';
import IncidentStatusBadge from '@/components/IncidentBadge';
import { SkeletonCard } from '@/components/LoadingSkeleton';
import ErrorState from '@/components/ErrorState';
import { useI18n } from '@/i18n/I18nProvider';
import { ExternalLink, GitPullRequest, ShieldAlert, Activity, ArrowLeft } from 'lucide-react';

const STATUS_ORDER = ['open', 'investigating', 'fixing', 'resolved'] as const;

const TIMELINE_ICONS: Record<string, string> = {
  'alert': '🔔',
  'status:open': '🟥',
  'status:investigating': '🟨',
  'status:fixing': '🟦',
  'status:resolved': '🟩',
  'fix_started': '🔧',
  'fix_completed': '✅',
  'pr_created': '🔀',
  'notified': '📣',
};

function statusFromEvent(event: string): string | null {
  const match = /^status:(.+)$/.exec(event);
  return match ? match[1] : null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function IncidentDetail() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    incidents
      .get(id, { signal: ac.signal })
      .then((res) => setIncident(res.data))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => ac.abort();
  }, [id]);

  // Live polling — status transitions are driven by the OS backend.
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      incidents
        .get(id)
        .then((res) => setIncident((prev) => (prev && prev.status === res.data.status ? prev : res.data)))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [id]);

  async function transitionTo(next: string) {
    if (!id || !incident) return;
    setTransitioning(true);
    try {
      const res = await incidents.transition(id, next);
      setIncident((prev) => (prev ? { ...prev, ...res.data } : prev));
    } catch {
      setError('Failed to update incident status');
    } finally {
      setTransitioning(false);
    }
  }

  if (error) {
    return (
      <div className="card">
        <ErrorState message={error} />
        <Link to="/incidents" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> {t('incidents.backToIncidents')}
        </Link>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const currentIdx = STATUS_ORDER.indexOf(incident.status as (typeof STATUS_ORDER)[number]);

  return (
    <div className="max-w-5xl space-y-6">
      {/* Breadcrumb + header */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link to="/incidents" className="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400">
          <ArrowLeft className="h-4 w-4" /> {t('incidents.title')}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">#{incident.id}</span>
      </nav>

      <div className="card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded px-2.5 py-0.5 text-sm font-semibold ${
                incident.severity === 'SEV1' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                : incident.severity === 'SEV2' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                : incident.severity === 'SEV3' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}>{incident.severity}</span>
              <IncidentStatusBadge status={incident.status} />
              <span className="text-sm text-gray-500 dark:text-gray-400">source: {incident.source}</span>
              {incident.autoFixed && (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300">
                  {t('incidents.autoFixedYes')}
                </span>
              )}
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{incident.title}</h1>
            {incident.summary && <p className="text-sm text-gray-600 dark:text-gray-300">{incident.summary}</p>}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>{t('incidents.created')} {formatTime(incident.createdAt)}</span>
              {incident.resolvedAt && <span>{t('incidents.resolvedAt')} {formatTime(incident.resolvedAt)}</span>}
              {incident.alertId && <span className="font-mono">alert {incident.alertId}</span>}
              {incident.runId && <span className="font-mono">run {incident.runId}</span>}
            </div>
          </div>
        </div>

        {/* Confidence / policy decision */}
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 sm:flex-row sm:items-center">
          <ShieldAlert className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <div className="text-sm">
            <span className="font-medium text-gray-900 dark:text-gray-100">{t('incidents.policyDecision')}: </span>
            <span className="text-gray-600 dark:text-gray-300">
              {incident.confidence ? `${t('incidents.confidence')} ${incident.confidence} · ` : `${t('incidents.confidence')} — · `}
              {incident.autoFixed
                ? t('incidents.autoFixedYes')
                : incident.policyDecision ?? t('incidents.autoFixedNo')}
            </span>
          </div>
        </div>

        {/* Status stepper */}
        <div className="mt-6">
          <div className="flex items-center gap-1">
            {STATUS_ORDER.map((step, i) => (
              <div key={step} className="flex flex-1 flex-col items-center gap-1">
                <div className={`h-2 w-full rounded ${i <= currentIdx ? 'bg-brand-600 dark:bg-brand-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
                <span className={`text-xs font-medium ${i === currentIdx ? 'text-brand-600 dark:text-brand-400' : i < currentIdx ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {step}
                </span>
              </div>
            ))}
          </div>
          {currentIdx < STATUS_ORDER.length - 1 && (
            <div className="mt-3 flex gap-2">
              {STATUS_ORDER.map((step) => (
                <button
                  key={step}
                  disabled={transitioning}
                  onClick={() => transitionTo(step)}
                  className="btn-secondary text-xs disabled:opacity-50"
                >
                  Mark {step}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Linked repos + draft PRs (multi-repo batch) */}
      <div className="card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <GitPullRequest className="h-4 w-4" /> {t('incidents.linkedRepos')}
        </h2>
        {incident.repos.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No linked repositories yet.</p>
        ) : (
          <div className="space-y-2">
            {incident.repos.map((repo: IncidentRepo) => (
              <div key={repo.id} className="flex flex-col gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
                    {repo.repoOwner}/{repo.repoName}
                  </span>
                  <IncidentStatusBadge status={repo.status} />
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                  {repo.prUrl ? (
                    <a href={repo.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> {t('incidents.viewPr')}
                    </a>
                  ) : (
                    <span>no PR yet</span>
                  )}
                  {repo.branchName && <span className="font-mono">{repo.branchName}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <Activity className="h-4 w-4" /> {t('incidents.timeline')}
        </h2>
        {incident.timeline.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No timeline events yet.</p>
        ) : (
          <ol className="space-y-3 border-l border-gray-200 dark:border-gray-700 pl-4">
            {incident.timeline.map((entry) => {
              const status = statusFromEvent(entry.event);
              return (
                <li key={entry.id} className="relative">
                  <span className="absolute -left-[21px] top-0 text-xs">{TIMELINE_ICONS[entry.event] ?? '•'}</span>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {status ? <IncidentStatusBadge status={status} /> : entry.event}
                  </p>
                  {entry.detail && <p className="text-xs text-gray-500 dark:text-gray-400">{entry.detail}</p>}
                  <p className="text-xs text-gray-400 dark:text-gray-500">{formatTime(entry.createdAt)}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <Link to="/incidents" className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ArrowLeft className="h-4 w-4" /> {t('incidents.backToIncidents')}
      </Link>
    </div>
  );
}
