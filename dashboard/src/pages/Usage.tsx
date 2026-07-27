import { useState, useEffect } from 'react';
import { litellm } from '@/api/client';
import type { LiteLLMUsageData } from '@/api/client';
import { SkeletonCard } from '@/components/LoadingSkeleton';

export default function Usage() {
  const [data, setData] = useState<LiteLLMUsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    litellm
      .usage()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">Failed to load usage data: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayUsage = data.dailyUsage.filter(d => d.date === todayStr);
  const todayTokens = todayUsage.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0);
  const todayRequests = todayUsage.reduce((s, d) => s + d.requests, 0);
  const todayCost = todayUsage.reduce((s, d) => s + d.cost, 0);
  const monthStr = todayStr.slice(0, 7);
  const monthUsage = data.dailyUsage.filter(d => d.date.startsWith(monthStr));
  const monthTokens = monthUsage.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0);
  const monthRequests = monthUsage.reduce((s, d) => s + d.requests, 0);
  const monthCost = monthUsage.reduce((s, d) => s + d.cost, 0);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">LLM Usage</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Usage data from LiteLLM proxy — budget, tokens, and requests.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Remaining Budget" value={data.budget.remaining != null ? `$${data.budget.remaining.toFixed(2)}` : '—'} trend={data.budget.remaining != null && data.budget.remaining > 0 ? 'up' : 'neutral'} />
        <MetricCard label="Spent (Total)" value={`$${data.budget.spent.toFixed(2)}`} trend="neutral" />
        <MetricCard label="Max Budget" value={data.budget.maxBudget != null ? `$${data.budget.maxBudget.toFixed(2)}` : '—'} trend="neutral" />
        <MetricCard label="Budget Used" value={data.budget.maxBudget != null && data.budget.maxBudget > 0 ? `${((data.budget.spent / data.budget.maxBudget) * 100).toFixed(1)}%` : '—'} trend={data.budget.maxBudget != null && data.budget.spent < data.budget.maxBudget ? 'up' : 'neutral'} />
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Today</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-gray-500">Tokens Used</p>
            <p className="text-2xl font-bold text-gray-900">{todayTokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Requests</p>
            <p className="text-2xl font-bold text-gray-900">{todayRequests}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Cost</p>
            <p className="text-2xl font-bold text-gray-900">${todayCost.toFixed(4)}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">This Month</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-gray-500">Tokens Used</p>
            <p className="text-2xl font-bold text-gray-900">{monthTokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Requests</p>
            <p className="text-2xl font-bold text-gray-900">{monthRequests}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Cost</p>
            <p className="text-2xl font-bold text-gray-900">${monthCost.toFixed(4)}</p>
          </div>
        </div>
      </div>

      {data.dailyUsage.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Daily Usage History</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="py-3 pr-4 font-semibold text-gray-900 dark:text-gray-100">Date</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900 dark:text-gray-100">Input Tokens</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900 dark:text-gray-100">Output Tokens</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900 dark:text-gray-100">Requests</th>
                  <th className="py-3 font-semibold text-gray-900 dark:text-gray-100">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyUsage.slice(0, 30).map((day) => (
                  <tr key={day.date} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-3 pr-4 text-gray-900 dark:text-gray-100">{day.date}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{day.inputTokens.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{day.outputTokens.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{day.requests}</td>
                    <td className="py-3 font-mono text-gray-700 dark:text-gray-300">${day.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.rateLimits.remainingRequests != null && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Rate Limits</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-gray-500">Requests Remaining</p>
              <p className="text-2xl font-bold text-gray-900">{data.rateLimits.remainingRequests}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Tokens Remaining</p>
              <p className="text-2xl font-bold text-gray-900">{data.rateLimits.remainingTokens ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Reset At</p>
              <p className="text-2xl font-bold text-gray-900">{data.rateLimits.resetAt ? new Date(data.rateLimits.resetAt).toLocaleString() : '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: 'up' | 'down' | 'neutral' }) {
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
