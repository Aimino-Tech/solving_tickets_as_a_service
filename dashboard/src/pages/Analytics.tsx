import { useState, useEffect } from 'react';
import { stats, litellm } from '@/api/client';
import type { DashboardStats, LitellmUsage } from '@/api/client';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatNumber, formatDate } from '@/utils/format';
import { SkeletonCard, SkeletonChart } from '@/components/LoadingSkeleton';

export default function Analytics() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [litellmData, setLitellmData] = useState<LitellmUsage | null>(null);
  const [litellmLoading, setLitellmLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    stats
      .get()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    litellm.usage()
      .then((d) => { if (!cancelled) setLitellmData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLitellmLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">Failed to load analytics: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonChart />
        <SkeletonChart />
        <SkeletonChart />
      </div>
    );
  }

  const costData = data.costByDay.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    cost: d.costCents / 100,
  }));

  const fixRateData = data.fixRateByWeek.map((d) => ({
    week: d.week,
    rate: Number((d.rate * 100).toFixed(1)),
  }));

  const runsByDayData = data.runsByDay.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Total: d.count,
    Passed: d.passed,
  }));

  return (
    <div className="space-y-8">
      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <MetricCard
          label="Overall Pass Rate"
          value={`${(data.passRate * 100).toFixed(1)}%`}
          trend={data.passRate >= 0.7 ? 'up' : data.passRate >= 0.5 ? 'neutral' : 'down'}
        />
        <MetricCard
          label="Total Runs"
          value={String(data.totalRuns)}
          trend="neutral"
        />
        <MetricCard
          label="Avg Cost / Run"
          value={data.costByDay.length > 0
            ? `$${(data.costByDay.reduce((s, d) => s + d.costCents, 0) / Math.max(data.costByDay.length, 1) / 100).toFixed(2)}`
            : '—'}
          trend="neutral"
        />
      </div>

      {/* LiteLLM Usage */}
      {litellmData && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
          <MetricCard label="Remaining Budget" value={`$${litellmData.remainingBudget?.toFixed(2) ?? '0.00'}`} trend={litellmData.remainingBudget && litellmData.remainingBudget > 10 ? 'up' : litellmData.remainingBudget && litellmData.remainingBudget > 2 ? 'neutral' : 'down'} />
          <MetricCard label="Tokens Today" value={formatNumber(litellmData.tokensToday?.total ?? 0)} trend="neutral" />
          <MetricCard label="Requests Today" value={String(litellmData.requestsToday ?? 0)} trend="neutral" />
          <MetricCard label="RPM Left" value={`${litellmData.rateLimit?.rpmRemaining ?? 0} / ${litellmData.rateLimit?.rpmLimit ?? 0}`} trend={litellmData.rateLimit && litellmData.rateLimit.rpmRemaining > 50 ? 'up' : 'down'} />
        </div>
      )}

      {/* Fix Rate Over Time */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Fix Rate Over Time</h3>
        {fixRateData.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[400px]" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={fixRateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#9ca3af" unit="%" />
                  <Tooltip
                    formatter={(value: number) => [`${value}%`, 'Fix Rate']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#6366f1' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">Not enough data yet.</p>
        )}
      </div>

      {/* Runs per day */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Runs Per Day</h3>
        {runsByDayData.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[400px]" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runsByDayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Legend />
                  <Bar dataKey="Total" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Passed" fill="#4ade80" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">No run data available yet.</p>
        )}
      </div>

      {/* Cost per fix */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Cost Per Fix</h3>
        {costData.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[400px]" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={costData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" unit="$" />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cost']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#f59e0b' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">No cost data available yet.</p>
        )}
      </div>
      {!litellmLoading && litellmData && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">LiteLLM Usage</h2>
          {litellmData.configured && litellmData.budget && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <MetricCard label="Remaining Budget" value={`$${(litellmData.budget.remainingBudget / 100).toFixed(2)}`} trend={litellmData.budget.remainingBudget > 0 ? 'up' : 'down'} />
              <MetricCard label="Spent This Month" value={`$${(litellmData.budget.spendInCurrentMonth / 100).toFixed(2)}`} trend="down" />
              <MetricCard label="Monthly Budget" value={`$${(litellmData.budget.maxBudget / 100).toFixed(2)}`} trend="neutral" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="card">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Today Tokens</h3>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Input</span><span className="font-medium text-gray-900">{(litellmData.todayTokens?.input ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Output</span><span className="font-medium text-gray-900">{(litellmData.todayTokens?.output ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm"><span className="font-medium text-gray-700">Total</span><span className="font-bold text-gray-900">{(litellmData.todayTokens?.total ?? 0).toLocaleString()}</span></div>
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">This Month Tokens</h3>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Input</span><span className="font-medium text-gray-900">{(litellmData.thisMonthTokens?.input ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Output</span><span className="font-medium text-gray-900">{(litellmData.thisMonthTokens?.output ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm"><span className="font-medium text-gray-700">Total</span><span className="font-bold text-gray-900">{(litellmData.thisMonthTokens?.total ?? 0).toLocaleString()}</span></div>
              </div>
            </div>
          </div>
          {litellmData.rateLimit && (
            <div className="card">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Rate Limits</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-gray-500">Requests Per Minute (RPM)</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-gray-200 dark:bg-gray-700">
                      <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (litellmData.rateLimit.rpmLimit > 0 ? (litellmData.rateLimit.rpmRemaining / litellmData.rateLimit.rpmLimit) * 100 : 0))}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">{litellmData.rateLimit.rpmRemaining} / {litellmData.rateLimit.rpmLimit}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Tokens Per Minute (TPM)</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-gray-200 dark:bg-gray-700">
                      <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (litellmData.rateLimit.tpmLimit > 0 ? (litellmData.rateLimit.tpmRemaining / litellmData.rateLimit.tpmLimit) * 100 : 0))}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">{(litellmData.rateLimit.tpmRemaining).toLocaleString()} / {(litellmData.rateLimit.tpmLimit).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              {litellmData.rateLimit.resetAt && <p className="mt-3 text-xs text-gray-400">Resets at {new Date(litellmData.rateLimit.resetAt).toLocaleString()}</p>}
            </div>
          )}
          {!litellmData.configured && (
            <div className="card"><p className="text-sm text-gray-500">{litellmData.message || 'LiteLLM usage data not available'}</p></div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'neutral';
}) {
  const trendColors = {
    up: 'text-green-600 dark:text-green-400',
    down: 'text-red-600 dark:text-red-400',
    neutral: 'text-brand-600 dark:text-brand-400',
  };

  return (
    <div className="card">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${trendColors[trend]}`}>{value}</p>
    </div>
  );
}
