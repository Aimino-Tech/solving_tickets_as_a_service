import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import Referral from '@/pages/Referral';

const {
  mockCode,
  mockCreateCode,
  mockRewards,
  mockClaim,
  mockStats,
  mockTrackClick,
  mockSignupLink,
} = vi.hoisted(() => ({
  mockCode: vi.fn(),
  mockCreateCode: vi.fn(),
  mockRewards: vi.fn(),
  mockClaim: vi.fn(),
  mockStats: vi.fn(),
  mockTrackClick: vi.fn(),
  mockSignupLink: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  referralApi: {
    code: mockCode,
    createCode: mockCreateCode,
    rewards: mockRewards,
    stats: mockStats,
    claim: mockClaim,
    trackClick: mockTrackClick,
    signupLink: mockSignupLink,
  },
}));

describe('Referral page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCode.mockResolvedValue({ code: 'abc123' });
    mockRewards.mockResolvedValue({ rewards: [] });
    mockStats.mockResolvedValue({
      stats: { totalClicks: 42, totalInvited: 7, totalEarnedFixes: 3500, pendingFixes: 500 },
    });
  });

  it('renders hero header with title', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Referral Program')).toBeInTheDocument();
    });
  });

  it('renders Give 10, Get 10 badge', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Give 10, Get 10')).toBeInTheDocument();
    });
  });

  it('renders the referral link', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('https://syntaro.io/?ref=abc123')).toBeInTheDocument();
    });
  });

  it('renders the copy button', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Copy link')).toBeInTheDocument();
    });
  });

  it('renders share buttons', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Share on X')).toBeInTheDocument();
      expect(screen.getByText('Share on LinkedIn')).toBeInTheDocument();
      expect(screen.getByText('Share on WhatsApp')).toBeInTheDocument();
      expect(screen.getByText('Share via Email')).toBeInTheDocument();
    });
  });

  it('renders metric cards with stats', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Total Clicks')).toBeInTheDocument();
      expect(screen.getByText('Successful Signups')).toBeInTheDocument();
      expect(screen.getByText('Total Earned')).toBeInTheDocument();
    });
  });

  it('renders rewards table header', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Your rewards')).toBeInTheDocument();
    });
  });

  it('renders empty state when no rewards', async () => {
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('No rewards yet')).toBeInTheDocument();
    });
  });

  it('renders error state when code fails', async () => {
    mockCode.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<Referral />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows skeleton while loading', () => {
    mockCode.mockReturnValue(new Promise(() => {})); // never resolves
    mockRewards.mockReturnValue(new Promise(() => {}));
    mockStats.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Referral />);
    // Skeleton loading bars
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
