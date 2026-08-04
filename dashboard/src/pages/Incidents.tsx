import { useState, useEffect, useCallback, useRef } from 'react';
import { incidents } from '@/api/client';
import type { Incident, IncidentStats } from '@/api/types';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/i18n/I18nProvider';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import IncidentStatusBadge, { SeverityBadge } from '@/components/IncidentBadge';
import { SkeletonCard, SkeletonTable } from '@/components/LoadingSkeleton';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import Pagination from '@/components/Pagination';
import { AlertTriangle, Activity, CheckCircle2, Timer } from 'lucide-react';
import { formatDateTime, formatRelativeTime } from '@/utils/format';

const STATUS_FILTERS = ['all', 'open', 'investigating', 'fixing', 'resolved'] as const;
const SEVERITY_FILTERS = ['all', 'SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
const SOURCE_FILTERS = ['all', 'monitoring', 'manual', 'alert', 'pager'] as const;

const POLL_INTERVAL_MS = 30_000;

function formatMttr(mttrMs: number | null): string {
  if (mttrMs === null || Number.isNaN(mttrMs)) return '—';
  const minutes = Math.round(mttrMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export default function Incidents() {
  const { t } = useI18n();
  const { notify } = usePushNotifications();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<{ data: Incident[]; total: number; offset: number } | null>(null);
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const page = Number(searchParams.get('page')) || 1;
  const severity = searchParams.get('severity') || '';
  const status = searchParams.get('status') || '';
  const source = searchParams.get('source') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';

  // Track previously-resolved ids so a resolution notification fires once
  // per incident (story 4) instead of on every poll tick.
  const resolvedRef = useRef<Set<string>>(new Set());
  const notifiedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(
    async (isPoll = false) => {
      if (!isPoll) setLoading(true);
      setError(null);
      const filters = {
        severity: severity || undefined,
        status: status || undefined,
        source: source || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 20,
        offset: (page - 1) * 20,
      };
      try {
        const [listRes, statsRes] = await Promise.all([incidents.list(filters), incidents.getStats()]);
        setData(listRes);
        setStats(statsRes);
        setLive(true);

        const currentResolved = new Set(
          listRes.data.filter((inc) => inc.status === 'resolved').map((inc) => String(inc.id)),
        );
        const newlyResolved = [...currentResolved].filter(
          (id) => !resolvedRef.current.has(id) && !notifiedRef.current.has(id),
        );
        resolvedRef.current = currentResolved;
        if (newlyResolved.length > 0) {
          const byId = new Map(listRes.data.map((inc) => [String(inc.id), inc]));
          for (const id of newlyResolved) {
            const inc = byId.get(id);
            if (!inc) continue;
            notifiedRef.current.add(id);
            void notify({
              type: 'alert',
              title: t('incidents.notificationTitle', { title: inc.title }),
              body: t('incidents.notificationBody', { title: inc.title }),
              data: { incidentId: inc.id, prUrl: inc.runId || undefined },
            });
          }
        }
      } catch (err) {
        if (!isPoll) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!isPoll) setLoading(false);
      }
    },
    [page, severity, status, source, from, to, notify, t],
  );

  useEffect(() => {
    resolvedRef.current = new Set();
    void refresh();
    const interval = setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') {
      params.delete('page');
    }
    setSearchParams(params);
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(newPage));
    setSearchParams(params);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  const hasFilters = Boolean(severity || status || source || from || to);

  return (
    <div className="space-y-6">
      {/* Impact stats */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4 flex-1">
          <div className="card flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('incidents.total')}</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{stats?.total ?? '—'}</p>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('incidents.open')}</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {(stats?.open ?? 0) + (stats?.investigating ?? 0) + (stats?.fixing ?? 0)}
              </p>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('incidents.resolved')}</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{stats?.resolved ?? '—'}</p>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
              <Timer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('incidents.mttr')}</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{formatMttr(stats?.mttrMs ?? null)}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/settings/services"
            className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            {t('incidents.manageServices')}
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            {live ? t('incidents.polling') : ''}
          </span>
        </div>
      </div>

      {/* By severity strip */}
      {stats && stats.bySeverity.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('incidents.bySeverity')}:
          </span>
          {stats.bySeverity.map((entry) => (
            <span
              key={entry.severity}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300"
            >
              <SeverityBadge severity={entry.severity} />
              {entry.count}
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">{t('incidents.filterSeverity')}</label>
          <select
            value={severity || 'all'}
            onChange={(e) => updateFilter('severity', e.target.value === 'all' ? '' : e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-28"
          >
            {SEVERITY_FILTERS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All' : s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">{t('incidents.filterStatus')}</label>
          <select
            value={status || 'all'}
            onChange={(e) => updateFilter('status', e.target.value === 'all' ? '' : e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-36"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">{t('incidents.filterSource')}</label>
          <select
            value={source || 'all'}
            onChange={(e) => updateFilter('source', e.target.value === 'all' ? '' : e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-32"
          >
            {SOURCE_FILTERS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">{t('incidents.filterFrom')}</label>
          <input
            type="date"
            value={from}
            onChange={(e) => updateFilter('from', e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">{t('incidents.filterTo')}</label>
          <input
            type="date"
            value={to}
            onChange={(e) => updateFilter('to', e.target.value)}
            className="input-field min-h-[44px] w-full sm:w-40"
          />
        </div>
        {hasFilters && (
          <button
            onClick={() => setSearchParams({})}
            className="min-h-[44px] min-w-[44px] text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t('incidents.clearFilters')}
          </button>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">SEV</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('incidents.status')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('incidents.source')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Incident</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('incidents.confidence')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('incidents.time')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <SkeletonTable rows={5} columns={6} />
            ) : error ? (
              <tr><td colSpan={6} className="px-4"><ErrorState message={error} onRetry={() => void refresh()} /></td></tr>
            ) : data?.data.length === 0 ? (
              <tr><td colSpan={6} className="px-4"><EmptyState title={t('incidents.noIncidents')} hint={t('incidents.noIncidentsDesc')} /></td></tr>
            ) : (
              data?.data.map((incident) => (
                <tr key={incident.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                  <td className="px-4 py-3"><SeverityBadge severity={incident.severity} /></td>
                  <td className="px-4 py-3"><IncidentStatusBadge status={incident.status} /></td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{incident.source}</td>
                  <td className="px-4 py-3">
                    <Link to={`/incidents/${incident.id}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-400">
                      {incident.title}
                    </Link>
                    {incident.autoFixed && (
                      <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300">
                        {t('incidents.autoFixedYes')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{incident.confidence ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    <span title={formatDateTime(incident.createdAt)}>{formatRelativeTime(incident.createdAt)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => <SkeletonCard key={i} />)
        ) : error ? (
          <ErrorState message={error} onRetry={() => void refresh()} />
        ) : data?.data.length === 0 ? (
          <EmptyState title={t('incidents.noIncidents')} />
        ) : (
          data?.data.map((incident) => (
            <Link key={incident.id} to={`/incidents/${incident.id}`} className="card block hover:border-brand-200 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <SeverityBadge severity={incident.severity} />
                <IncidentStatusBadge status={incident.status} />
              </div>
              <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{incident.title}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                <span>{incident.source} · {incident.confidence ?? '—'}</span>
                <span>{formatRelativeTime(incident.createdAt)}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      {data && data.total > 20 && (
        <Pagination page={page} totalPages={totalPages} total={data.total} onPageChange={handlePageChange} />
      )}
    </div>
  );
}
