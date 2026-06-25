/**
 * Environment sanitizer — strips secrets from agent-visible environments
 * and redacts secret-like values from log output.
 *
 * ## Usage
 *
 * ```ts
 * import { sanitizeEnv, redactSecrets, validateRequiredEnv } from '../security/env-sanitizer.js';
 *
 * const safe = sanitizeEnv(process.env);
 * const safeLog = redactSecrets('Token: sk-my-secret-key-here');
 * const { missing } = validateRequiredEnv(['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET']);
 * ```
 */

import { isAllowed } from './env-allowlist.js';

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/**
 * Replace a labelled value (e.g. `token=abc123`) preserving the label and
 * separator but replacing the value portion with [REDACTED].
 */
function replaceLabeledValue(
  _match: string,
  label: string,
  separator: string,
  _value: string,
): string {
  return `${label}${separator}[REDACTED]`;
}

/**
 * Replace a connection string (e.g. `postgres://user:pass@`) preserving the
 * protocol + user but replacing the password with [REDACTED].
 *
 * Supports both `protocol://user:pass@` and `protocol://:pass@` (no user).
 */
function replaceConnectionString(
  match: string,
  protocol: string,
  userInfo: string,
  _password: string,
): string {
  // userInfo is the part between :// and the password, e.g. "user:" or ":" (no user)
  return `${protocol}://${userInfo}[REDACTED]@`;
}

// ---------------------------------------------------------------------------
// Secret-matching patterns
// ---------------------------------------------------------------------------

/**
 * Pairs of [regex, replacement] applied in order by redactSecrets().
 * Replacement can be a string or a function (for capture-group-aware redaction).
 *
 * Order matters — more specific patterns should come before generic ones.
 */
const SECRET_PATTERNS: Array<[RegExp, string | ((sub: string, ...args: string[]) => string)]> = [
  // ── PEM-encoded private keys (MUST come before generic base64 pattern) ──
  // Handles: -----BEGIN RSA PRIVATE KEY-----, -----BEGIN PRIVATE KEY-----, etc.
  [/-----BEGIN\s+(?:(?:RSA|DSA|EC|OPENSSH)\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:(?:RSA|DSA|EC|OPENSSH)\s+)?PRIVATE\s+KEY-----/g, '[REDACTED]'],

  // ── Connection strings with credentials ──
  // Matches: protocol://user:pass@ or protocol://:pass@ (no user)
  [/(redis|rediss|mongodb|mongodb\+srv|mysql|postgres|postgresql|amqp|amqps|rabbitmq):\/\/((?:[^@\s:]+:)?:?)[^@\s]+@/g, replaceConnectionString],

  // ── AI / API keys ──
  [/(?:sk-|sk-ant-|sk-proj-)[a-zA-Z0-9_\-]{20,}/g, '[REDACTED]'],

  // ── AWS-style keys ──
  [/(?:AKIA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[a-zA-Z0-9]{16,}/g, '[REDACTED]'],

  // ── GitHub tokens ──
  [/(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9_]{36,}/g, '[REDACTED]'],

  // ── GitLab tokens ──
  [/glpat-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED]'],

  // ── Stripe keys ──
  [/(?:sk_live_|sk_test_|rk_live_|rk_test_|pk_live_|pk_test_)[a-zA-Z0-9]{24,}/g, '[REDACTED]'],

  // ── Slack tokens / bots ──
  [/(?:xox[baprs]-|xapp-)[a-zA-Z0-9\-]{20,}/g, '[REDACTED]'],

  // ── JWT tokens (three base64url segments) ──
  [/eyJ[a-zA-Z0-9_\-+/]+\.eyJ[a-zA-Z0-9_\-+/]+\.[a-zA-Z0-9_\-+/]+/g, '[REDACTED]'],

  // ── Bearer tokens (header-based) ──
  [/Bearer\s+[a-zA-Z0-9_\-+/]{20,}/g, '[REDACTED]'],

  // ── Labelled secret values — preserve the label ──
  // Matches: token=xxx, password = yyy, api_key:zzz, etc.
  [/(token|password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?token|session[_-]?id)(\s*[:=]\s*["']?)([^\s"'&]+)/gi, replaceLabeledValue],
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strip all environment variables not in the allowlist.
 *
 * @returns A new object containing only the allowed env vars that were present.
 */
export function sanitizeEnv(input: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && isAllowed(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Redact secret-looking values from a string (e.g. a log message).
 *
 * Applies all SECRET_PATTERNS and replaces matches with `[REDACTED]`.
 * Use this on any string that may contain env values before logging it.
 */
export function redactSecrets(input: string): string {
  let result = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement as string | ((sub: string, ...args: string[]) => string));
  }
  return result;
}

/**
 * Redact values in a structured object recursively.
 *
 * Walks the object tree and redacts any string values that match secret
 * patterns, plus redacts known sensitive key names.
 */
export function redactObject<T>(input: T): T {
  if (typeof input === 'string') {
    return redactSecrets(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item)) as unknown as T;
  }

  if (input !== null && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      // Redact known sensitive keys entirely
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('privatekey') ||
        lowerKey.includes('private_key') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('credential')
      ) {
        result[key] = '[REDACTED]' as unknown as T;
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as T;
  }

  return input;
}

/**
 * Validate that all required environment variables are set.
 *
 * @returns An object with a `missing` array of keys not found in `process.env`.
 */
export function validateRequiredEnv(required: string[]): { missing: string[] } {
  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key] || process.env[key]!.trim() === '') {
      missing.push(key);
    }
  }
  return { missing };
}
