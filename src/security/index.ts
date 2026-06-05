/**
 * Security module — admin auth, audit trail, and security utilities.
 */

export { adminAuthMiddleware } from './adminAuth.js';
export { writeAuditLog } from './audit.js';
export type { AuditEntry } from './audit.js';
