import { useState, useEffect } from 'react';
import { credits, type CreditBalance, type Transaction, type MonthlyUsage } from '@/api/client';
import { Wallet, ArrowUpRight, Clock, CreditCard } from 'lucide-react';
import { SkeletonCardGrid } from '@/components/LoadingSkeleton';

export default function Credits() {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [usage, setUsage] = useState<MonthlyUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      credits.balance(signal).catch(() => null),
      credits.transactions(20, 0, signal).catch(() => ({ transactions: [], pagination: { limit: 20, offset: 0, total: 0 } })),
      credits.usage('monthly', signal).catch(() => ({ accountId: 0, period: 'monthly', usage: [] })),
    ])
      .then(([bal, txData, usageData]) => {
        if (!signal.aborted) {
          setBalance(bal);
          setTransactions(txData.transactions);
          setUsage(usageData.usage);
        }
      })
      .catch((err: Error) => {
        if (!signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">Failed to load credits: {error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <SkeletonCardGrid count={2} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Credits & Billing</h1>

      {balance && (
        <div className="card bg-gradient-to-br from-brand-600 to-brand-800 text-white">
          <div className="flex items-center gap-3">
            <Wallet size={28} />
            <div>
              <p className="text-sm text-brand-100">Available Balance</p>
              <p className="text-4xl font-bold">{balance.balance.toLocaleString()} credits</p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => {
                credits.topUp('price_100credits', window.location.href, window.location.href)
                  .then((res) => { window.location.href = res.url; })
                  .catch((err: Error) => alert('Failed to initiate purchase: ' + err.message));
              }}
              className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              <CreditCard size={16} />
              Buy Credits
            </button>
            <button
              onClick={() => {
                credits.topUp('price_500credits', window.location.href, window.location.href)
                  .then((res) => { window.location.href = res.url; })
                  .catch((err: Error) => alert('Failed to initiate purchase: ' + err.message));
              }}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
            >
              <ArrowUpRight size={16} />
              Buy 500 Credits
            </button>
          </div>
          <p className="mt-3 text-xs text-brand-200">
            Lifetime total: {balance.lifetimeCredits.toLocaleString()} credits purchased
          </p>
        </div>
      )}

      {usage.length > 0 && (
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Monthly Usage</h2>
          <div className="mt-4 space-y-2">
            {usage.map((m) => (
              <div key={m.periodStart} className="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {new Date(m.periodStart).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                  </span>
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {m.totalCredits.toLocaleString()} credits ({m.totalTransactions} runs)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Transaction History</h2>
        {transactions.length > 0 ? (
          <div className="mt-4 space-y-2">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {tx.type === 'purchase' ? 'Credit Purchase' : tx.type === 'refund' ? 'Refund' : 'Adjustment'}
                  </p>
                  {tx.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{tx.description}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    {new Date(tx.createdAt).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                <span className={`text-sm font-semibold ${tx.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">No transactions yet.</p>
        )}
      </div>
    </div>
  );
}
