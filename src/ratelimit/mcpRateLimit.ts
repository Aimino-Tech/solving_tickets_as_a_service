/**
 * Rate limiting middleware for MCP API tools.
 * Uses a simple in-memory sliding window counter.
 *
 * Configured via:
 *   MCP_RATE_LIMIT_WINDOW_MS  — Window duration in ms (default: 60000)
 *   MCP_RATE_LIMIT_MAX        — Max requests per window (default: 60)
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mcp-rate-limit' });

interface WindowEntry {
  windowStart: number;
  count: number;
}

const ipWindows = new Map<string, WindowEntry>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipWindows.entries()) {
    if (now - entry.windowStart > config.mcp.rateLimit.windowMs * 2) {
      ipWindows.delete(ip);
    }
  }
}, 300_000);

/**
 * Rate limiting middleware for MCP endpoints.
 * Tracks requests per IP address using a sliding window.
 */
export function mcpRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const windowMs = config.mcp.rateLimit.windowMs;
  const maxRequests = config.mcp.rateLimit.maxRequests;

  // Skip rate limiting if disabled
  if (maxRequests <= 0) {
    next();
    return;
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = ipWindows.get(ip);

  // If no entry or window expired, start a new window
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { windowStart: now, count: 0 };
    ipWindows.set(ip, entry);
  }

  entry.count++;

  // Set rate limit headers
  const remaining = Math.max(0, maxRequests - entry.count);
  const resetTime = entry.windowStart + windowMs;

  res.setHeader('X-RateLimit-Limit', String(maxRequests));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetTime / 1000)));

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((resetTime - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));

    log.warn({ ip, count: entry.count, maxRequests }, 'MCP rate limit exceeded');

    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many MCP API requests. Please wait and retry.',
        retryAfter,
      },
    });
    return;
  }

  next();
}
