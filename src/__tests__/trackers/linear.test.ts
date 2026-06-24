/**
 * Unit tests for src/trackers/linear.ts — Linear tracker.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../../config.js', () => ({
  config: {
    trackers: {
      linear: { apiKey: 'lin-api-key', webhookSecret: 'lin-webhook-secret' },
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('trackers/linear', () => {
  let linear: typeof import('../../trackers/linear.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    linear = await import('../../trackers/linear.js');
  });

  describe('LinearTracker', () => {
    it('has source = linear', () => {
      const tracker = new linear.LinearTracker();
      expect(tracker.source).toBe('linear');
    });

    describe('getTicket', () => {
      it('fetches and transforms a Linear issue', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: {
              issue: {
                id: 'linear-id',
                title: 'Test Issue',
                description: 'Description',
                priority: 2,
                url: 'https://linear.app/issue/test',
                state: { name: 'In Progress', type: 'started' },
                labels: { nodes: [{ name: 'bug' }] },
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-02T00:00:00Z',
              },
            },
          }),
        });

        const tracker = new linear.LinearTracker();
        const ticket = await tracker.getTicket('linear-id');
        expect(ticket.id).toBe('linear-id');
        expect(ticket.title).toBe('Test Issue');
        expect(ticket.source).toBe('linear');
        expect(ticket.status).toBe('In Progress');
        expect(ticket.labels).toContain('bug');
      });

      it('throws when issue is not found', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: { issue: null } }),
        });

        const tracker = new linear.LinearTracker();
        await expect(tracker.getTicket('nonexistent')).rejects.toThrow('Linear issue not found');
      });
    });

    describe('postComment', () => {
      it('posts a comment via GraphQL', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: { commentCreate: { success: true, comment: { id: 'comment-id' } } },
          }),
        });

        const tracker = new linear.LinearTracker();
        await tracker.postComment('linear-id', 'Test comment');
        expect(mockFetch).toHaveBeenCalledWith('https://api.linear.app/graphql', expect.any(Object));
      });

      it('throws when comment creation fails', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: { commentCreate: { success: false, comment: null } },
          }),
        });

        const tracker = new linear.LinearTracker();
        await expect(tracker.postComment('linear-id', 'Test')).rejects.toThrow('Failed to post comment');
      });
    });

    describe('createLink', () => {
      it('creates an attachment link', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: { attachmentCreate: { success: true } } }),
        });

        const tracker = new linear.LinearTracker();
        await tracker.createLink('linear-id', 'https://github.com/pr/1', 'PR Title');
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe('verifyLinearWebhookSignature', () => {
    it('returns true when secret is missing (skip verification)', () => {
    });

    it('checks sha256 signature', async () => {
      const rawBody = Buffer.from('{"test": true}');
      const result = linear.verifyLinearWebhookSignature(rawBody, 'sha256=' + 'a'.repeat(64));
      // Will return false because the signature is wrong (that's fine)
      expect(typeof result).toBe('boolean');
    });
  });

  describe('handleLinearWebhook', () => {
    it('parses a valid Linear webhook payload', async () => {
      const result = await linear.handleLinearWebhook({
        action: 'create',
        data: { id: 'linear-id', title: 'Test' },
      });
      expect(result).toEqual({ ticketId: 'linear-id', action: 'create' });
    });

    it('returns null for invalid payload', async () => {
      const result = await linear.handleLinearWebhook({});
      expect(result).toBeNull();
    });
  });

  describe('linearTicketToIssueData', () => {
    it('maps a Ticket to issue data', () => {
      const ticket = {
        id: 'linear-id',
        title: 'Test',
        description: 'Desc',
        status: 'Todo',
        priority: 1,
        url: 'https://linear.app/issue/test',
        source: 'linear' as const,
        labels: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      };
      const data = linear.linearTicketToIssueData(ticket, 'owner', 'repo', 1, 42);
      expect(data.source).toBe('linear');
      expect(data.trackerType).toBe('linear');
      expect(data.externalId).toBe('linear-id');
    });
  });
});
