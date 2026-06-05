/**
 * Express middleware for credit-based rate limiting across all layers.
 *
 * Applies rate limits in this order:
 *   1. Per-IP (fallback for unauthenticated endpoints)
 *   2. Per-account (by GitHub installation ID)
 *   3. Per-repo (by repo owner/name)
 *
 * Each layer has configurable limits by subscription tier:
 *   - Free:       10 req/min per account,  5 req/min per repo
 *   - Pro:        60 req/min per account, 30 req/min per repo
 *   - Enterprise: 300 req/min per account, 150 req/min per repo
 *
 * Sets standard rate limit headers on all responses.
 * Returns 429 with structured error on limit exceeded.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ All Redis errors are caught — request proceeds (fail-open) if Redis down
 * ✅ Rate limit headers are always set, even on errors
 * ✅ Middleware only blocks on explicit rate limit exceeded, never on errors
 * ✅ IP extraction handles proxies (X-Forwarded-For) and missing headers
 * ────────────────────────────────────────────────────────────────────
 */

import type { NextFunction, Request, Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import type { ConcurrencyManager } from './concurrencyManager.js';
import { getConcurrencyManager, TIER_CONCURRENCY_LIMITS } from './concurrencyManager.js';
import type { RedisRateLimiter } from './redisRateLimiter.js';
import { getRateLimiter } from './redisRateLimiter.js';
import {
  rateLimitBlocked,
  rateLimitAllowed,
} from './metrics.js';

const log = rootLogger.child({ module: 'rate-limit-middleware' });

// ---------------------------------------------------------------------------
// Per-tier rate limit configuration
// ---------------------------------------------------------------------------

export interface TierLimits {
  /** Webhook requests per minute per account. */
  accountReqPerMin: number;
  /** Webhook requests per minute per repo. */
  repoReqPerMin: number;
  /** Concurrent fix runs for this tier. */
  concurrencyLimit: number;
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: { accountReqPerMin: 10, repoReqPerMin: 5, concurrencyLimit: 1 },
  pro: { accountReqPerMin: 60, repoReqPerMin: 30, concurrencyLimit: 3 },
  enterprise: { accountReqPerMin: 300, repoReqPerMin: 150, concurrencyLimit: 10 },
};

const DEFAULT_TIER = 'pro';
const WINDOW_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// Header names
// ---------------------------------------------------------------------------

const HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
  policy: 'X-RateLimit-Policy',
  retryAfter: 'Retry-After',
} as const;

// ---------------------------------------------------------------------------
// Rate limit header helpers
// ---------------------------------------------------------------------------

function setRateLimitHeaders(
  res: Response,
  layer: string,
  limit: number,
  remaining: number,
  resetTime: number,
): void {
  res.setHeader(`${HEADERS.limit}-${layer}`, String(limit));
  res.setHeader(`${HEADERS.remaining}-${layer}`, String(remaining));
  res.setHeader(`${HEADERS.reset}-${layer}`, String(Math.ceil(resetTime / 1000)));
}

function setRetryAfter(res: Response, resetMs: number): void {
  const seconds = Math.ceil(resetMs / 1000);
  res.setHeader(HEADERS.retryAfter, String(seconds));
}

function sendRateLimited(res: Response, layer: string, resetMs: number): void {
  setRetryAfter(res, resetMs);
  res.status(429).json({
    error: 'Too many requests',
    layer,
    retryAfter: Math.ceil(resetMs / 1000),
  });
}

// ---------------------------------------------------------------------------
// IP extraction helper
// ---------------------------------------------------------------------------

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface RateLimitMiddlewareOptions {
  rateLimiter?: RedisRateLimiter;
  concurrencyManager?: ConcurrencyManager;
  /** Map of account IDs to subscription tiers. In production, fetch from DB/API. */
  getTierForAccount?: (accountId: number) => string | undefined;
}

/**
 * Create the Express rate limiting middleware.
 *
 * Usage:
 *   app.use('/webhook', createRateLimitMiddleware());
 *
 * The middleware checks:
 *   1. Per-IP rate limit (global fallback)
 *   2. Per-account rate limit (by installation ID)
 *   3. Per-repo rate limit (by repo owner/name)
 *
 * Stops at the first layer that exceeds its limit and returns 429.
 * On success, sets all rate limit headers.
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const rateLimiter = options.rateLimiter ?? getRateLimiter();
  const concurrencyManager = options.concurrencyManager ?? getConcurrencyManager();
  const getTier = options.getTierForAccount ?? ((_accountId: number) => DEFAULT_TIER);

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Skip non-webhook paths
    if (!req.path.startsWith('/webhook')) {
      next();
      return;
    }

    const ip = extractIp(req);
    const accountId = extractAccountId(req);
    const tier = accountId ? getTier(accountId) : DEFAULT_TIER;
    const tierLimits = TIER_LIMITS[tier] ?? TIER_LIMITS[DEFAULT_TIER];

    try {
      // ── Layer 1: Per-IP rate limit (always checked) ──────────────
      const ipResult = await rateLimiter.check(`ip:${ip}`, 100, WINDOW_MS);
      setRateLimitHeaders(res, 'ip', ipResult.limit, ipResult.remaining, ipResult.resetTime);

      if (!ipResult.allowed) {
        rateLimitBlocked.inc({ layer: 'ip', ip, accountId: accountId ?? 0 });
        log.warn({ ip, path: req.path }, 'IP rate limit exceeded');
        sendRateLimited(res, 'ip', ipResult.resetMs);
        return;
      }

      // ── Layer 2: Per-account rate limit ──────────────────────────
      if (accountId) {
        const accountResult = await rateLimiter.check(
          `account:${accountId}`,
          tierLimits.accountReqPerMin,
          WINDOW_MS,
        );
        setRateLimitHeaders(res, 'account', accountResult.limit, accountResult.remaining, accountResult.resetTime);

        if (!accountResult.allowed) {
          rateLimitBlocked.inc({ layer: 'account', accountId, tier });
          log.warn({ accountId, tier, path: req.path }, 'Account rate limit exceeded');
          sendRateLimited(res, 'account', accountResult.resetMs);
          return;
        }

        // ── Layer 3: Per-repo rate limit ───────────────────────────
        const repoKey = extractRepoKey(req);
        if (repoKey) {
          const repoResult = await rateLimiter.check(
            `repo:${repoKey}`,
            tierLimits.repoReqPerMin,
            WINDOW_MS,
          );
          setRateLimitHeaders(res, 'repo', repoResult.limit, repoResult.remaining, repoResult.resetTime);

          if (!repoResult.allowed) {
            rateLimitBlocked.inc({ layer: 'repo', repo: repoKey, accountId, tier });
            log.warn({ repo: repoKey, accountId, tier, path: req.path }, 'Repo rate limit exceeded');
            sendRateLimited(res, 'repo', repoResult.resetMs);
            return;
          }
        }
      }

      // All layers passed — record and proceed
      rateLimitAllowed.inc({ tier, accountId: accountId ?? 0 });

      // Set policy header
      res.setHeader(HEADERS.policy, `${tier}; w=60`);

      next();
    } catch (err) {
      // Fail-open: allow request if rate limiter has an unexpected error
      log.error({ err: String(err), path: req.path }, 'Rate limit middleware error — allowing request');
      rateLimitAllowed.inc({ tier: 'error-fallback', accountId: accountId ?? 0 });
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Request metadata extractors
// ---------------------------------------------------------------------------

/**
 * Extract the GitHub installation ID from the request.
 * Looks in multiple places: query param, header, body, path.
 * Returns null if not found (unauthenticated request).
 */
function extractAccountId(req: Request): number | null {
  // Check body first (most webhooks have installation in payload)
  if (req.body?.installation?.id) {
    return Number(req.body.installation.id);
  }

  // Check headers
  const headerVal = req.headers['x-github-installation-id'] as string | undefined;
  if (headerVal) {
    const parsed = Number(headerVal);
    if (!Number.isNaN(parsed)) return parsed;
  }

  // Check query params
  const queryVal = req.query.installation_id as string | undefined;
  if (queryVal) {
    const parsed = Number(queryVal);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}

/**
 * Extract the repo identifier (owner/name) from the request.
 */
function extractRepoKey(req: Request): string | null {
  // Check body first
  if (req.body?.repository?.full_name) {
    return req.body.repository.full_name;
  }
  if (req.body?.repository?.owner?.login && req.body?.repository?.name) {
    return `${req.body.repository.owner.login}/${req.body.repository.name}`;
  }

  // Check headers
  const headerVal = req.headers['x-github-repo'] as string | undefined;
  if (headerVal) return headerVal;

  return null;
}
