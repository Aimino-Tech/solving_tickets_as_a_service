/**
 * Unit tests for the MCP key auth middleware — src/mcp/auth.ts
 *
 * Tests the resolution order:
 *   1. MCP auth disabled → allow
 *   2. Missing/invalid Bearer header → 401
 *   3. Env key (MCP_API_KEY) fallback match → allow, source 'env'
 *   4. DB key lookup match → allow, source 'db', sets mcpKeyUserId, touches key
 *   5. Unknown/revoked key → 401
 *   6. DB error → 500
 *
 * Strategy: mock config.js (mcp.authEnabled/apiKey), services/mcpKeys.js
 * (findUserByMcpKey/touchMcpKey) and the logger.
 */

import { describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockLoggerChild = vi.hoisted(() =>
  vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
);

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: mockLoggerChild },
}));

const mockConfig = vi.hoisted(() => ({
  mcp: { authEnabled: true, apiKey: 'env-key-test' },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

const mockFindUserByMcpKey = vi.hoisted(() => vi.fn());
const mockTouchMcpKey = vi.hoisted(() => vi.fn());

vi.mock('../../services/mcpKeys.js', () => ({
  findUserByMcpKey: mockFindUserByMcpKey,
  touchMcpKey: mockTouchMcpKey,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockReqRes() {
  const req: any = { headers: {}, params: {} };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  return { req, res };
}

/**
 * Invoke the middleware and resolve once the async DB branch settles.
 */
async function invokeAuth(req: any, res: any): Promise<() => void> {
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  const mod = await import('../../mcp/auth.js');
  mod.mcpKeyAuth(req, res, next);
  // Allow the async IIFE to complete (mocked findUserByMcpKey resolves quickly)
  await new Promise((r) => setTimeout(r, 10));
  return () => nextCalled;
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('mcpKeyAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mcp.authEnabled = true;
    mockConfig.mcp.apiKey = 'env-key-test';
  });

  it('allows the request when MCP auth is disabled', async () => {
    mockConfig.mcp.authEnabled = false;
    const { req, res } = mockReqRes();
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockFindUserByMcpKey).not.toHaveBeenCalled();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const { req, res } = mockReqRes();
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization header' });
  });

  it('returns 401 for a non-Bearer scheme', async () => {
    const { req, res } = mockReqRes();
    req.headers['authorization'] = 'Basic abc123';
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authorization' });
  });

  it('returns 401 for an empty Bearer token', async () => {
    const { req, res } = mockReqRes();
    req.headers['authorization'] = 'Bearer ';
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('allows the env MCP_API_KEY fallback and marks source env', async () => {
    const { req, res } = mockReqRes();
    req.headers['authorization'] = 'Bearer env-key-test';
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(true);
    expect(req.mcpKey).toEqual({ id: 'env', name: 'env', source: 'env' });
    expect(mockFindUserByMcpKey).not.toHaveBeenCalled();
  });

  it('allows a valid DB key and attaches owner context', async () => {
    mockFindUserByMcpKey.mockResolvedValue({ userId: '42', keyId: 'k-1', name: 'agent' });
    const { req, res } = mockReqRes();
    req.headers['authorization'] = 'Bearer sk-stas_validkey1234567890';
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(true);
    expect(req.mcpKey).toEqual({ id: 'k-1', name: 'agent', source: 'db' });
    expect(req.mcpKeyUserId).toBe('42');
    expect(mockFindUserByMcpKey).toHaveBeenCalledWith('sk-stas_validkey1234567890');
    expect(mockTouchMcpKey).toHaveBeenCalledWith('k-1');
  });

  it('returns 401 for an unknown or revoked DB key', async () => {
    mockFindUserByMcpKey.mockResolvedValue(null);
    const { req, res } = mockReqRes();
    req.headers['authorization'] = 'Bearer sk-stas_unknown';
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or missing API key' });
    expect(mockTouchMcpKey).not.toHaveBeenCalled();
  });

  it('returns 500 when the DB lookup throws', async () => {
    mockFindUserByMcpKey.mockRejectedValue(new Error('db down'));
    const { req, res } = mockReqRes();
    req.headers['authorization'] = 'Bearer sk-stas_boom';
    const wasNext = await invokeAuth(req, res);
    expect(wasNext()).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});
