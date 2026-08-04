import { useEffect, useMemo, useState } from 'react';
import { usageApi } from '@/api/client';
import type { UsageAnalytics } from '@/api/client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateTime, formatNumber } from '@/utils/format';
import { SkeletonCard, SkeletonChart } from '@/components/LoadingSkeleton';

const MODEL_COLORS = [
  '#8B5CF6', '#10B981', '#3B82F6', '#F59E0B', '#EF4444',
  '#EC4899', '#14B8A6', '#6366F1', '#A855F7', '#84CC16',
];

function toMonthString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function shortId(id?: string): string {
  if (!id) return '—';
  return id.length > 10 ? `#${id.slice(0, 8)}` : `#${id}`;
}

export default function Usage() {
  const now = new Date();
  const [monthDate, setMonthDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [modelFilter, setModelFilter] = useState('');
  const [apiKeyFilter, setApiKeyFilter] = useState('');
  const [data, setData] = useState<UsageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    usageApi.get({
      month: toMonthString(monthDate),
      ...(modelFilter ? { model: modelFilter } : {}),
      ...(apiKeyFilter ? { apiKey: apiKeyFilter } : {}),
    })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthDate, modelFilter, apiKeyFilter]);

  const models = useMemo(() => {
    if (!data) return [];
    if (data.filters.models.length > 0) return data.filters.models;
    const seen = new Set<string>();
    for (const point of data.series) {
      for (const key of Object.keys(point)) {
        if (key !== 'date') seen.add(key);
      }
    }
    return Array.from(seen);
  }, [data]);

  const apiKeys = useMemo(() => data?.filters.apiKeys ?? [], [data]);

  const modelColors = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach((m, i) => map.set(m, MODEL_COLORS[i % MODEL_COLORS.length]));
    return map;
  }, [models]);

  const totalCostCents = useMemo(
    () => (data?.totalsByModel ?? []).reduce((sum, t) => sum + t.costCents, 0),
    [data],
  );
  const totalRuns = useMemo(
    () => (data?.totalsByModel ?? []).reduce((sum, t) => sum + t.runs, 0),
    [data],
  );

  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const hasSeries = (data?.series.length ?? 0) > 0;
  const hasRequests = (data?.requests.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Usage</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Nutzungskosten aufgeschlüsselt nach Modell
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="card flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonthDate((d) => shiftMonth(d, -1))}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px]"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="w-36 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            {monthLabel}
          </span>
          <button
            onClick={() => setMonthDate((d) => shiftMonth(d, 1))}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px]"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>Modell</span>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">Alle Modelle</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>API Key</span>
            <select
              value={apiKeyFilter}
              onChange={(e) => setApiKeyFilter(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">Alle Keys</option>
              {apiKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Summary */}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="card">
            <p className="text-sm text-gray-500 dark:text-gray-400">Gesamtkosten</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {formatDollars(totalCostCents)}
            </p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 dark:text-gray-400">Runs</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {formatNumber(totalRuns)}
            </p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 dark:text-gray-400">Modelle</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {formatNumber(models.length)}
            </p>
          </div>
        </div>
      )}

      {/* Daily cost stacked by model */}
      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Kosten pro Tag</h2>
        {loading ? (
          <SkeletonChart />
        ) : hasSeries ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => new Date(d as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  stroke="#9CA3AF"
                />
                <YAxis
                  stroke="#9CA3AF"
                  tickFormatter={(v) => `$${Number(v) / 100}`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }}
                  labelFormatter={(d) => new Date(d as string).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  formatter={(value, name) => [formatDollars(Number(value)), String(name)]}
                />
                <Legend />
                {models.map((m) => (
                  <Bar key={m} dataKey={m} stackId="cost" fill={modelColors.get(m)} radius={[0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">Keine Nutzungsdaten für diesen Monat.</p>
        )}
      </div>

      {/* Per-model totals */}
      {(data?.totalsByModel.length ?? 0) > 0 && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Kosten pro Modell</h2>
          <div className="space-y-2">
            {data.totalsByModel.map((t) => (
              <div key={t.model} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: modelColors.get(t.model) }} />
                  {t.model}
                  <span className="text-gray-400 dark:text-gray-500">({formatNumber(t.runs)} runs)</span>
                </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{formatDollars(t.costCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-request table */}
      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Anfragen</h2>
        {loading ? (
          <SkeletonChart />
        ) : hasRequests ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Modell</th>
                  <th className="px-3 py-2 text-right">Input tokens</th>
                  <th className="px-3 py-2 text-right">Output tokens</th>
                  <th className="px-3 py-2 text-right">Kosten</th>
                  <th className="px-3 py-2">Sitzung</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r.runId ?? r.sessionId ?? r.date} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{formatDateTime(r.date)}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.model ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                      {r.inputTokens != null ? formatNumber(r.inputTokens) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                      {r.outputTokens != null ? formatNumber(r.outputTokens) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">
                      {formatDollars(r.costCents)}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{shortId(r.sessionId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">Keine Anfragen für diesen Monat.</p>
        )}
      </div>
    </div>
  );
}
