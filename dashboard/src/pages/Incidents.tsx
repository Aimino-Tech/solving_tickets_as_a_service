import { Activity, CheckCircle2, Clock, ShieldAlert, Siren } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { incidents } from '@/api/client';
import type { Incident, IncidentListResponse, IncidentStats } from '@/api/types';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { SkeletonTable } from '@/components/LoadingSkeleton';
import Pagination from '@/components/Pagination';
import ServiceCatalogManager from '@/components/ServiceCatalogManager';
import StatCard from '@/components/StatCard';
import { useI18n } from '@/i18n/I18nProvider';
import { formatDateTime, formatDurationShort } from '@/utils/format';

const STATUS_FILTERS = ['all', 'active', 'resolved'] as const;
const SEV_FILTERS = ['all', 'SEV1', 'SEV2', 'SEV3'] as const;

const LIVE_REFRESH_MS = 30_000;

function sevBadgeClass(sev: string): string {
  if (sev === 'SEV1') return 'badge-error';
  if (sev === 'SEV2') return 'badge-warning';
  return 'badge-neutral';
}

function statusBadgeClass(status: string): string {
  return status === 'active' ? 'badge-error' : 'badge-success';
}

export default function Incidents() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'incidents';
  const [data, setData] = useState<IncidentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const page = Number(searchParams.get('page')) || 1;
  const statusFilter = searchParams.get('status') || '';
  const severityFilter = searchParams.get('severity') || '';
  const sourceFilter = searchParams.get('source') || '';
  const qFilter = searchParams.get('q') || '';

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      return incidents
        .list(
          {
            page,
            perPage: 20,
            status: statusFilter || undefined,
            severity: severityFilter || undefined,
            source: sourceFilter || undefined,
            q: qFilter || undefined,
          },
          { signal },
        )
        .then(setData)
        .catch((err: Error) => {
          if (err.name !== 'AbortError') setError(err.message);
        })
        .finally(() => setLoading(false));
    },
    [page, statusFilter, severityFilter, sourceFilter, qFilter],
  );

  useEffect(() => {
    if (tab !== 'incidents') return;
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
  }, [load, tab, live]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.delete('page');
    params.set('tab', 'incidents');
    setSearchParams(params);
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(newPage));
    params.set('tab', 'incidents');
    setSearchParams(params);
  }

  function switchTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params);
  }

  const stats: IncidentStats | null = data?.stats ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
          <button
            type="button"
            onClick={() => switchTab('incidents')}
            className={`min-h-[44px] rounded-md px-4 text-sm font-medium transition-colors ${
              tab === 'incidents'
                ? 'bg-brand-50 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {t('incidents.title')}
          </button>
          <button
            type="button"
            onClick={() => switchTab('catalog')}
            className={`min-h-[44px] rounded-md px-4 text-sm font-medium transition-colors ${
              tab === 'catalog'
                ? 'bg-brand-50 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {t('incidents.serviceCatalog')}
          </button>
        </div>
        <label htmlFor="incidents-live" className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <input
            id="incidents-live"
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          {t('incidents.liveTracking')}
        </label>
      </div>

      {tab === 'catalog' ? (
        <ServiceCatalogManager />
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatCard label={t('incidents.statsActive')} value={stats.active} icon={Siren} />
              <StatCard label={t('incidents.statsResolved')} value={stats.resolved} icon={CheckCircle2} />
              <StatCard label={t('incidents.statsTotal')} value={stats.total} icon={Activity} />
              <StatCard
                label={t('incidents.statsMttr')}
                value={stats.mttrSeconds != null ? formatDurationShort(stats.mttrSeconds) : '\u2014'}
                icon={Clock}
              />
              <StatCard
                label="SEV"
                value={[1, 2, 3].map((n) => `${stats.bySeverity[`SEV${n}`] ?? 0}`).join(' / ')}
                subLabel="SEV1 / SEV2 / SEV3"
                icon={ShieldAlert}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="incidents-status" className="text-sm text-gray-500 dark:text-gray-400">
                {t('incidents.filterStatus')}
              </label>
              <select
                id="incidents-status"
                value={statusFilter || 'all'}
                onChange={(e) => updateFilter('status', e.target.value === 'all' ? '' : e.target.value)}
                className="input-field min-h-[44px] w-full sm:w-32"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {t(`incidents.status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="incidents-severity" className="text-sm text-gray-500 dark:text-gray-400">
                {t('incidents.filterSeverity')}
              </label>
              <select
                id="incidents-severity"
                value={severityFilter || 'all'}
                onChange={(e) => updateFilter('severity', e.target.value === 'all' ? '' : e.target.value)}
                className="input-field min-h-[44px] w-full sm:w-32"
              >
                {SEV_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? t('incidents.sev.all') : s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="incidents-source" className="text-sm text-gray-500 dark:text-gray-400">
                {t('incidents.filterSource')}
              </label>
              <input
                id="incidents-source"
                type="text"
                placeholder={t('incidents.sourcePlaceholder')}
                value={sourceFilter}
                onChange={(e) => updateFilter('source', e.target.value)}
                className="input-field min-h-[44px] w-full sm:w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="incidents-search" className="text-sm text-gray-500 dark:text-gray-400">
                {t('incidents.filterSearch')}
              </label>
              <input
                id="incidents-search"
                type="text"
                placeholder={t('incidents.searchPlaceholder')}
                value={qFilter}
                onChange={(e) => updateFilter('q', e.target.value)}
                className="input-field min-h-[44px] w-full sm:w-48"
              />
            </div>
            {(statusFilter || severityFilter || sourceFilter || qFilter) && (
              <button
                type="button"
                onClick={() => setSearchParams({ tab: 'incidents' })}
                className="min-h-[44px] min-w-[44px] text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {t('runs.clearFilters')}
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    {t('incidents.tableSev')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    {t('incidents.tableStatus')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    {t('incidents.tableService')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    {t('incidents.tableTitle')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    {t('incidents.tableFirstSeen')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    {t('incidents.tableDispatched')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && data === null ? (
                  <SkeletonTable rows={5} columns={6} />
                ) : error ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4">
                      <ErrorState message={error} onRetry={() => void load()} retryLabel={t('common.retry')} />
                    </td>
                  </tr>
                ) : !data || data.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8">
                      <EmptyState title={t('incidents.noIncidents')} hint={t('incidents.noIncidentsDesc')} />
                    </td>
                  </tr>
                ) : (
                  data.data.map((incident: Incident) => (
                    <tr
                      key={incident.fingerprint}
                      className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      onClick={() => navigate(`/incidents/${encodeURIComponent(incident.fingerprint)}`)}
                    >
                      <td className="px-4 py-3">
                        <span className={sevBadgeClass(incident.severityLabel)}>{incident.severityLabel}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={statusBadgeClass(incident.status)}>{incident.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{incident.service}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700 dark:text-gray-200">{incident.title}</span>
                        {incident.difficulty > 1 && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                            Tier {incident.difficulty}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {incident.firstSeenAt ? formatDateTime(incident.firstSeenAt) : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {incident.dispatchedAt ? formatDateTime(incident.dispatchedAt) : '\u2014'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && (
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onPageChange={handlePageChange}
            />
          )}

          {data?.source === 'unavailable' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('incidents.sourceUnavailable')}</p>
          )}
        </>
      )}
    </div>
  );
}
