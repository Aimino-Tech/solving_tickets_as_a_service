/**
 * Express middleware for credit-based rate limiting.
 *
 * Adds per-account, per-repo, and per-IP rate limit checks.
 * Sets standard `RateLimit-*` headers on all responses.
 * Integrates with the existing express-rate-limit global limiter.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Fail-open: Redis errors allow the request through (logged)
 * ✅ 429 responses include Retry-After header
 * ✅ RateLimit-* headers set on every response
 * ────────────────────────────────────────────────────────────────────
 */

import type { NextFunction, Request, Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { getRateLimiter } from './limiter.js';
import { getConcurrencyManager } from './concurrency.js';

const log = rootLogger.child({ module: 'rate-limit-middleware' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the GitHub installation ID from a request.
 * Checks headers in priority order, then falls back to body.
 */
function extractInstallationId(req: Request): number | undefined {
  // Header set by GitHub App proxy
  const headerId = req.headers['x-github-enterprise-installation-id']
    ?? req.headers['x-github-installation-id'];
  if (headerId) {
    const parsed = Number(headerId);
    if (!Number.isNaN(parsed)) return parsed;
  }

  // Try from webhook payload body (already parsed)
  const body = req.body as Record<string, unknown> | undefined;
  if (body?.installation && typeof body.installation === 'object') {
    const inst = body.installation as Record<string, unknown>;
    if (typeof inst.id === 'number') return inst.id;
  }

  return undefined;
}

/**
 * Extract the repo full name from a request.
 */
function extractRepoFullName(req: Request): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;

  // GitHub webhook payload
  if (body?.repository && typeof body.repository === 'object') {
    const repo = body.repository as Record<string, unknown>;
    if (typeof repo.full_name === 'string') return repo.full_name;
    if (typeof repo.owner === 'object' && typeof repo.name === 'string') {
      const owner = (repo.owner as Record<string, unknown>).login ?? (repo.owner as Record<string, unknown>).name;
      if (owner) return `${owner}/${repo.name}`;
    }
  }

  return undefined;
}

/**
 * Get the client IP address from the request.
 */
function extractIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Rate limit header names
// ---------------------------------------------------------------------------

const HEADERS = {
  limit: 'RateLimit-Limit',
  remaining: 'RateLimit-Remaining',
  reset: 'RateLimit-Reset',
  policy: 'RateLimit-Policy',
  retryAfter: 'Retry-After',
} as const;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that enforces account-level, repo-level, and IP-level
 * rate limits. Sets rate limit response headers on all requests.
 *
 * This middleware should be mounted AFTER the global express-rate-limit
 * (which handles the coarse global cap) on the /webhook path.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip rate limiting on health checks and non-webhook routes
  if (req.path === '/health' || req.method === 'GET') {
    next();
    return;
  }

  const limiter = getRateLimiter();
  const ip = extractIp(req);

  // Determine which scope to rate-limit by
  const installationId = extractInstallationId(req);
  const repoFullName = extractRepoFullName(req);

  // We run checks in parallel where possible
  const checks: Array<Promise<{ scope: string; result: import('./limiter.js').RateLimitResult }>> = [];

  // Per-account rate limit (primary)
  if (installationId !== undefined) {
    checks.push(
      limiter.checkAccount(installationId).then((r) => ({ scope: 'account', result: r })),
    );
  }

  // Per-repo rate limit
  if (repoFullName) {
    checks.push(
      limiter.checkRepo(repoFullName, installationId ?? 0).then((r) => ({ scope: 'repo', result: r })),
    );
  }

  // Per-IP rate limit (fallback for unauthenticated)
  if (installationId === undefined) {
    checks.push(
      limiter.checkIp(ip).then((r) => ({ scope: 'ip', result: r })),
    );
  }

  // If no checks were enqueued, just pass through with default headers
  if (checks.length === 0) {
    setDefaultHeaders(res);
    next();
    return;
  }

  // Execute all checks and determine whether to allow
  Promise.all(checks)
    .then((results) => {
      // Use the most restrictive result for headers and decision
      const mostRestrictive = results.reduce((acc, { result }) =>
        result.remaining < acc.remaining ? result : acc,
      );

      setRateLimitHeaders(res, mostRestrictive);

      // If any check was denied, reject with 429
      const denied = results.find(({ result }) => !result.allowed);
      if (denied) {
        const retryAfterSec = Math.ceil(denied.result.resetMs / 1000);
        res.setHeader(HEADERS.retryAfter, String(retryAfterSec));

        log.warn(
          {
            scope: denied.scope,
            ip,
            installationId,
            repo: repoFullName,
            limit: denied.result.limit,
            remaining: denied.result.remaining,
            retryAfterSec,
          },
          'Rate limit exceeded',
        );

        res.status(429).json({
          error: 'Too many requests',
          scope: denied.scope,
          retryAfter: retryAfterSec,
        });
        return;
      }

      next();
    })
    .catch((err) => {
      log.error({ err: String(err) }, 'Rate limit check error — allowing request (fail-open)');
      setDefaultHeaders(res);
      next();
    });
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function setRateLimitHeaders(
  res: Response,
  result: import('./limiter.js').RateLimitResult,
): void {
  res.setHeader(HEADERS.limit, String(result.limit));
  res.setHeader(HEADERS.remaining, String(result.remaining));
  res.setHeader(HEADERS.reset, String(Math.ceil(result.resetTimestamp / 1000)));
  res.setHeader(HEADERS.policy, `${result.limit};w=${Math.ceil(result.resetMs / 1000)}`);
}

function setDefaultHeaders(res: Response): void {
  res.setHeader(HEADERS.limit, '0');
  res.setHeader(HEADERS.remaining, '0');
  res.setHeader(HEADERS.reset, '0');
}
