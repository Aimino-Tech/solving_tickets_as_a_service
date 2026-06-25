/**
 * Security module — admin auth, audit trail, IP allowlisting,
 * sandbox security, environment sanitization, and security utilities.
 */

export { adminAuthMiddleware } from './adminAuth.js';
export { writeAuditLog } from './audit.js';
export type { AuditEntry } from './audit.js';
export { ipAllowlistMiddleware } from './ipAllowlist.js';
export {
  SANDBOX_SECURITY,
  validateSandboxConfig,
  SANDBOX_DOCKER_OPTS,
  getDockerSecurityOpts,
} from './sandboxSecurity.js';

// ── Environment sanitization ──────────────────────────────────────────
export { ALLOWED_VARS, isAllowed, allowedPresent } from './env-allowlist.js';
export {
  sanitizeEnv,
  redactSecrets,
  redactObject,
  validateRequiredEnv,
} from './env-sanitizer.js';
export { validateRequiredEnvOnStartup, getCriticalVars } from './env-validate.js';
