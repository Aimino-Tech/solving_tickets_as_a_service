/**
 * Integration tests for src/governance/monitoring.ts — Governance Proxy.
 *
 * Tests:
 *   - isBehindGovernanceProxy: header detection (present, absent, edge cases)
 *   - healthHandler: response shape, status, proxy field, timestamp freshness
 *   - readinessHandler: response shape
 *   - formatGovernanceHealth: healthy/unhealthy, partial checks, all-pass, all-fail
 *   - Express integration: mount handlers on a real app, verify HTTP responses
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { Request, Response } from 'express';

import {
  isBehindGovernanceProxy,
  healthHandler,
  readinessHandler,
  formatGovernanceHealth,
} from '../../governance/monitoring.js';
import type { GovernanceHealthInfo } from '../../governance/monitoring.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockJson = vi.fn();
const mockStatus = vi.fn().mockReturnValue({ json: mockJson });

function mockReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes(): Response {
  return { json: mockJson, status: mockStatus } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isBehindGovernanceProxy
// ---------------------------------------------------------------------------

describe('isBehindGovernanceProxy()', () => {
  it('returns true when x-governance-proxy header is present', () => {
    const req = mockReq({ 'x-governance-proxy': 'true' });
    expect(isBehindGovernanceProxy(req)).toBe(true);
  });

  it('returns true when header has any truthy value', () => {
    const req = mockReq({ 'x-governance-proxy': '1' });
    expect(isBehindGovernanceProxy(req)).toBe(true);
  });

  it('returns true when header is an empty string (proxy tool detected)', () => {
    const req = mockReq({ 'x-governance-proxy': '' });
    expect(isBehindGovernanceProxy(req)).toBe(true);
  });

  it('returns false when header is absent', () => {
    const req = mockReq({});
    expect(isBehindGovernanceProxy(req)).toBe(false);
  });

  it('returns false when header is undefined', () => {
    const req = mockReq({ 'x-governance-proxy': undefined });
    expect(isBehindGovernanceProxy(req)).toBe(false);
  });

  it('is case-sensitive for header name', () => {
    const req = mockReq({ 'X-Governance-Proxy': 'true' });
    expect(isBehindGovernanceProxy(req)).toBe(false);
  });

  it('handles null headers gracefully', () => {
    const req = { headers: null } as unknown as Request;
    expect(isBehindGovernanceProxy(req)).toBe(false);
  });

  it('handles undefined headers gracefully', () => {
    const req = {} as Request;
    expect(isBehindGovernanceProxy(req)).toBe(false);
  });

  it('does not confuse with other proxy headers', () => {
    const req = mockReq({
      'x-forwarded-for': '10.0.0.1',
      'x-real-ip': '10.0.0.1',
      'via': 'nginx',
    });
    expect(isBehindGovernanceProxy(req)).toBe(false);
  });

  it('handles array header values (Express may produce them)', () => {
    const req = mockReq({ 'x-governance-proxy': ['true'] } as unknown as Record<string, string | undefined>);
    expect(isBehindGovernanceProxy(req)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// healthHandler
// ---------------------------------------------------------------------------

describe('healthHandler()', () => {
  it('returns status ok', () => {
    const req = mockReq();
    const res = mockRes();

    healthHandler(req, res);

    expect(mockJson).toHaveBeenCalledTimes(1);
    const callArg = mockJson.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.status).toBe('ok');
    expect(callArg.proxy).toBe('governance');
    expect(callArg).toHaveProperty('timestamp');
  });

  it('includes a valid ISO timestamp', () => {
    const req = mockReq();
    const res = mockRes();
    const before = new Date().toISOString();

    healthHandler(req, res);

    const callArg = mockJson.mock.calls[0][0] as Record<string, unknown>;
    const ts = new Date(callArg.timestamp as string);
    expect(ts.getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('generates fresh timestamp on each call', async () => {
    const req = mockReq();
    const res = mockRes();

    healthHandler(req, res);
    const firstTs = (mockJson.mock.calls[0][0] as Record<string, unknown>).timestamp;

    await new Promise((r) => setTimeout(r, 5));

    mockJson.mockClear();
    healthHandler(req, res);
    const secondTs = (mockJson.mock.calls[0][0] as Record<string, unknown>).timestamp;

    expect(secondTs).not.toBe(firstTs);
  });

  it('works with and without governance proxy header', () => {
    const withProxy = mockReq({ 'x-governance-proxy': 'true' });
    const withoutProxy = mockReq({});
    const res = mockRes();

    healthHandler(withProxy, res);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', proxy: 'governance' }),
    );

    mockJson.mockClear();
    healthHandler(withoutProxy, res);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', proxy: 'governance' }),
    );
  });
});

// ---------------------------------------------------------------------------
// readinessHandler
// ---------------------------------------------------------------------------

describe('readinessHandler()', () => {
  it('returns status ready', () => {
    const req = mockReq();
    const res = mockRes();

    readinessHandler(req, res);

    expect(mockJson).toHaveBeenCalledWith({ status: 'ready' });
  });

  it('does not include extraneous fields', () => {
    const req = mockReq();
    const res = mockRes();

    readinessHandler(req, res);

    const callArg = mockJson.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(callArg)).toEqual(['status']);
  });
});

// ---------------------------------------------------------------------------
// formatGovernanceHealth
// ---------------------------------------------------------------------------

describe('formatGovernanceHealth()', () => {
  it('formats a healthy result', () => {
    const info: GovernanceHealthInfo = {
      healthy: true,
      proxy: 'governance',
      checks: {
        database: true,
        queue: true,
        opencode: true,
      },
    };

    const result = formatGovernanceHealth(info);

    expect(result.status).toBe('healthy');
    expect(result.proxy).toBe('governance');
    expect(result.checks).toEqual({
      database: true,
      queue: true,
      opencode: true,
    });
    expect(result).toHaveProperty('timestamp');
  });

  it('formats an unhealthy result', () => {
    const info: GovernanceHealthInfo = {
      healthy: false,
      proxy: 'governance',
      checks: {
        database: true,
        queue: false,
        opencode: false,
      },
    };

    const result = formatGovernanceHealth(info);

    expect(result.status).toBe('unhealthy');
    expect(result.checks.queue).toBe(false);
    expect(result.checks.opencode).toBe(false);
  });

  it('handles empty checks map', () => {
    const info: GovernanceHealthInfo = {
      healthy: true,
      proxy: 'governance',
      checks: {},
    };

    const result = formatGovernanceHealth(info);

    expect(result.status).toBe('healthy');
    expect(result.checks).toEqual({});
  });

  it('handles all checks failing', () => {
    const info: GovernanceHealthInfo = {
      healthy: false,
      proxy: 'governance',
      checks: { db: false, cache: false, api: false },
    };

    const result = formatGovernanceHealth(info);

    expect(result.status).toBe('unhealthy');
    expect(Object.values(result.checks as Record<string, boolean>).every(Boolean)).toBe(false);
  });

  it('includes a valid timestamp', () => {
    const info: GovernanceHealthInfo = {
      healthy: true,
      proxy: 'governance',
      checks: { ping: true },
    };

    const result = formatGovernanceHealth(info);
    const ts = new Date(result.timestamp as string);
    expect(ts instanceof Date && !isNaN(ts.getTime())).toBe(true);
  });

  it('timestamp is within 5 seconds of now', () => {
    const info: GovernanceHealthInfo = {
      healthy: true,
      proxy: 'governance',
      checks: {},
    };

    const result = formatGovernanceHealth(info);
    const ts = new Date(result.timestamp as string).getTime();
    const now = Date.now();

    expect(Math.abs(ts - now)).toBeLessThan(5000);
  });

  it('preserves the proxy identity', () => {
    const info: GovernanceHealthInfo = {
      healthy: true,
      proxy: 'governance',
      checks: {},
    };

    const result = formatGovernanceHealth(info);
    expect(result.proxy).toBe('governance');
  });

  it('works with non-standard check keys containing hyphens', () => {
    const info: GovernanceHealthInfo = {
      healthy: false,
      proxy: 'governance',
      checks: {
        'upstream-api-v2': false,
        'rate-limiter-west': true,
        'redis-cluster-eu': true,
      },
    };

    const result = formatGovernanceHealth(info);

    expect(result.status).toBe('unhealthy');
    expect(result.checks).toEqual({
      'upstream-api-v2': false,
      'rate-limiter-west': true,
      'redis-cluster-eu': true,
    });
  });
});

// ---------------------------------------------------------------------------
// Express Integration (HTTP-level tests)
// ---------------------------------------------------------------------------

describe('Express integration', () => {
  let app: express.Application;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    app = express();
    app.get('/governance/health', healthHandler);
    app.get('/governance/readiness', readinessHandler);

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const addr = server.address();
    if (addr && typeof addr === 'object') {
      port = addr.port;
    }
  });

  afterEach(() => {
    server?.close();
  });

  it('GET /governance/health returns 200 with correct shape', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/governance/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.proxy).toBe('governance');
    expect(body).toHaveProperty('timestamp');
  });

  it('GET /governance/health content-type is application/json', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/governance/health`);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('GET /governance/readiness returns 200 with status ready', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/governance/readiness`);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('ready');
    expect(Object.keys(body)).toEqual(['status']);
  });

  it('health endpoint accepts requests with governance proxy header', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/governance/health`, {
      headers: { 'x-governance-proxy': 'true' },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  it('readiness endpoint works without governance proxy header', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/governance/readiness`);
    expect(res.status).toBe(200);
  });

  it('unknown governance route returns 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/governance/unknown`);
    expect(res.status).toBe(404);
  });
});
