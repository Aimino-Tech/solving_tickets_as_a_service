import type { Request, Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'governance-rate-limit' });

const GOVERNANCE_RATE_LIMIT_REMAINING_HEADER = 'x-ratelimit-remaining';
const GOVERNANCE_RATE_LIMIT_LIMIT_HEADER = 'x-ratelimit-limit';
const GOVERNANCE_RATE_LIMIT_RESET_HEADER = 'x-ratelimit-reset';
const GOVERNANCE_PROXY_HEADER = 'x-governance-proxy';

export interface GovernanceRateLimitInfo {
  remaining: number;
  limit: number;
  reset: number;
  allowed: boolean;
}

export function extractRateLimitFromProxy(req: Request): GovernanceRateLimitInfo | null {
  const proxyHeader = req.headers[GOVERNANCE_PROXY_HEADER];
  if (!proxyHeader) {
    return null;
  }
  const remainingRaw = req.headers[GOVERNANCE_RATE_LIMIT_REMAINING_HEADER];
  const limitRaw = req.headers[GOVERNANCE_RATE_LIMIT_LIMIT_HEADER];
  const resetRaw = req.headers[GOVERNANCE_RATE_LIMIT_RESET_HEADER];
  if (!remainingRaw || !limitRaw) {
    return null;
  }
  const remaining = parseInt(String(remainingRaw), 10);
  const limit = parseInt(String(limitRaw), 10);
  const reset = resetRaw ? parseInt(String(resetRaw), 10) : Date.now() + 60000;
  if (isNaN(remaining) || isNaN(limit)) {
    return null;
  }
  return {
    remaining,
    limit,
    reset,
    allowed: remaining > 0,
  };
}

export function isBehindGovernanceProxy(req: Request): boolean {
  return !!req.headers[GOVERNANCE_PROXY_HEADER];
}

export function applyGovernanceRateLimitHeaders(res: Response, info: GovernanceRateLimitInfo): void {
  res.setHeader('X-RateLimit-Limit', String(info.limit));
  res.setHeader('X-RateLimit-Remaining', String(info.remaining));
  res.setHeader('X-RateLimit-Reset', String(info.reset));
  res.setHeader('X-RateLimit-Strategy', 'governance-proxy');
}

export function sendGovernanceRateLimited(res: Response, info: GovernanceRateLimitInfo): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((info.reset - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: 'Too many requests',
    retryAfter: retryAfterSeconds,
    strategy: 'governance-proxy',
  });
}

export function logGovernanceRateLimit(req: Request, info: GovernanceRateLimitInfo): void {
  log.warn(
    {
      path: req.path,
      remaining: info.remaining,
      limit: info.limit,
      ip: req.ip,
    },
    'Governance proxy rate limit exceeded',
  );
}
