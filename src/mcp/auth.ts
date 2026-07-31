/**
 * MCP key authentication middleware.
 *
 * Shared by both MCP surfaces:
 *   - REST:  /mcp/*            (routes/mcp.ts)
 *   - JSON-RPC: /mcp/jsonrpc   (mcp/agentServer.ts)
 *
 * Resolution order:
 *   1. If MCP auth is disabled (config.mcp.authEnabled === false) → allow.
 *   2. Bearer token → SHA-256 hash → lookup in mcp_api_keys (revoked_at IS NULL).
 *   3. Legacy fallback: token equals env MCP_API_KEY (config.mcp.apiKey) → allow.
 *   4. Otherwise → 401.
 *
 * On success, sets:
 *   req.mcpKey = { id, name, source: 'db' | 'env' }
 *   req.mcpKeyUserId = userId (string) — the key owner, when known.
 */

import { type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';
import { findUserByMcpKey, touchMcpKey } from '../services/mcpKeys.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mcp-auth' });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpKey?: { id: string; name: string; source: 'db' | 'env' };
      mcpKeyUserId?: string;
    }
  }
}

export function mcpKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.mcp.authEnabled) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    res.status(401).json({ error: 'Invalid authorization' });
    return;
  }

  // Legacy env-key fallback (self-hosted single key)
  const envKey = config.mcp.apiKey;
  if (envKey && token === envKey) {
    req.mcpKey = { id: 'env', name: 'env', source: 'env' };
    next();
    return;
  }

  void (async () => {
    try {
      const found = await findUserByMcpKey(token);
      if (!found) {
        res.status(401).json({ error: 'Invalid or missing API key' });
        return;
      }
      req.mcpKey = { id: found.keyId, name: found.name, source: 'db' };
      req.mcpKeyUserId = found.userId;
      touchMcpKey(found.keyId);
      next();
    } catch (err) {
      log.error({ err: String(err) }, 'MCP key lookup failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  })();
}
