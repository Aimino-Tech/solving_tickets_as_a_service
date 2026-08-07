import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClaimReward } from '@/hooks/useClaimReward';
import type { ReferralReward } from '@/api/client';

const mockReward: ReferralReward = {
  id: 42,
  accountId: 1,
  referredEmail: 'friend@example.com',
  amountCredits: 500,
  status: 'pending',
  createdAt: '2026-01-15T10:00:00Z',
  claimedAt: null,
};

const mockClaim = vi.fn();

vi.mock('@/api/client', () => ({
  referralApi: {
    claim: (...args: unknown[]) => mockClaim(...args),
  },
}));

describe('useClaimReward', () => {
  let setRewards: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setRewards = vi.fn();
  });

  it('performs optimistic update then resolves on success', async () => {
    mockClaim.mockResolvedValue({ claimed: true, reward: { ...mockReward, status: 'claimed' }, newAllowance: 500 });

    const { result } = renderHook(() => useClaimReward(setRewards));

    await act(async () => {
      const res = await result.current.claim(mockReward);
      expect(res).toEqual({ newAllowance: 500 });
    });

    // Optimistic update applied
    expect(setRewards).toHaveBeenCalledWith(expect.any(Function));
    const updater = setRewards.mock.calls[0][0];
    const updated = updater([mockReward]);
    expect(updated[0].status).toBe('claimed');

    expect(mockClaim).toHaveBeenCalledWith(42);
  });

  it('rolls back optimistic update on failure', async () => {
    mockClaim.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useClaimReward(setRewards));

    await act(async () => {
      try {
        await result.current.claim(mockReward);
      } catch {
        // expected
      }
    });

    // Rollback updater restores original status
    const rollbackUpdater = setRewards.mock.calls[1][0];
    const rolledBack = rollbackUpdater([{ ...mockReward, status: 'claimed' as const }]);
    expect(rolledBack[0].status).toBe('pending');
  });

  it('exposes claimingId while claim is in progress', async () => {
    let resolveClaim!: (value: unknown) => void;
    mockClaim.mockImplementation(() => new Promise((r) => { resolveClaim = r; }));

    const { result } = renderHook(() => useClaimReward(setRewards));

    expect(result.current.claimingId).toBeNull();

    let claimPromise: Promise<unknown>;
    act(() => {
      claimPromise = result.current.claim(mockReward);
    });

    expect(result.current.claimingId).toBe(42);

    await act(async () => {
      resolveClaim({ newAllowance: 500 });
      await claimPromise!;
    });

    expect(result.current.claimingId).toBeNull();
  });
});
