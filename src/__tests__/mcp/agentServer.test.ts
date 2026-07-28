import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';

const mockSetex = vi.fn().mockResolvedValue('OK');
const mockGet = vi.fn().mockResolvedValue(null);
const mockLrange = vi.fn().mockResolvedValue([]);
const mockRpush = vi.fn().mockResolvedValue(1);
const mockDel = vi.fn().mockResolvedValue(1);
const mockExpire = vi.fn().mockResolvedValue(1);
const mockSadd = vi.fn().mockResolvedValue(1);

const mockRedis = {
  setex: mockSetex,
  get: mockGet,
  lrange: mockLrange,
  rpush: mockRpush,
  del: mockDel,
  expire: mockExpire,
  sadd: mockSadd,
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => ({ Redis: vi.fn(() => mockRedis) }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockCreateTicket = vi.fn();

vi.mock('../../trackers/index.js', () => ({
  getTracker: vi.fn(() => ({ createTicket: mockCreateTicket })),
}));

vi.mock('../../config.js', () => ({
  config: {
    slack: { botToken: 'xoxb-test-token' },
    queue: { redisUrl: 'redis://localhost:6379' },
    trackers: {},
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../monitoring/sentry.js', () => ({
  captureError: vi.fn(),
}));

function dispatch(app: express.Express, body: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      url: '/mcp/jsonrpc',
      path: '/mcp/jsonrpc',
      headers: { 'content-type': 'application/json' },
      body,
    } as unknown as express.Request;
    const json = vi.fn().mockImplementation((data: unknown) => { resolve(data); });
    const res = { json, status: vi.fn().mockReturnValue({ json }) } as unknown as express.Response;
    app.handle(req, res, () => {});
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('mcp/agentServer — tools/list', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('includes stas_slack_send and stas_slack_ticket', async () => {
    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, { jsonrpc: '2.0', method: 'tools/list', id: 1 }) as { result?: { tools?: Array<{ name: string }> } };
    const tools = data?.result?.tools ?? [];
    expect(tools.some((t) => t.name === 'stas_slack_send')).toBe(true);
    expect(tools.some((t) => t.name === 'stas_slack_ticket')).toBe(true);
  });
});

describe('mcp/agentServer — stas_slack_send', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends a message and returns success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, channel: 'C12345', ts: '123456.789' }),
    });

    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, {
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: { name: 'stas_slack_send', arguments: { channel: 'C12345', text: 'Hello' } },
    }) as { result?: { ok: boolean } };

    expect(mockFetch).toHaveBeenCalledWith('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: 'Bearer xoxb-test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'C12345', text: 'Hello' }),
    });
    expect(data?.result?.ok).toBe(true);
  });

  it('returns error on Slack API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: false, error: 'invalid_auth' }),
    });

    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, {
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: { name: 'stas_slack_send', arguments: { channel: 'C12345', text: 'Hello' } },
    }) as { error?: { code: number } };

    expect(data?.error?.code).toBe(-32000);
  });

  it('returns error when channel is missing', async () => {
    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, {
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: { name: 'stas_slack_send', arguments: { text: 'Hello' } },
    }) as { error?: { code: number } };

    expect(data?.error?.code).toBe(-32602);
  });
});

describe('mcp/agentServer — stas_slack_ticket', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a ticket with Slack notification', async () => {
    mockCreateTicket.mockResolvedValue({
      id: 'lin-ticket-123',
      title: 'Test Ticket',
      url: 'https://linear.app/aimino/issue/TEST-1',
      priority: 2,
      status: 'Todo',
      description: 'Test description',
      source: 'linear',
      labels: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, channel: 'C12345', ts: '123456.789' }),
    });

    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, {
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: {
        name: 'stas_slack_ticket',
        arguments: { title: 'Test Ticket', description: 'Test description', priority: 2, channel: 'C12345' },
      },
    }) as { result?: { ok: boolean; ticketId: string; url: string } };

    expect(mockCreateTicket).toHaveBeenCalledWith({
      teamId: 'AIM',
      projectId: '7ce85efdc6bd',
      title: 'Test Ticket',
      description: 'Test description',
      priority: 2,
    });
    expect(data?.result?.ok).toBe(true);
    expect(data?.result?.ticketId).toBe('lin-ticket-123');
  });

  it('creates a ticket without Slack notification', async () => {
    mockCreateTicket.mockResolvedValue({
      id: 'lin-ticket-456', title: 'Silent Ticket',
      url: 'https://linear.app/aimino/issue/TEST-2',
      priority: 2, status: 'Todo', description: 'Silent',
      source: 'linear', labels: [],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });

    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, {
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: {
        name: 'stas_slack_ticket',
        arguments: { title: 'Silent Ticket', description: 'Silent' },
      },
    }) as { result?: { ok: boolean } };

    expect(mockCreateTicket).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(data?.result?.ok).toBe(true);
  });

  it('returns error when title is missing', async () => {
    const mod = await import('../../mcp/agentServer.js');
    const app = createTestApp();
    app.use(mod.default);
    const data = await dispatch(app, {
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: {
        name: 'stas_slack_ticket',
        arguments: { description: 'Test' },
      },
    }) as { error?: { code: number } };

    expect(data?.error?.code).toBe(-32602);
  });
});
