import {
  Gift,
  Link2,
  Copy,
  Check,
  MousePointerClick,
  UserPlus,
  Banknote,
  Share2,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { formatDate, formatNumber } from '@/utils/format';
import StatCard from '@/components/StatCard';
import ErrorState from '@/components/ErrorState';
import ToastViewport from '@/components/Toast';
import { useToast } from '@/hooks/useToast';
import { useReferral } from '@/hooks/useReferral';
import { useCopyClipboard } from '@/hooks/useCopyClipboard';
import { useClaimReward } from '@/hooks/useClaimReward';
import type { ReferralReward } from '@/api/client';

const REFERRAL_BASE_URL = 'https://syntaro.io/?ref=';

const STATUS_CLASSES: Record<ReferralReward['status'], string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  qualified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  claimed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  expired: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  fraud: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

function isClaimable(status: ReferralReward['status']): boolean {
  // Only qualified — pending rows show a waiting state instead of a claim button that would 400.
  return status === 'qualified';
}

function ShareButton({
  href,
  label,
  icon,
  ariaLabel,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}

export default function Referral() {
  const { t } = useI18n();
  const { toasts, toast, dismiss } = useToast();
  const { copied, copy } = useCopyClipboard();
  const {
    code,
    codeLoading,
    codeError,
    rewards,
    rewardsLoading,
    rewardsError,
    stats,
    statsLoading,
    statsError,
    refetch,
    setRewards,
  } = useReferral();
  const { claimingId, claim } = useClaimReward(setRewards);

  const referralLink = code ? `${REFERRAL_BASE_URL}${code}` : '';

  function buildShareUrls(link: string) {
    const encoded = encodeURIComponent(link);
    const subject = encodeURIComponent(t('referral.shareEmailSubject'));
    const body = encodeURIComponent(t('referral.shareEmailBody', { link }));
    return {
      x: `https://twitter.com/intent/tweet?text=${encoded}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
      whatsapp: `https://wa.me/?text=${encoded}`,
      email: `mailto:?subject=${subject}&body=${body}`,
    };
  }

  const shareUrls = referralLink ? buildShareUrls(referralLink) : null;

  async function handleCopy() {
    if (!referralLink) return;
    const ok = await copy(referralLink);
    if (ok) {
      toast({ variant: 'success', description: t('referral.toast.copied') });
    }
  }

  async function handleClaim(reward: ReferralReward) {
    try {
      const result = await claim(reward);
      if (result) {
        toast({
          variant: 'success',
          title: t('referral.toast.claimSuccess'),
          description: t('referral.toast.newAllowance', { allowance: formatNumber(result.newAllowance) }),
        });
      }
    } catch (e) {
      toast({
        variant: 'error',
        title: t('referral.toast.claimError'),
        description: e instanceof Error ? e.message : t('referral.toast.claimErrorDesc'),
      });
    }
  }

  return (
    <div className="space-y-8">
      {/* ─── Hero Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('referral.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('referral.subtitle')}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-600 to-brand-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-600/20">
          <Gift className="h-4 w-4" />
          {t('referral.giveGet')}
        </div>
      </div>

      {/* ─── Referral Link Card ─── */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('referral.linkLabel')}
          </h2>
        </div>

        {codeLoading ? (
          <div className="mt-4 space-y-3">
            <div className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          </div>
        ) : codeError ? (
          <div className="mt-4">
            <ErrorState message={codeError} onRetry={refetch} />
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/50">
                <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="truncate font-mono text-sm text-gray-700 dark:text-gray-200">
                  {referralLink}
                </span>
              </div>
              <button
                onClick={handleCopy}
                className="btn-primary inline-flex min-h-[44px] items-center justify-center gap-2"
                aria-label={copied ? t('referral.copied') : t('referral.copy')}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? t('referral.copied') : t('referral.copy')}
              </button>
            </div>

            {copied && (
              <p
                className="mt-2 text-xs text-green-600 dark:text-green-400"
                role="status"
                aria-live="polite"
              >
                {t('referral.copiedAnnounce')}
              </p>
            )}

            {/* Quick-share buttons */}
            {shareUrls && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Share2 className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                <ShareButton
                  href={shareUrls.x}
                  label={t('referral.shareOnX')}
                  ariaLabel={t('referral.shareOnX')}
                  icon={
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  }
                />
                <ShareButton
                  href={shareUrls.linkedin}
                  label={t('referral.shareOnLinkedIn')}
                  ariaLabel={t('referral.shareOnLinkedIn')}
                  icon={
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  }
                />
                <ShareButton
                  href={shareUrls.whatsapp}
                  label={t('referral.shareOnWhatsApp')}
                  ariaLabel={t('referral.shareOnWhatsApp')}
                  icon={
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                  }
                />
                <ShareButton
                  href={shareUrls.email}
                  label={t('referral.shareViaEmail')}
                  ariaLabel={t('referral.shareViaEmail')}
                  icon={
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  }
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Metric Cards ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statsLoading ? (
          <>
            <div className="card animate-pulse">
              <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-2 h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="card animate-pulse">
              <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-2 h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="card animate-pulse">
              <div className="h-4 w-28 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-2 h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </>
        ) : statsError ? (
          <div className="col-span-full">
            <ErrorState message={statsError} onRetry={refetch} />
          </div>
        ) : stats ? (
          <>
            <StatCard
              label={t('referral.metrics.totalClicks')}
              value={formatNumber(stats.totalClicks)}
              icon={MousePointerClick}
            />
            <StatCard
              label={t('referral.metrics.successfulSignups')}
              value={formatNumber(stats.totalInvited)}
              icon={UserPlus}
            />
            <StatCard
              label={t('referral.metrics.totalEarned')}
              value={formatNumber(stats.totalEarnedFixes)}
              icon={Banknote}
              subLabel={t('referral.metrics.fixesUnit')}
            />
          </>
        ) : null}
      </div>

      {/* ─── Rewards Table ─── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('referral.table.title')}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {t('referral.table.friend')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {t('referral.table.date')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {t('referral.table.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {t('referral.table.amount')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {t('referral.table.action')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rewardsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    </td>
                  </tr>
                ))
              ) : rewardsError ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8">
                    <ErrorState message={rewardsError} onRetry={refetch} />
                  </td>
                </tr>
              ) : rewards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12">
                    <div className="text-center">
                      <Gift className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
                      <h3 className="mt-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                        {t('referral.empty.title')}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {t('referral.empty.description')}
                      </p>
                      {referralLink && (
                        <button
                          onClick={handleCopy}
                          className="btn-primary mt-4 inline-flex min-h-[44px] items-center gap-2"
                        >
                          <Copy className="h-4 w-4" />
                          {t('referral.empty.cta')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                rewards.map((reward) => (
                  <tr
                    key={reward.id}
                    className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                      {reward.referredEmail || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {formatDate(reward.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[reward.status]}`}
                      >
                        {t(`referral.status.${reward.status}`)}
                      </span>
                      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                        {t(`referral.statusHelper.${reward.status}`)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {reward.amountFixes > 0
                        ? `${reward.amountFixes} ${t('referral.metrics.fixesUnit')}`
                        : `${reward.amountCredits} ${t('referral.creditsLabel')}`}
                    </td>
                    <td className="px-4 py-3">
                      {reward.status === 'qualified' ? (
                        <button
                          onClick={() => handleClaim(reward)}
                          disabled={claimingId === reward.id}
                          className="btn-secondary min-h-[44px]"
                        >
                          {claimingId === reward.id
                            ? t('referral.table.claiming')
                            : t('referral.table.claim')}
                        </button>
                      ) : reward.status === 'pending' ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {t('referral.table.waiting')}
                        </span>
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

      {/* ─── Toasts ─── */}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
