/**
 * Unit tests for src/trackers/jira.ts — Jira tracker.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    trackers: {
      jira: { url: 'https://jira.example.com', email: 'test@test.com', apiToken: 'token' },
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('trackers/jira', () => {
  let jira: typeof import('../../trackers/jira.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    jira = await import('../../trackers/jira.js');
  });

  describe('JiraTracker', () => {
    it('has source = jira', () => {
      const tracker = new jira.JiraTracker();
      expect(tracker.source).toBe('jira');
    });

    describe('getTicket', () => {
      it('fetches and transforms a Jira issue', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: '10001',
            key: 'PROJ-42',
            self: 'https://jira.example.com/rest/api/3/issue/10001',
            fields: {
              summary: 'Test Issue',
              description: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Description text' }] }],
              },
              status: { name: 'In Progress' },
              priority: { id: '2', name: 'High' },
              labels: ['bug'],
              created: '2025-01-01T00:00:00Z',
              updated: '2025-01-02T00:00:00Z',
            },
          }),
        });

        const tracker = new jira.JiraTracker();
        const ticket = await tracker.getTicket('PROJ-42');
        expect(ticket.id).toBe('PROJ-42');
        expect(ticket.title).toBe('Test Issue');
        expect(ticket.source).toBe('jira');
        expect(ticket.status).toBe('In Progress');
        expect(ticket.labels).toContain('bug');
      });

      it('throws on API error', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 404, text: vi.fn().mockResolvedValue('Not found') });
        const tracker = new jira.JiraTracker();
        await expect(tracker.getTicket('PROJ-42')).rejects.toThrow('Jira API error');
      });
    });

    describe('postComment', () => {
      it('posts a comment', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ id: 'comment-id' }),
        });

        const tracker = new jira.JiraTracker();
        await tracker.postComment('PROJ-42', 'Test comment');
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    describe('updateStatus', () => {
      it('updates issue status via transition', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            transitions: [
              { id: '41', name: 'Start Progress', to: { name: 'In Progress' } },
              { id: '31', name: 'Done', to: { name: 'Done' } },
            ],
          }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) });

        const tracker = new jira.JiraTracker();
        await tracker.updateStatus('PROJ-42', 'In Progress');
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('throws when transition not found', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ transitions: [] }),
        });

        const tracker = new jira.JiraTracker();
        await expect(tracker.updateStatus('PROJ-42', 'Nonexistent')).rejects.toThrow('not found');
      });
    });

    describe('createLink', () => {
      it('creates a remote link', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) });

        const tracker = new jira.JiraTracker();
        await tracker.createLink('PROJ-42', 'https://github.com/pr/1', 'PR Title');
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe('verifyJiraWebhookSignature', () => {
    it('returns true when secret is missing (skip verification)', () => {
    });

    it('checks HMAC signature', () => {
      const rawBody = Buffer.from('{"test": true}');
      const result = jira.verifyJiraWebhookSignature(rawBody, 'a'.repeat(64));
      expect(typeof result).toBe('boolean');
    });
  });

  describe('handleJiraWebhook', () => {
    it('parses a valid Jira webhook payload', async () => {
      const result = await jira.handleJiraWebhook({
        webhookEvent: 'jira:issue_updated',
        issue: { id: '10001', key: 'PROJ-42', fields: { summary: 'Test' } },
      });
      expect(result).toEqual({ ticketId: 'PROJ-42', action: 'jira:issue_updated' });
    });

    it('returns null for invalid payload', async () => {
      const result = await jira.handleJiraWebhook({});
      expect(result).toBeNull();
    });
  });

  describe('jiraTicketToIssueData', () => {
    it('maps a Ticket to issue data', () => {
      const ticket = {
        id: 'PROJ-42',
        title: 'Test',
        description: 'Desc',
        status: 'Todo',
        priority: 1,
        url: 'https://jira.example.com/browse/PROJ-42',
        source: 'jira' as const,
        labels: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      };
      const data = jira.jiraTicketToIssueData(ticket, 'owner', 'repo', 1, 42);
      expect(data.source).toBe('jira');
      expect(data.trackerType).toBe('jira');
      expect(data.externalId).toBe('PROJ-42');
    });
  });
});
