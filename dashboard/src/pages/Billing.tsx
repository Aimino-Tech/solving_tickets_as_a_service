import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { stats, billing, litellm } from '@/api/client';
import type { DashboardStats, BillingPlan, Invoice } from '@/api/client';
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

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function invoiceStatusBadge(status: string) {
  switch (status) {
    case 'paid':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200';
    case 'open':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200';
    case 'void':
    case 'uncollectible':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
}

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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    setInvoicesLoading(true); setInvoicesError(null);
    (async () => {
      try {
        const res = await billing.invoices();
        if (!cancelled) setInvoices(res.invoices);
      } catch (e: unknown) {
        if (!cancelled) setInvoicesError(e instanceof Error ? e.message : 'Failed to load invoices');
      } finally {
        if (!cancelled) setInvoicesLoading(false);
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Billing</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Subscription plan, payment history, and usage costs
          </p>
        </div>
        {activePlan?.hasBillingRecord && (
          <button
            onClick={handleOpenPortal}
            disabled={portalLoading}
            className="btn-secondary shrink-0"
          >
            {portalLoading ? 'Opening...' : 'Manage Subscription'}
          </button>
        )}
        {!planLoading && !activePlan && (
          <a
            href="https://syntaro.io/pricing"
            className="btn-primary shrink-0 no-underline"
          >
            View Plans
          </a>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Current Plan Card — highlighted panel */}
        <div className="card lg:col-span-1 overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-4">
            <h2 className="text-sm font-semibold text-white/90">Current Plan</h2>
          </div>
          <div className="p-5">
            {planLoading ? (
              <div className="space-y-3">
                <div className="h-8 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            ) : activePlan ? (
              <>
                <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{planName || activePlan.name}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {planPrice && <span className="font-medium text-slate-700 dark:text-slate-300">{planPrice}</span>}
                  {fixLimit !== undefined && (
                    <span className="ml-1">{fixLimit === -1 ? 'Unlimited fixes/mo' : `${fixLimit} fixes/mo`}</span>
                  )}
                </p>
                {activePlan.description && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{activePlan.description}</p>
                )}
                {activePlan.hasBillingRecord && (
                  <button
                    onClick={handleOpenPortal}
                    disabled={portalLoading}
                    className="btn-primary mt-4 w-full"
                  >
                    {portalLoading ? 'Opening...' : 'Manage Subscription'}
                  </button>
                )}
                {!activePlan.hasBillingRecord && (
                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      onClick={() => handleSubscribe('solo')}
                      disabled={checkoutLoading === 'solo'}
                      className="btn-primary w-full"
                    >
                      {checkoutLoading === 'solo' ? 'Redirecting...' : 'Subscribe Solo — $49/mo'}
                    </button>
                    <button
                      onClick={() => handleSubscribe('team')}
                      disabled={checkoutLoading === 'team'}
                      className="btn-primary w-full"
                    >
                      {checkoutLoading === 'team' ? 'Redirecting...' : 'Subscribe Team — $149/mo'}
                    </button>
                  </div>
                )}
                {checkoutError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{checkoutError}</p>
                )}
              </>
            ) : (
              <div>
                <p className="text-slate-500 dark:text-slate-400">No active plan found.</p>
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    onClick={() => handleSubscribe('solo')}
                    disabled={checkoutLoading === 'solo'}
                    className="btn-primary w-full"
                  >
                    {checkoutLoading === 'solo' ? 'Redirecting...' : 'Subscribe Solo — $49/mo'}
                  </button>
                  <button
                    onClick={() => handleSubscribe('team')}
                    disabled={checkoutLoading === 'team'}
                    className="btn-primary w-full"
                  >
                    {checkoutLoading === 'team' ? 'Redirecting...' : 'Subscribe Team — $149/mo'}
                  </button>
                </div>
                <a
                  href="https://syntaro.io/pricing"
                  className="mt-3 block text-center text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  View Plans
                </a>
                {checkoutError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{checkoutError}</p>
                )}
              </div>
            )}
            {portalError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{portalError}</p>
            )}
          </div>
        </div>

        {/* Usage Stats — compact 2-col grid inside the right column */}
        <div className="lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-3">Overview</h2>
          <div className="grid grid-cols-2 gap-4">
            {data ? (
              <>
                <div className="card">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Total Runs</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    {formatNumber(totalRuns)}
                  </p>
                </div>
                <div className="card">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Pass Rate</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {passRate}%
                  </p>
                </div>
                <div className="card">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Avg Duration</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    {avgDurationSeconds}s
                  </p>
                </div>
                <div className="card">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Active Repos</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    {data?.activeRepos ?? 0}
                  </p>
                </div>
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            )}
          </div>
        </div>
      </div>

      {/* Payment History — full-width table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Payment History</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Invoices and payment records</p>
          </div>
          <button
            onClick={handleOpenPortal}
            disabled={portalLoading}
            className="btn-secondary text-xs"
          >
            {portalLoading ? 'Opening...' : 'View in Stripe Portal'}
          </button>
        </div>

        {invoicesLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : invoicesError ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-600 dark:text-red-400">{invoicesError}</p>
            <button
              onClick={() => { setInvoicesLoading(true); setInvoicesError(null); billing.invoices().then((r) => { setInvoices(r.invoices); setInvoicesLoading(false); }).catch((e: Error) => { setInvoicesError(e.message); setInvoicesLoading(false); }); }}
              className="btn-secondary mt-3 text-xs"
            >
              Retry
            </button>
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500 dark:text-slate-400">No payments yet</p>
            <button
              onClick={handleOpenPortal}
              disabled={portalLoading}
              className="btn-secondary mt-3 text-xs"
            >
              View in Stripe Portal
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">Date</th>
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">Invoice</th>
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">Status</th>
                  <th className="pb-2 text-right font-medium text-slate-500 dark:text-slate-400">Amount</th>
                  <th className="pb-2 text-right font-medium text-slate-500 dark:text-slate-400"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors last:border-0">
                    <td className="py-3 text-slate-700 dark:text-slate-300">{formatDate(inv.created)}</td>
                    <td className="py-3 text-slate-700 dark:text-slate-300">{inv.number || '—'}</td>
                    <td className="py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${invoiceStatusBadge(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(inv.amountPaidCents > 0 ? inv.amountPaidCents : inv.amountDueCents)}
                    </td>
                    <td className="py-3 text-right">
                      {(inv.hostedInvoiceUrl || inv.invoicePdf) && (
                        <a
                          href={inv.hostedInvoiceUrl || inv.invoicePdf!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                        >
                          {inv.hostedInvoiceUrl ? 'View' : 'PDF'}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* LiteLLM Budget + Charts — 2-col grid on xl */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* LiteLLM Budget */}
        <div className="card">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">LiteLLM Budget</h2>
          {litellmLoading ? (
            <SkeletonChart />
          ) : litellmError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{litellmError}</p>
          ) : litellmData ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500 dark:text-slate-400">Total Spend</span>
                <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  ${formatNumber(totalSpend)}
                </span>
              </div>
              {maxBudget > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-500 dark:text-slate-400">Budget</span>
                    <span className="text-slate-700 dark:text-slate-300">${formatNumber(maxBudget)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-2 rounded-full bg-brand-600 dark:bg-brand-500 transition-all"
                      style={{ width: `${Math.min((totalSpend / maxBudget) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {spendPerModel.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Spend per Model</h3>
                  <div className="space-y-2">
                    {spendPerModel.map((m: any) => (
                      <div key={m.model} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-400">{m.model}</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">${formatNumber(m.spend)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rpmLimit && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500 dark:text-slate-400">RPM Limit</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{formatNumber(rpmLimit)}</span>
                </div>
              )}
              {tpmLimit && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500 dark:text-slate-400">TPM Limit</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{formatNumber(tpmLimit)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">No usage data available</p>
          )}
        </div>

        {/* Cost Over Time */}
        <div className="card">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">Cost Over Time</h2>
          {runsByDay.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={runsByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} labelFormatter={(d) => formatDate(d as string)} />
                  <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} name="Runs" />
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : data ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No run data available yet.</p>
          ) : (
            <SkeletonChart />
          )}
        </div>
      </div>

      {/* Spend by Model — full width */}
      {spendPerModel.length > 0 && (
        <div className="card">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">Spend by Model</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendPerModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="model" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} />
                <Bar dataKey="spend" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Spend" />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Contact & Support */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-6 text-center">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Need help with billing?</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Our support team is ready to assist you with any billing questions.
        </p>
        <a
          href="mailto:support@aimino.io"
          className="btn-primary mt-4 inline-flex items-center gap-2"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
