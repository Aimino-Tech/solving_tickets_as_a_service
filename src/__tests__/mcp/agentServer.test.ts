import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';

const mockRedis = vi.hoisted(() => ({
  setex: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  lrange: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({ Redis: vi.fn(() => mockRedis) }));
vi.mock('../../trackers/index.js', () => ({ getTracker: vi.fn() }));
vi.mock('../../config.js', () => ({
  config: {
    mcp: { authEnabled: false, apiKey: '' },
    slack: { botToken: 'xoxb-test-token' },
    queue: { redisUrl: 'redis://localhost:6379' },
    trackers: {
      linear: { apiKey: 'lin-api-key-test' },
    },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../monitoring/sentry.js', () => ({ captureError: vi.fn() }));

let origFetch: unknown;
beforeAll(() => { origFetch = globalThis.fetch; globalThis.fetch = mockFetch; });
afterAll(() => { globalThis.fetch = origFetch; });

async function dispatch(body: unknown): Promise<unknown> {
  const mod = await import('../../mcp/agentServer.js');
  const app = express();
  app.use(express.json());
  app.use(mod.default);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: 'localhost',
        port: addr.port,
        path: '/mcp/jsonrpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => { server.close(); try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.write(payload);
      req.end();
    });
  });
}

describe('mcp/agentServer -- tools/list', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('includes stas_slack_send and stas_slack_ticket', async () => {
    const data = await dispatch({ jsonrpc: '2.0', method: 'tools/list', id: 1 }) as { result?: { tools?: Array<{ name: string }> } };
    const tools = data?.result?.tools ?? [];
    expect(tools.some((t) => t.name === 'stas_slack_send')).toBe(true);
    expect(tools.some((t) => t.name === 'stas_slack_ticket')).toBe(true);
  });
});

describe('mcp/agentServer -- stas_slack_send', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends a message and returns success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, channel: 'C12345', ts: '123456.789' }),
    });

    const data = await dispatch({
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

    const data = await dispatch({
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: { name: 'stas_slack_send', arguments: { channel: 'C12345', text: 'Hello' } },
    }) as { error?: { code: number } };

    expect(data?.error?.code).toBe(-32000);
  });

  it('returns error when channel is missing', async () => {
    const data = await dispatch({
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: { name: 'stas_slack_send', arguments: { text: 'Hello' } },
    }) as { error?: { code: number } };

    expect(data?.error?.code).toBe(-32602);
  });
});

describe('mcp/agentServer -- stas_slack_ticket', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a ticket with Slack notification', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: { issueCreate: { success: true, issue: { id: 'lin-ticket-123', title: 'Test Ticket', url: 'https://linear.app/aimino/issue/TEST-1', priority: 2, createdAt: '2026-01-01T00:00:00Z' } } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true, channel: 'C12345', ts: '123456.789' }),
      });

    const data = await dispatch({
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: {
        name: 'stas_slack_ticket',
        arguments: { title: 'Test Ticket', description: 'Test description', priority: 2, channel: 'C12345' },
      },
    }) as { result?: { ticket: { id: string } } };

    expect(data?.result?.ticket?.id).toBe('lin-ticket-123');
  });

  it('creates a ticket without Slack notification', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: { issueCreate: { success: true, issue: { id: 'lin-ticket-456', title: 'Silent Ticket', url: 'https://linear.app/aimino/issue/TEST-2', priority: 2, createdAt: '2026-01-01T00:00:00Z' } } },
      }),
    });

    const data = await dispatch({
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: {
        name: 'stas_slack_ticket',
        arguments: { title: 'Silent Ticket', description: 'Silent' },
      },
    }) as { result?: { ticket: { id: string } } };

    expect(data?.result?.ticket?.id).toBe('lin-ticket-456');
  });

  it('returns error when title is missing', async () => {
    const data = await dispatch({
      jsonrpc: '2.0', method: 'tools/call', id: 1,
      params: {
        name: 'stas_slack_ticket',
        arguments: { description: 'Test' },
      },
    }) as { error?: { code: number } };

    expect(data?.error?.code).toBe(-32602);
  });
});
