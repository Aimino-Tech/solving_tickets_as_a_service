import { useState, useEffect } from 'react';
import { credits } from '@/api/client';
import type { CreditBalance, CreditTransaction } from '@/api/types';
import { Wallet, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import { SkeletonCard } from '@/components/LoadingSkeleton';

export default function Credits() {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      credits.balance().catch(() => null),
      credits.transactions({ limit: 50 }).catch(() => ({ transactions: [], pagination: { limit: 50, offset: 0, total: 0 } })),
    ])
      .then(([balanceResult, txResult]) => {
        setBalance(balanceResult);
        setTransactions(txResult.transactions);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Credits</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="card">
          <div className="inline-flex rounded-lg bg-brand-50 dark:bg-brand-900/50 p-2">
            <Wallet className="text-brand-600 dark:text-brand-400" size={24} />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">Current Balance</p>
          <p className="mt-1 text-3xl font-bold text-brand-600 dark:text-brand-400">
            {balance?.balance ?? '—'}
          </p>
          {balance && (
            <p className="mt-0.5 text-xs text-gray-400">
              {balance.lifetimeCredits} credits purchased total
            </p>
          )}
        </div>

        <div className="card">
          <div className="inline-flex rounded-lg bg-blue-50 dark:bg-blue-900/50 p-2">
            <Clock className="text-blue-600 dark:text-blue-400" size={24} />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">Need more credits?</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Contact us to purchase additional credit packs or upgrade your plan.
          </p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Transaction History</h2>

        {transactions.length > 0 ? (
          <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex rounded-full p-1.5 ${
                    tx.amount > 0 ? 'bg-green-50 dark:bg-green-900/50' : 'bg-red-50 dark:bg-red-900/50'
                  }`}>
                    {tx.amount > 0 ? (
                      <ArrowUpRight className="text-green-600 dark:text-green-400" size={16} />
                    ) : (
                      <ArrowDownRight className="text-red-600 dark:text-red-400" size={16} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {tx.description || (tx.amount > 0 ? 'Credit purchase' : 'Fix run')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${
                  tx.amount > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">No transactions yet.</p>
        )}
      </div>
    </div>
  );
}
