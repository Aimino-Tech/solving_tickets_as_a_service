import { useState, useEffect, useCallback } from 'react';
import { usageLimitsApi } from '@/api/client';
import type { UsageLimits, UsageLimitWindow } from '@/api/client';
import { formatNumber } from '@/utils/format';
import { SkeletonCard } from '@/components/LoadingSkeleton';

const TICK_MS = 60_000;
const UNLIMITED = 999_999;

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
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {unlimited ? 'Unlimited' : `${pct.toFixed(1)}%`}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-2 rounded-full transition-all ${unlimited ? 'bg-brand-300 dark:bg-brand-600' : 'bg-brand-600 dark:bg-brand-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
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
  const [data, setData] = useState<UsageLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    usageLimitsApi
      .get()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  async function handleToggle(key: 'useBalanceAfterLimits' | 'enableChinaModels', value: boolean) {
    setSaving(key);
    setSaveError(null);
    try {
      const updated = await usageLimitsApi.updatePreferences({ [key]: value });
      setData((d) => (d ? { ...d, [key]: updated[key] } : d));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to update preference');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Usage Limits</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Track your fix-run usage across time windows and control how limits and providers behave
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400">
          {error}
        </div>
      )}
      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400">
          {saveError}
        </div>
      )}

      {data ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <UsageBar title="Continuous Usage" window={data.continuous} now={now} />
            <UsageBar title="Weekly Usage" window={data.weekly} now={now} />
            <UsageBar title="Monthly Usage" window={data.monthly} now={now} />
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Usage &amp; Balance</h2>
            <div className="mt-4">
              <Toggle
                checked={data.useBalanceAfterLimits}
                onChange={(v) => handleToggle('useBalanceAfterLimits', v)}
                disabled={saving !== null}
                label="Use your available balance after usage limits are reached"
                description={`Your current balance is ${formatNumber(data.balance)} credits. When enabled, fix runs past your plan limit draw from this balance instead of being blocked.`}
              />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Provider Routing</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Control which providers are used for routing
            </p>
            <div className="mt-4">
              <Toggle
                checked={data.enableChinaModels}
                onChange={(v) => handleToggle('enableChinaModels', v)}
                disabled={saving !== null}
                label="Enable China-hosted models"
                description="Allow routing to models hosted in China."
              />
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
    </div>
  );
}
