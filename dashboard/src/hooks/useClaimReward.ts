import { useState, useCallback } from 'react';
import { referralApi, type ReferralReward } from '@/api/client';

interface UseClaimRewardReturn {
  claimingId: number | null;
  claim: (reward: ReferralReward) => Promise<{ newAllowance: number } | null>;
}

export function useClaimReward(
  setRewards: React.Dispatch<React.SetStateAction<ReferralReward[]>>,
): UseClaimRewardReturn {
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const claim = useCallback(
    async (reward: ReferralReward): Promise<{ newAllowance: number } | null> => {
      setClaimingId(reward.id);

      // Optimistic update: mark as claimed immediately
      setRewards((prev) =>
        prev.map((r) => (r.id === reward.id ? { ...r, status: 'claimed' as const } : r)),
      );

      try {
        const { newAllowance } = await referralApi.claim(reward.id);
        return { newAllowance };
      } catch (e) {
        // Rollback optimistic update on failure
        setRewards((prev) =>
          prev.map((r) =>
            r.id === reward.id ? { ...r, status: reward.status } : r,
          ),
        );
        throw e;
      } finally {
        setClaimingId(null);
      }
    },
    [setRewards],
  );

  return { claimingId, claim };
}
