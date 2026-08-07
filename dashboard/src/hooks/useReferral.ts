import { useState, useEffect, useCallback, useRef } from 'react';
import { referralApi, type ReferralReward, type ReferralStats } from '@/api/client';

interface UseReferralReturn {
  code: string | null;
  codeLoading: boolean;
  codeError: string | null;
  rewards: ReferralReward[];
  rewardsLoading: boolean;
  rewardsError: string | null;
  stats: ReferralStats | null;
  statsLoading: boolean;
  statsError: string | null;
  refetch: () => void;
  setRewards: React.Dispatch<React.SetStateAction<ReferralReward[]>>;
}

export function useReferral(): UseReferralReturn {
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(true);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState<string | null>(null);

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    // Code
    try {
      setCodeLoading(true);
      const { code: c } = await referralApi.code({ signal });
      if (mountedRef.current) setCode(c);
    } catch (e) {
      if (mountedRef.current && !(e instanceof DOMException && e.name === 'AbortError')) {
        setCodeError(e instanceof Error ? e.message : 'Failed to load referral code');
      }
    } finally {
      if (mountedRef.current) setCodeLoading(false);
    }

    // Rewards
    try {
      setRewardsLoading(true);
      const { rewards: data } = await referralApi.rewards({ signal });
      if (mountedRef.current) {
        setRewards(data);
        setRewardsError(null);
      }
    } catch (e) {
      if (mountedRef.current && !(e instanceof DOMException && e.name === 'AbortError')) {
        setRewardsError(e instanceof Error ? e.message : 'Failed to load rewards');
      }
    } finally {
      if (mountedRef.current) setRewardsLoading(false);
    }

    // Stats
    try {
      setStatsLoading(true);
      const { stats: data } = await referralApi.stats({ signal });
      if (mountedRef.current) {
        setStats(data);
        setStatsError(null);
      }
    } catch (e) {
      if (mountedRef.current && !(e instanceof DOMException && e.name === 'AbortError')) {
        setStatsError(e instanceof Error ? e.message : 'Failed to load stats');
      }
    } finally {
      if (mountedRef.current) setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    loadData(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [loadData, fetchKey]);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  return {
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
  };
}
