import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetOctokit = vi.fn();
vi.mock('../../github/auth.js', () => ({ getOctokit: mockGetOctokit }));

const mockGetTicket = vi.fn();
vi.mock('../../trackers/linear.js', () => ({
  LinearTracker: vi.fn(() => ({ getTicket: mockGetTicket })),
}));

vi.mock('../../config.js', () => ({
  config: {
    trackers: {
      defaultRepoOwner: 'test-owner',
      defaultRepoName: 'test-repo',
      installationId: 123,
    },
    stas: {
      label: 'stas:fix',
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('linearBridge', () => {
  describe('validateBridgeConfig', () => {
    it('returns config values when all present', () => {
      const result = lb.validateBridgeConfig();
      expect(result.repoOwner).toBe('test-owner');
      expect(result.repoName).toBe('test-repo');
      expect(result.installationId).toBe(123);
    });
  });


  let lb: typeof import('../../trackers/linearBridge.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    lb = await import('../../trackers/linearBridge.js');
  });

  describe('bridgeLinearTicket', () => {
    it('fetches ticket from LinearTracker and creates GitHub issue', async () => {
      mockGetTicket.mockResolvedValue({
        id: 'lin_123',
        title: 'Fix login bug',
        description: 'Users cannot log in',
        url: 'https://linear.app/aimino/issue/LIN-123',
      });

      const mockOctokit = {
        issues: {
          create: vi.fn().mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/test-owner/test-repo/issues/42' } }),
        },
      };
      mockGetOctokit.mockResolvedValue(mockOctokit);

      const result = await lb.bridgeLinearTicket('lin_123');
      expect(result).toBe(42);
      expect(mockGetTicket).toHaveBeenCalledWith('lin_123');
      expect(mockOctokit.issues.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Fix login bug',
        body: expect.stringContaining('Users cannot log in'),
        labels: ['stas:fix'],
      });
    });

    it('includes Linear URL in issue body when description is empty', async () => {
      mockGetTicket.mockResolvedValue({
        id: 'lin_456',
        title: 'Title only',
        url: 'https://linear.app/aimino/issue/LIN-456',
      });

      const mockOctokit = {
        issues: {
          create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
        },
      };
      mockGetOctokit.mockResolvedValue(mockOctokit);

      await lb.bridgeLinearTicket('lin_456');
      expect(mockOctokit.issues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('From Linear'),
        }),
      );
    });

    it('returns cached mapping on duplicate call', async () => {
      mockGetTicket.mockResolvedValue({
        id: 'lin_789',
        title: 'Duplicate test',
        url: 'https://linear.app/aimino/issue/LIN-789',
      });

      const mockOctokit = {
        issues: {
          create: vi.fn().mockResolvedValue({ data: { number: 77 } }),
        },
      };
      mockGetOctokit.mockResolvedValue(mockOctokit);

      const firstResult = await lb.bridgeLinearTicket('lin_789');
      expect(firstResult).toBe(77);
      expect(mockOctokit.issues.create).toHaveBeenCalledTimes(1);

      const secondResult = await lb.bridgeLinearTicket('lin_789');
      expect(secondResult).toBe(77);
      expect(mockOctokit.issues.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMapping', () => {
    it('returns undefined for unknown ticket', () => {
      const mapping = lb.getMapping('unknown');
      expect(mapping).toBeUndefined();
    });

    it('returns mapping after bridgeLinearTicket', async () => {
      mockGetTicket.mockResolvedValue({
        id: 'lin_map',
        title: 'Map test',
        url: 'https://linear.app/aimino/issue/LIN-MAP',
      });
      mockGetOctokit.mockResolvedValue({
        issues: { create: vi.fn().mockResolvedValue({ data: { number: 55 } }) },
      });

      await lb.bridgeLinearTicket('lin_map');
      const mapping = lb.getMapping('lin_map');
      expect(mapping).toBeDefined();
      expect(mapping!.linearTicketId).toBe('lin_map');
      expect(mapping!.githubIssueNumber).toBe(55);
    });
  });
});
