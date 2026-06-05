/**
 * Security module barrel export.
 *
 * Exports admin authentication middleware.
 * (Audit logging is in src/audit/ -- this barrel previously re-exported an
 *  AuditService that duplicated src/audit/service.ts.)
 */

export { adminAuthMiddleware } from './adminAuth.js';
