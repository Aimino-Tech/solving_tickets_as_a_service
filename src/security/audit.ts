/**
 * Admin audit trail — logs all admin actions for security review.
 *
 * Writes structured audit log entries to the application log at the 'info'
 * level with a dedicated `audit: true` field for easy filtering.
 *
 * When a database is configured, entries are also persisted to the
 * `audit_logs` table for long-term retention and querying.
 *
 * ── Data captured ──────────────────────────────────────────────────────────
 *   action      – Human-readable action name (e.g. "admin.tier.override")
 *   actor       – Who performed the action (admin user ID or IP)
 *   target      – What was acted upon (account ID, resource identifier)
 *   details     – Structured metadata about the action
 *   outcome     – "success" or "failure"
 *   timestamp   – ISO-8601 timestamp of the event
 * ───────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'audit' });

export interface AuditEntry {
  action: string;
  actor: string;
  target: string;
  details?: Record<string, unknown>;
  outcome: 'success' | 'failure';
  error?: string;
}

/**
 * Write an audit log entry.
 *
 * The entry is always written to the application log. If a database
 * connection is available, it is also persisted to the `audit_logs` table.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const payload = {
    audit: true,
    ...entry,
    timestamp: new Date().toISOString(),
  };

  log.info(payload, `[AUDIT] ${entry.action} — ${entry.outcome}`);

  // Persist to database if explicitly enabled via config flag
  if (config.database.enableAuditPersistence) {
    try {
      const { db } = await import('../db/index.js');
      await db.insertInto('audit_logs').values({
        action: entry.action,
        actor: entry.actor,
        target: entry.target,
        details: entry.details ? JSON.stringify(entry.details) : null,
        outcome: entry.outcome,
        error: entry.error ?? null,
        created_at: new Date().toISOString(),
      }).execute();
    } catch (err) {
      // Non-fatal: log the failure but don't throw
      log.error({ err: String(err), action: entry.action }, 'Failed to persist audit log to database');
    }
  }
}
