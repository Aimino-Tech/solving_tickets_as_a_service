import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  logger.child = vi.fn(() => logger);
  return { mockLogger: logger };
});

vi.mock('../../utils/logger.js', () => ({
  rootLogger: mockLogger,
}));

const mockConfig = vi.hoisted(() => ({
  governance: {
    enabled: false,
    url: '',
    timeoutMs: 15_000,
    apiKey: '',
  },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

import { checkGovernanceHealth, dispatchThroughGovernance, isGovernanceEnabled } from '../../governance/client.js';

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return new Promise<{ server: http.Server; url: string; close: () => Promise<void> }>((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const basePayload = {
  installationId: 42,
  repoOwner: 'acme',
  repoName: 'widgets',
  issueNumber: 7,
  issueTitle: 'Fix login',
  issueBody: 'Users cannot log in',
  labels: ['bug', 'stas:fix'],
  traceId: 'abc-123-456',
};

beforeEach(() => {
  mockConfig.governance.enabled = false;
  mockConfig.governance.url = '';
  mockConfig.governance.timeoutMs = 15_000;
  mockConfig.governance.apiKey = '';
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
});

describe('isGovernanceEnabled', () => {
  it('is false when disabled and no URL', () => {
    mockConfig.governance.enabled = false;
    mockConfig.governance.url = '';
    expect(isGovernanceEnabled()).toBe(false);
  });

  it('is true when enabled with URL', () => {
    mockConfig.governance.enabled = true;
    mockConfig.governance.url = 'http://gov:4002';
    expect(isGovernanceEnabled()).toBe(true);
  });

  it('is false when enabled but URL empty', () => {
    mockConfig.governance.enabled = true;
    mockConfig.governance.url = '';
    expect(isGovernanceEnabled()).toBe(false);
  });
});

describe('dispatchThroughGovernance', () => {
  it('returns disabled result without making a request when disabled', async () => {
    mockConfig.governance.enabled = false;
    const result = await dispatchThroughGovernance(basePayload);
    expect(result).toMatchObject({ success: false, disabled: true, status: 0 });
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('POSTs to /api/stas/webhook with x-trace-id header and trace_id body', async () => {
    mockConfig.governance.enabled = true;
    const captured: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    const { url, close } = await startServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        captured.push({ headers: req.headers, body: raw });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ run_id: 'run-xyz' }));
      });
    });
    mockConfig.governance.url = url;

    const result = await dispatchThroughGovernance(basePayload);

    expect(result).toMatchObject({ success: true, runId: 'run-xyz', status: 200 });
    expect(captured).toHaveLength(1);
    expect(captured[0].headers['x-trace-id']).toBe('abc-123-456');
    expect(captured[0].headers['x-governance-source']).toBe('stas');
    expect(captured[0].headers.traceparent).toContain('00-');
    const body = JSON.parse(captured[0].body);
    expect(body.trace_id).toBe('abc-123-456');
    expect(body.source).toBe('stas');
    expect(body.issue_id).toBe('acme/widgets#7');

    await close();
  });

  it('sends X-API-Key when configured', async () => {
    mockConfig.governance.enabled = true;
    mockConfig.governance.apiKey = 'secret-key';
    let seenKey: string | undefined;
    const { url, close } = await startServer((req, res) => {
      seenKey = req.headers['x-api-key'] as string | undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ run_id: 'r' }));
    });
    mockConfig.governance.url = url;

    await dispatchThroughGovernance(basePayload);
    expect(seenKey).toBe('secret-key');
    await close();
  });

  it.each([
    [402, /kill-switch/i],
    [503, /kill-switch/i],
    [429, /rate limited/i],
  ])('aborts on %i kill-switch/rate-limit status', async (status, pattern) => {
    mockConfig.governance.enabled = true;
    const { url, close } = await startServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end('blocked');
    });
    mockConfig.governance.url = url;

    const result = await dispatchThroughGovernance(basePayload);
    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(result.error).toMatch(pattern);
    await close();
  });

  it('fails closed on generic 5xx', async () => {
    mockConfig.governance.enabled = true;
    const { url, close } = await startServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    });
    mockConfig.governance.url = url;

    const result = await dispatchThroughGovernance(basePayload);
    expect(result).toMatchObject({ success: false, status: 500 });
    expect(result.error).toMatch(/HTTP 500/);
    await close();
  });

  it('fails closed on unreachable proxy', async () => {
    mockConfig.governance.enabled = true;
    mockConfig.governance.url = 'http://127.0.0.1:1';
    mockConfig.governance.timeoutMs = 2_000;

    const result = await dispatchThroughGovernance(basePayload);
    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/unreachable/i);
  });

  it('fails closed on timeout', async () => {
    mockConfig.governance.enabled = true;
    mockConfig.governance.timeoutMs = 100;
    const { url, close } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('{}');
      }, 500);
    });
    mockConfig.governance.url = url;

    const result = await dispatchThroughGovernance(basePayload);
    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/timeout/i);
    await close();
  });
});

describe('checkGovernanceHealth', () => {
  it('reports not_configured when no URL', async () => {
    const result = await checkGovernanceHealth();
    expect(result).toEqual({ healthy: false, status: 'not_configured' });
  });

  it('reports ok when health endpoint returns 200', async () => {
    const { url, close } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    mockConfig.governance.url = url;

    const result = await checkGovernanceHealth();
    expect(result).toEqual({ healthy: true, status: 'ok' });
    await close();
  });
});
