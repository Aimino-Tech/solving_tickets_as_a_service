/**
 * Environment allowlist — defines which env vars are safe to pass to agents.
 *
 * The allowlist is the primary gate: any env var not in this list is stripped
 * before being passed to an OpenCode agent or sandbox.  The list can be
 * extended per-repo / per-plan via the `STAS_ENV_ALLOWLIST_EXTRA` env var
 * (comma-separated keys).
 *
 * ── Rationale ─────────────────────────────────────────────────────────
 * Agents should only see non-sensitive operational variables (URLs, mode
 * flags, routing info).  Secrets like API keys, tokens, passwords, and
 * database URLs must never reach the agent environment.
 */

import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Built-in safe vars
// ---------------------------------------------------------------------------

/**
 * Default set of environment variables that are safe to expose to agents.
 *
 * These are mostly operational / routing vars.  Any var not in this list
 * is considered potentially sensitive and will be stripped.
 */
const DEFAULT_ALLOWED: ReadonlySet<string> = new Set([
  // OS / runtime
  'PATH',
  'HOME',
  'USER',
  'NODE_ENV',
  'LOG_LEVEL',
  'TZ',
  'LANG',
  'LC_ALL',
  'SHELL',
  'TERM',

  // STAS operational
  'STAS_LABEL',
  'STAS_MODE',
  'STAS_DEFAULT_TIER',
  'STAS_BOT_NAME',
  'BOT_NAME',
  'STAS_PORT',

  // GitHub routing (no tokens)
  'GITHUB_REPOSITORY',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_ISSUE_NUMBER',
  'GITHUB_WEBHOOK_PATH',
  'GITHUB_REF',
  'GITHUB_SHA',

  // OpenCode routing
  'OPENCODE_URL',
  'OPENCODE_MODEL',

  // Runner context
  'RUN_MODE',
  'CI_MONITOR_ENABLED',

  // Sandbox config (non-sensitive)
  'E2B_TEMPLATE_ID',
  'E2B_SANDBOX_TIMEOUT_MS',
  'SANDBOX_PRIVILEGED',
  'SANDBOX_READONLY_ROOT',
  'SANDBOX_MEMORY_LIMIT',
  'SANDBOX_CPU_LIMIT',
  'SANDBOX_PIDS_LIMIT',
  'SANDBOX_DISK_LIMIT',
  'SANDBOX_NETWORK_ENABLED',

  // Queue routing (URLs are sensitive, but host/port not)
  'QUEUE_DEDUP_TTL_SECONDS',
  'QUEUE_KEEP_COMPLETED',
  'QUEUE_KEEP_FAILED',
  'QUEUE_MAX_RETRIES',

  // Timeouts / limits
  'FIX_TIMEOUT_MS',
  'PHASE_TIMEOUT_TRIAGE_MS',
  'PHASE_TIMEOUT_SANDBOX_MS',
  'PHASE_TIMEOUT_PRCREATION_MS',
  'MAX_AGENT_ITERATIONS',
  'MAX_ISSUE_COMMENTS',
  'STAS_RATE_LIMIT_WINDOW_MS',
  'STAS_RATE_LIMIT_MAX',

  // Feature flags
  'FEATURE_FLAGS_DEFAULT_TTL_SECONDS',
  'FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD',

  // Git platform URLs (routing)
  'GITLAB_URL',
  'BITBUCKET_USERNAME',

  // Health / alerting routing
  'HEALTH_QUEUE_DEPTH_WARN_THRESHOLD',
  'HEALTH_QUEUE_DEPTH_CRIT_THRESHOLD',
  'DLQ_RETENTION_DAYS',

  // Pricing / metering
  'STAS_DEFAULT_TIER',
  'STAS_MONTHLY_QUOTA_ENABLED',
  'STAS_WORKER_CONCURRENCY',
]);

// ---------------------------------------------------------------------------
// Build the full allowlist
// ---------------------------------------------------------------------------

/**
 * The complete set of allowed environment variable names.
 *
 * Built from the default allowlist plus any extras configured via
 * `STAS_ENV_ALLOWLIST_EXTRA` (comma-separated env var names).
 */
function buildAllowlist(): Set<string> {
  const allowed = new Set(DEFAULT_ALLOWED);

  // Append per-repo / per-plan extras
  const extraRaw = process.env.STAS_ENV_ALLOWLIST_EXTRA ?? '';
  if (extraRaw) {
    for (const key of extraRaw.split(',')) {
      const trimmed = key.trim().toUpperCase();
      if (trimmed) {
        allowed.add(trimmed);
      }
    }
  }

  return allowed;
}

/** Singleton — built once at module load. */
export const ALLOWED_VARS: ReadonlySet<string> = buildAllowlist();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a single env var name is in the allowlist.
 */
export function isAllowed(key: string): boolean {
  return ALLOWED_VARS.has(key.toUpperCase());
}

/**
 * Return the list of allowed keys that are actually present in `env`.
 */
export function allowedPresent(env: Record<string, string | undefined>): string[] {
  const present: string[] = [];
  for (const key of ALLOWED_VARS) {
    if (key in env) {
      present.push(key);
    }
  }
  return present.sort();
}
