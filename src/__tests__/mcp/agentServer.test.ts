import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const mockRedis = {
  setex: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  lrange: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => ({ Redis: vi.fn(() => mockRedis) }));

vi.mock('../../config.js', () => ({
  config: {
    slack: { botToken: 'xoxb-test-token-123', signingSecret: 'test-secret' },
    queue: { redisUrl: 'redis://localhost:6379' },
    trackers: {
      linear: { apiKey: 'lin-api-key-456' },
      defaultRepoOwner: 'testowner',
      defaultRepoName: 'testrepo',
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

function mockRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as import('express').Response;
}

describe('mcp/agentServer', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ts: '1234567890.123456', channel: 'C01234' }) });
  });

  describe('handleSlackSend', () => {
    it('sends message to Slack channel successfully', async () => {
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackSend('req-1', { channel: '#general', text: 'Hello from MCP' }, res);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer xoxb-test-token-123', 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: '#general', text: 'Hello from MCP' }),
        }),
      );
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-1',
        result: { ok: true, channel: 'C01234', ts: '1234567890.123456' },
      });
    });

    it('returns error for missing channel', async () => {
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackSend('req-2', { text: 'Hello' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-2',
        error: { code: -32602, message: 'Missing required parameters: channel, text' },
      });
    });

    it('returns error for missing text', async () => {
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackSend('req-3', { channel: '#general' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-3',
        error: { code: -32602, message: 'Missing required parameters: channel, text' },
      });
    });

    it('returns error when SLACK_BOT_TOKEN is empty', async () => {
      const { config } = await import('../../config.js');
      const origToken = config.slack.botToken;
      config.slack.botToken = '';
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackSend('req-4', { channel: '#general', text: 'Test' }, res);
      config.slack.botToken = origToken;
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-4',
        error: { code: -32000, message: 'Slack bot token not configured (SLACK_BOT_TOKEN)' },
      });
    });

    it('returns error when Slack API returns non-ok', async () => {
      mockFetch.mockResolvedValue({
        ok: true, json: async () => ({ ok: false, error: 'channel_not_found' }),
      });
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackSend('req-5', { channel: 'invalid', text: 'Test' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-5',
        error: { code: -32000, message: 'Slack API error: channel_not_found' },
      });
    });

    it('returns error on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackSend('req-6', { channel: '#general', text: 'Test' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-6',
        error: { code: -32603, message: expect.stringContaining('Slack API call failed') },
      });
    });
  });

  describe('handleSlackTicket', () => {
    const validLinearResponse = {
      ok: true,
      json: async () => ({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'linear-123',
              title: 'Test ticket',
              url: 'https://linear.app/aimino/issue/AIM-123/test-ticket',
              createdAt: new Date().toISOString(),
            },
          },
        },
      }),
    };

    it('creates ticket successfully without Slack notification', async () => {
      mockFetch.mockResolvedValue(validLinearResponse);
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-10', { title: 'Test ticket', description: 'Test desc' }, res);
      const linearCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string) === 'https://api.linear.app/graphql',
      );
      expect(linearCall).toBeDefined();
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-10',
        result: {
          ok: true,
          ticket: {
            id: 'linear-123',
            title: 'Test ticket',
            url: 'https://linear.app/aimino/issue/AIM-123/test-ticket',
            createdAt: expect.any(String),
          },
          slackNotified: false,
        },
      });
    });

    it('creates ticket without description defaults to empty string', async () => {
      mockFetch.mockResolvedValue(validLinearResponse);
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-16', { title: 'Test ticket' }, res);
      const linearCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string) === 'https://api.linear.app/graphql',
      );
      expect(linearCall).toBeDefined();
      expect(JSON.parse((linearCall as any[])[1].body)).toMatchObject({
        variables: { title: 'Test ticket', description: '', priority: 0 },
      });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        jsonrpc: '2.0', id: 'req-16',
        result: expect.objectContaining({ ok: true, slackNotified: false }),
      }));
    });

    it('creates ticket and fires Slack notification when channel provided', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(validLinearResponse);
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, ts: '98765' }) });
      });
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-11', { title: 'Test ticket', description: 'Test', channel: '#general' }, res);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        jsonrpc: '2.0', id: 'req-11',
        result: expect.objectContaining({ ok: true, slackNotified: true }),
      }));
    });

    it('creates ticket even when Slack notification fails (fire-and-forget)', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(validLinearResponse);
        return Promise.reject(new Error('Slack timeout'));
      });
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-12', { title: 'Test ticket', description: 'Test', channel: '#general' }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        jsonrpc: '2.0', id: 'req-12',
        result: expect.objectContaining({ ok: true, slackNotified: true }),
      }));
    });

    it('returns error for missing title', async () => {
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-13', { description: 'Missing title' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-13',
        error: { code: -32602, message: 'Missing required parameter: title' },
      });
    });

    it('returns error when LINEAR_API_KEY is empty', async () => {
      const { config } = await import('../../config.js');
      const origKey = config.trackers.linear.apiKey;
      config.trackers.linear.apiKey = '';
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-14', { title: 'No key' }, res);
      config.trackers.linear.apiKey = origKey;
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-14',
        error: { code: -32000, message: 'Linear API key not configured (LINEAR_API_KEY)' },
      });
    });

    it('returns error when Linear API returns error', async () => {
      mockFetch.mockResolvedValue({
        ok: true, json: async () => ({ errors: [{ message: 'Invalid team identifier' }] }),
      });
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-15', { title: 'Test ticket', description: 'Test' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-15',
        error: { code: -32000, message: 'Linear API error: Invalid team identifier' },
      });
    });

    it('returns error when Linear API returns no issue', async () => {
      mockFetch.mockResolvedValue({
        ok: true, json: async () => ({
          data: { issueCreate: { success: true, issue: null } },
        }),
      });
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-17', { title: 'Test ticket', description: 'Test' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-17',
        error: { code: -32000, message: 'Linear API returned success=false' },
      });
    });

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const mod = await import('../../mcp/agentServer.js');
      const res = mockRes();
      await mod.handleSlackTicket('req-18', { title: 'Test ticket', description: 'Test' }, res);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'req-18',
        error: { code: -32603, message: expect.stringContaining('Failed to create Linear ticket') },
      });
    });
  });
});
