import { useState, useEffect, useCallback } from 'react';
import { referralApi } from '@/api/client';
import type { ReferralReward } from '@/api/client';
import { formatDate } from '@/utils/format';
import { Gift, Link2, Copy, Check } from 'lucide-react';

const REFERRAL_BASE_URL = 'https://syntaro.io/?ref=';

const STEPS = [
  {
    title: 'Share your link',
    description: 'Send your unique referral link to friends who would love automated bug fixing.',
  },
  {
    title: 'Friend signs up',
    description: 'When your friend creates an account with your link, you both earn $5 in credits.',
  },
  {
    title: 'Claim your credits',
    description: 'Claim your reward below and start fixing issues with 500 free credits.',
  },
];

const STATUS_STYLES: Record<ReferralReward['status'], string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  claimed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
};

export default function Referral() {
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(true);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const referralLink = code ? `${REFERRAL_BASE_URL}${code}` : '';

  const loadRewards = useCallback(async () => {
    try {
      const { rewards: data } = await referralApi.rewards();
      setRewards(data);
      setRewardsError(null);
    } catch (e) {
      setRewardsError(e instanceof Error ? e.message : 'Failed to load rewards');
    } finally {
      setRewardsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    referralApi.code()
      .then(({ code: c }) => { if (!cancelled) setCode(c); })
      .catch((e: Error) => { if (!cancelled) setCodeError(e.message); })
      .finally(() => { if (!cancelled) setCodeLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRewards().finally(() => { if (!cancelled) setRewardsLoading(false); });
    return () => { cancelled = true; };
  }, [loadRewards]);

  async function handleCopy() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (non-secure context) — fall back to prompt
      window.prompt('Copy your referral link:', referralLink);
    }
  }

  async function handleClaim(id: number) {
    setClaimingId(id);
    setClaimError(null);
    try {
      await referralApi.claim(id);
      await loadRewards();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Failed to claim reward');
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Referral Program</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Invite a friend and you both get $5 in credits
        </p>
      </div>

      {claimError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-400">
          {claimError}
        </div>
      )}

      {/* Referral Link Card */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Your referral link</h2>
        </div>
        {codeLoading ? (
          <div className="mt-4 h-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : codeError ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{codeError}</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5">
              <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate font-mono text-sm text-gray-700 dark:text-gray-200">{referralLink}</span>
            </div>
            <button
              onClick={handleCopy}
              className="btn-primary inline-flex min-h-[44px] items-center justify-center gap-2"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="card">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/50 text-sm font-bold text-brand-700 dark:text-brand-300">
              {i + 1}
            </div>
            <h3 className="mt-3 text-base font-semibold text-gray-900 dark:text-gray-100">{step.title}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{step.description}</p>
          </div>
        ))}
      </div>

      {/* Rewards table */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Your rewards</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rewardsLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                    Loading rewards...
                  </td>
                </tr>
              ) : rewardsError ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-red-500 dark:text-red-400">
                    {rewardsError}
                  </td>
                </tr>
              ) : rewards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                    No rewards yet. Share your link to earn $5 credits.
                  </td>
                </tr>
              ) : (
                rewards.map((reward) => (
                  <tr key={reward.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {reward.amountCredits} credits
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {reward.referredEmail}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {formatDate(reward.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[reward.status]}`}>
                        {reward.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {reward.status === 'pending' ? (
                        <button
                          onClick={() => handleClaim(reward.id)}
                          disabled={claimingId === reward.id}
                          className="btn-secondary min-h-[44px]"
                        >
                          {claimingId === reward.id ? 'Claiming...' : 'Claim'}
                        </button>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
