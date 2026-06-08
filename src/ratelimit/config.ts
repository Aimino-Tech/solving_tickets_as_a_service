/**
 * Rate limit tier configuration.
 *
 * Central, config-driven definitions for all route-group rate limits.
 * Each route group has:
 *   - windowMs: sliding window duration (milliseconds)
 *   - max:      maximum requests in that window (per IP / per auth)
 *   - authAware: whether the limit differs by auth status
 *   - maxUnauthenticated: separate (stricter) limit for unauthenticated (if authAware)
 *
 * ── Route groups ──────────────────────────────────────────────────────────
 * /api/v1/*        — 100 req/min authenticated, 20 req/min unauthenticated
 * /admin/*         — 30 req/min per IP
 * /health          — 60 req/min per IP
 * /metrics         — 10 req/min per IP
 * /docs            — 30 req/min per IP
 * /webhook         — 30 req/min per IP
 * /api/v1/billing  — 30 req/min per IP
 * /api/v1/me       — 60 req/min per IP
 * /api/v1/dashboard— 60 req/min per IP
 * /api/v1/credits  — 60 req/min per IP
 * /admin/webhooks  — 30 req/min per IP
 * /auth            — 20 req/min per IP
 * /feature-flags   — 30 req/min per IP
 * ──────────────────────────────────────────────────────────────────────────
 *
 * All defaults are overridable via environment variables (see config.ts).
 */

export interface RateLimitTierConfig {
  /** Route path prefix (used for matching). */
  route: string;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
  /** Maximum requests in window (per IP). */
  max: number;
  /** Whether to differentiate limits by auth status. */
  authAware?: boolean;
  /** Stricter limit for unauthenticated requests (if authAware). */
  maxUnauthenticated?: number;
  /** Human-readable label for the tier. */
  label: string;
}

/**
 * Default rate limit tier definitions.
 * These values are used unless overridden by environment variables.
 */
export const DEFAULT_RATE_LIMIT_TIERS: RateLimitTierConfig[] = [
  {
    route: '/api/v1',
    windowMs: 60_000,
    max: 100,
    authAware: true,
    maxUnauthenticated: 20,
    label: 'API (authenticated 100/min, unauthenticated 20/min)',
  },
  {
    route: '/admin',
    windowMs: 60_000,
    max: 30,
    label: 'Admin (30/min)',
  },
  {
    route: '/health',
    windowMs: 60_000,
    max: 60,
    label: 'Health (60/min)',
  },
  {
    route: '/metrics',
    windowMs: 60_000,
    max: 10,
    label: 'Metrics (10/min)',
  },
  {
    route: '/docs',
    windowMs: 60_000,
    max: 30,
    label: 'Docs (30/min)',
  },
  {
    route: '/webhook',
    windowMs: 60_000,
    max: 30,
    label: 'Webhook (30/min)',
  },
];

/**
 * Rate limit tier names for env var lookup.
 */
export type RateLimitTierName =
  | 'api'
  | 'admin'
  | 'health'
  | 'metrics'
  | 'docs'
  | 'webhook'
  | 'billing'
  | 'dashboard'
  | 'adminWebhooks'
  | 'featureFlags'
  | 'auth';

/**
 * Map tier names to their default configs for easy env-var-driven override.
 */
export const TIER_DEFAULTS: Record<RateLimitTierName, RateLimitTierConfig> = {
  api: {
    route: '/api/v1',
    windowMs: 60_000,
    max: 100,
    authAware: true,
    maxUnauthenticated: 20,
    label: 'API (authenticated 100/min, unauthenticated 20/min)',
  },
  admin: {
    route: '/admin',
    windowMs: 60_000,
    max: 30,
    label: 'Admin (30/min)',
  },
  health: {
    route: '/health',
    windowMs: 60_000,
    max: 60,
    label: 'Health (60/min)',
  },
  metrics: {
    route: '/metrics',
    windowMs: 60_000,
    max: 10,
    label: 'Metrics (10/min)',
  },
  docs: {
    route: '/docs',
    windowMs: 60_000,
    max: 30,
    label: 'Docs (30/min)',
  },
  webhook: {
    route: '/webhook',
    windowMs: 60_000,
    max: 30,
    label: 'Webhook (30/min)',
  },
  billing: {
    route: '/api/v1/billing',
    windowMs: 60_000,
    max: 30,
    label: 'Billing (30/min)',
  },
  dashboard: {
    route: '/api/v1/me',
    windowMs: 60_000,
    max: 60,
    label: 'Dashboard (60/min)',
  },
  adminWebhooks: {
    route: '/admin/webhooks',
    windowMs: 60_000,
    max: 30,
    label: 'Admin Webhooks (30/min)',
  },
  featureFlags: {
    route: '/api/v1/admin/feature-flags',
    windowMs: 60_000,
    max: 30,
    label: 'Feature Flags (30/min)',
  },
  auth: {
    route: '/auth',
    windowMs: 60_000,
    max: 20,
    label: 'Auth (20/min)',
  },
};
