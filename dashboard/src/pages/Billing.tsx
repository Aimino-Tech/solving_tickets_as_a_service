import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { stats, billing, litellm } from '@/api/client';
import type { DashboardStats, BillingPlan } from '@/api/client';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatNumber, formatDate } from '@/utils/format';
import { SkeletonCard, SkeletonChart } from '@/components/LoadingSkeleton';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  solo: 'Solo',
  team: 'Team',
  enterprise: 'Enterprise',
  selfHosted: 'Self-Hosted',
};

export default function Billing() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<BillingPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const autoTriggered = useRef(false);
  const [litellmData, setLitellmData] = useState<any>(null);
  const [litellmLoading, setLitellmLoading] = useState(true);
  const [litellmError, setLitellmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    stats.get()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlanLoading(true);
    billing.plan()
      .then((p) => { if (!cancelled) setActivePlan(p); })
      .catch(() => { if (!cancelled) setActivePlan(null); })
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLitellmLoading(true); setLitellmError(null);
    (async () => {
      try {
        const usage = await (litellm as any).usage({ days: 30 });
        if (!cancelled) setLitellmData(usage);
      } catch (e: unknown) {
        if (!cancelled) setLitellmError(e instanceof Error ? e.message : 'Failed to load usage');
      } finally {
        if (!cancelled) setLitellmLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleOpenPortal() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const { url } = await billing.portal(window.location.href);
      window.location.href = url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleSubscribe(planId: string) {
    setCheckoutLoading(planId);
    setCheckoutError(null);
    try {
      const { url } = await billing.createCheckout(
        planId,
        `${window.location.origin}/billing`,
        `${window.location.origin}/billing`,
      );
      window.location.href = url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Failed to start checkout');
      setCheckoutLoading(null);
    }
  }

  const planParam = searchParams.get('plan');

  useEffect(() => {
    if (!planLoading && planParam && !activePlan?.hasBillingRecord && !autoTriggered.current) {
      if (planParam === 'solo' || planParam === 'team') {
        autoTriggered.current = true;
        void handleSubscribe(planParam);
      }
    }
  }, [planLoading, planParam, activePlan]);

  const totalRuns = data?.totalRuns ?? 0;
  const passRate = data?.passRate ?? 0;
  const avgDurationSeconds = data?.avgDurationSeconds ?? 0;
  const runsByDay = data?.runsByDay ?? [];

  const totalSpend = litellmData?.totalSpend ?? litellmData?.costMonth ?? 0;
  const maxBudget = litellmData?.maxBudget ?? 0;
  const spendPerModel = litellmData?.spendPerModel ?? [];
  const rpmLimit = litellmData?.rpmLimit ?? litellmData?.rateLimit?.rpmLimit;
  const tpmLimit = litellmData?.tpmLimit ?? litellmData?.rateLimit?.tpmLimit;

  const planName = activePlan?.name ? PLAN_LABELS[activePlan.id] || activePlan.name : null;
  const planPrice = activePlan?.amountCents ? `$${activePlan.amountCents / 100}/mo` : null;
  const fixLimit = activePlan?.monthlyFixLimit;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Billing</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Subscription plan, payment history, and usage costs
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Current Plan Card */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Current Plan</h2>
        {planLoading ? (
          <div className="mt-4 h-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : activePlan ? (
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{planName || activePlan.name}</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {planPrice && <span className="font-medium text-gray-700 dark:text-gray-300">{planPrice}</span>}
                {fixLimit !== undefined && (
                  <span className="ml-2">{fixLimit === -1 ? 'Unlimited fixes/mo' : `${fixLimit} fixes/mo`}</span>
                )}
                {activePlan.description && <span className="ml-2">· {activePlan.description}</span>}
              </p>
            </div>
            <div className="flex gap-3">
              {activePlan.hasBillingRecord ? (
                <button
                  onClick={handleOpenPortal}
                  disabled={portalLoading}
                  className="btn-primary min-h-[44px]"
                >
                  {portalLoading ? 'Opening...' : 'Manage Subscription'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleSubscribe('solo')}
                    disabled={checkoutLoading === 'solo'}
                    className="btn-primary min-h-[44px]"
                  >
                    {checkoutLoading === 'solo' ? 'Redirecting...' : 'Subscribe Solo — $49/mo'}
                  </button>
                  <button
                    onClick={() => handleSubscribe('team')}
                    disabled={checkoutLoading === 'team'}
                    className="btn-primary min-h-[44px]"
                  >
                    {checkoutLoading === 'team' ? 'Redirecting...' : 'Subscribe Team — $149/mo'}
                  </button>
                </>
              )}
            </div>
            {checkoutError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{checkoutError}</p>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-gray-500 dark:text-gray-400">No active plan found.</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={() => handleSubscribe('solo')}
                disabled={checkoutLoading === 'solo'}
                className="btn-primary min-h-[44px]"
              >
                {checkoutLoading === 'solo' ? 'Redirecting...' : 'Subscribe Solo — $49/mo'}
              </button>
              <button
                onClick={() => handleSubscribe('team')}
                disabled={checkoutLoading === 'team'}
                className="btn-primary min-h-[44px]"
              >
                {checkoutLoading === 'team' ? 'Redirecting...' : 'Subscribe Team — $149/mo'}
              </button>
            </div>
            {checkoutError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{checkoutError}</p>
            )}
          </div>
        )}
        {portalError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{portalError}</p>
        )}
      </div>

      {/* Usage Stats */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {data ? (
          <>
            <div className="card">
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Runs</p>
              <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {formatNumber(totalRuns)}
              </p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500 dark:text-gray-400">Pass Rate</p>
              <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
                {passRate}%
              </p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Duration</p>
              <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {avgDurationSeconds}s
              </p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500 dark:text-gray-400">Active Repos</p>
              <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {data?.activeRepos ?? 0}
              </p>
            </div>
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        )}
      </div>

      {/* Payment History */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Payment History</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500">
          View invoices and payment history in the Stripe Customer Portal.
        </p>
        <button
          onClick={handleOpenPortal}
          disabled={portalLoading}
          className="btn-secondary mt-3 min-h-[44px]"
        >
          View in Stripe Portal
        </button>
      </div>

      {/* LiteLLM Budget */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">LiteLLM Budget</h2>
        {litellmLoading ? (
          <SkeletonChart />
        ) : litellmError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{litellmError}</p>
        ) : litellmData ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Total Spend</span>
              <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                ${formatNumber(totalSpend)}
              </span>
            </div>
            {maxBudget > 0 && (
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-500 dark:text-gray-400">Budget</span>
                  <span className="text-gray-700 dark:text-gray-300">${formatNumber(maxBudget)}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-2 rounded-full bg-brand-600 dark:bg-brand-500 transition-all"
                    style={{ width: `${Math.min((totalSpend / maxBudget) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
            {spendPerModel.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Spend per Model</h3>
                <div className="space-y-2">
                  {spendPerModel.map((m: any) => (
                    <div key={m.model} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">{m.model}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">${formatNumber(m.spend)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {rpmLimit && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">RPM Limit</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatNumber(rpmLimit)}</span>
              </div>
            )}
            {tpmLimit && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">TPM Limit</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatNumber(tpmLimit)}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">No usage data available</p>
        )}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Cost Over Time</h2>
        {runsByDay.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={runsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }} labelFormatter={(d) => formatDate(d as string)} />
                <Line type="monotone" dataKey="count" stroke="#10B981" strokeWidth={2} dot={false} name="Runs" />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : data ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No run data available yet.</p>
        ) : (
          <SkeletonChart />
        )}
      </div>

      {spendPerModel.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Spend by Model</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendPerModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="model" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }} />
                <Bar dataKey="spend" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Spend" />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Contact & Support */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6 text-center">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Need help with billing?</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Our support team is ready to assist you with any billing questions.
        </p>
        <a
          href="mailto:support@aimino.io"
          className="btn-primary mt-4 inline-flex items-center gap-2 min-h-[44px]"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
