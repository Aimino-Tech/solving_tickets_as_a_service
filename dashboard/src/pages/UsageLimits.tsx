import { useState, useEffect, useCallback, useMemo } from 'react';
import { usageLimitsApi, usageApi } from '@/api/client';
import type { UsageLimits, UsageLimitWindow, UsageAnalytics } from '@/api/client';
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
import { formatDateTime, formatNumber, formatCost } from '@/utils/format';
import { SkeletonCard, SkeletonChart } from '@/components/LoadingSkeleton';
import ProgressBar from '@/components/ProgressBar';
import ErrorState from '@/components/ErrorState';
import StatCard from '@/components/StatCard';

const TICK_MS = 60_000;
const UNLIMITED = 999_999;

const MODEL_COLORS = [
  '#8B5CF6', '#10B981', '#3B82F6', '#F59E0B', '#EF4444',
  '#EC4899', '#14B8A6', '#6366F1', '#A855F7', '#84CC16',
];

function formatReset(resetAt: string, nowMs: number): string {
  const remainingMs = new Date(resetAt).getTime() - nowMs;
  if (remainingMs <= 0) return 'now';
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const d = Math.floor(totalMinutes / (60 * 24));
  const h = Math.floor((totalMinutes % (60 * 24)) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}

function toMonthString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function shortId(id?: string): string {
  if (!id) return '—';
  return id.length > 10 ? `#${id.slice(0, 8)}` : `#${id}`;
}

function UsageBar({ title, window, now }: { title: string; window: UsageLimitWindow; now: number }) {
  const unlimited = window.limitCredits >= UNLIMITED;
  const pct = unlimited ? 100 : Math.min((window.usedCredits / window.limitCredits) * 100, 100);
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          resets in {formatReset(window.resetAt, now)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-300">
          {unlimited
            ? `${formatNumber(window.usedCredits)} used`
            : `${formatNumber(window.usedCredits)} / ${formatNumber(window.limitCredits)}`}
        </span>
      </div>
      <ProgressBar
        className="mt-2"
        value={unlimited ? window.limitCredits : window.usedCredits}
        max={window.limitCredits}
        displayValue={unlimited ? 'Unlimited' : `${pct.toFixed(1)}%`}
        barClassName={unlimited ? 'bg-brand-300 dark:bg-brand-600' : 'bg-brand-600 dark:bg-brand-500'}
      />
    </div>
  );
}

function Toggle({
  checked, onChange, disabled, label, description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        {description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-brand-600 dark:bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function UsageLimitsPage() {
  const [limits, setLimits] = useState<UsageLimits | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const today = new Date();
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [modelFilter, setModelFilter] = useState('');
  const [apiKeyFilter, setApiKeyFilter] = useState('');
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const loadLimits = useCallback(() => {
    usageLimitsApi
      .get()
      .then(setLimits)
      .catch((e: Error) => setLimitsError(e.message));
  }, []);

  useEffect(() => {
    loadLimits();
  }, [loadLimits]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    usageApi.get({
      month: toMonthString(monthDate),
      ...(modelFilter ? { model: modelFilter } : {}),
      ...(apiKeyFilter ? { apiKey: apiKeyFilter } : {}),
    })
      .then((d) => { if (!cancelled) setAnalytics(d); })
      .catch((e: Error) => { if (!cancelled) setAnalyticsError(e.message); })
      .finally(() => { if (!cancelled) setAnalyticsLoading(false); });
    return () => { cancelled = true; };
  }, [monthDate, modelFilter, apiKeyFilter]);

  async function handleToggle(value: boolean) {
    setSaving('useBalanceAfterLimits');
    setSaveError(null);
    try {
      const updated = await usageLimitsApi.updatePreferences({ useBalanceAfterLimits: value });
      setLimits((d) => (d ? { ...d, useBalanceAfterLimits: updated.useBalanceAfterLimits } : d));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to update preference');
    } finally {
      setSaving(null);
    }
  }

  const models = useMemo(() => {
    if (!analytics) return [];
    if (analytics.filters.models.length > 0) return analytics.filters.models;
    const seen = new Set<string>();
    for (const point of analytics.series) {
      for (const key of Object.keys(point)) {
        if (key !== 'date') seen.add(key);
      }
    }
    return Array.from(seen);
  }, [analytics]);

  const apiKeys = useMemo(() => analytics?.filters.apiKeys ?? [], [analytics]);

  const modelColors = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach((m, i) => map.set(m, MODEL_COLORS[i % MODEL_COLORS.length]));
    return map;
  }, [models]);

  const totalCostCents = useMemo(
    () => (analytics?.totalsByModel ?? []).reduce((sum, t) => sum + t.costCents, 0),
    [analytics],
  );
  const totalRuns = useMemo(
    () => (analytics?.totalsByModel ?? []).reduce((sum, t) => sum + t.runs, 0),
    [analytics],
  );

  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const hasSeries = (analytics?.series.length ?? 0) > 0;
  const hasRequests = (analytics?.requests.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Usage Limits</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Track fix-run limits, preferences, and cost analytics by model
        </p>
      </div>

      {limitsError && <ErrorState message={limitsError} />}
      {saveError && <ErrorState message={saveError} />}

      {limits ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <UsageBar title="Continuous Usage" window={limits.continuous} now={now} />
            <UsageBar title="Weekly Usage" window={limits.weekly} now={now} />
            <UsageBar title="Monthly Usage" window={limits.monthly} now={now} />
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Usage &amp; Balance</h2>
            <div className="mt-4">
              <Toggle
                checked={limits.useBalanceAfterLimits}
                onChange={handleToggle}
                disabled={saving !== null}
                label="Use your available balance after usage limits are reached"
                description={`Overage balance: ${formatNumber(limits.balance)} credits. When enabled, fix runs past your plan limit draw from this balance instead of being blocked. For steady volume, upgrade your plan.`}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cost Analytics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Usage costs broken down by model
        </p>
      </div>

      {analyticsError && <ErrorState message={analyticsError} />}

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
            <span>Model</span>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">All models</option>
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
              <option value="">All keys</option>
              {apiKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {analyticsLoading && !analytics ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <StatCard label="Total cost" value={formatCost(totalCostCents)} />
          <StatCard label="Runs" value={formatNumber(totalRuns)} />
          <StatCard label="Models" value={formatNumber(models.length)} />
        </div>
      )}

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Cost per day</h2>
        {analyticsLoading ? (
          <SkeletonChart />
        ) : hasSeries ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics!.series}>
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
                  formatter={(value, name) => [formatCost(Number(value)), String(name)]}
                />
                <Legend />
                {models.map((m) => (
                  <Bar key={m} dataKey={m} stackId="cost" fill={modelColors.get(m)} radius={[0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">No usage data for this month.</p>
        )}
      </div>

      {(analytics?.totalsByModel.length ?? 0) > 0 && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Cost per model</h2>
          <div className="space-y-2">
            {analytics!.totalsByModel.map((t) => (
              <div key={t.model} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: modelColors.get(t.model) }} />
                  {t.model}
                  <span className="text-gray-400 dark:text-gray-500">({formatNumber(t.runs)} runs)</span>
                </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{formatCost(t.costCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Requests</h2>
        {analyticsLoading ? (
          <SkeletonChart />
        ) : hasRequests ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2 text-right">Input tokens</th>
                  <th className="px-3 py-2 text-right">Output tokens</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2">Session</th>
                </tr>
              </thead>
              <tbody>
                {analytics!.requests.map((r) => (
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
                      {formatCost(r.costCents)}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{shortId(r.sessionId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">No requests for this month.</p>
        )}
      </div>
    </div>
  );
}
