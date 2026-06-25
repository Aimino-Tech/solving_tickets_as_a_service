/**
 * Security module — admin auth, audit trail, IP allowlisting,
 * sandbox security, malicious code detection, and security utilities.
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

// ── Malicious Code Detection ──────────────────────────────────────────
export {
  scanDiff,
  parseDiff,
  hasBlockingFindings,
  groupBySeverity,
  loadFalsePositivePatterns,
  resetFalsePositivePatterns,
  PATTERNS,
} from './diff-scanner.js';
export type { ScanResult, FindingSeverity } from './diff-scanner.js';

export {
  runTruffleHog,
  runGitleaks,
  runAllScanners,
} from './trufflehog-scanner.js';
export type { Finding } from './trufflehog-scanner.js';

export {
  runDetectionGate,
} from './detection-gate.js';
export type { GateResult } from './detection-gate.js';

export {
  trackFinding,
  trackGateRun,
  shutdownTracking,
} from './tracking.js';
