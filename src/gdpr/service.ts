/**
 * GDPR compliance core (AIM-4496).
 *
 * Right-to-erasure, data portability, consent preferences, and data
 * anonymization. Uses the local Postgres pool via queryWithRetry so it works
 * with or without Supabase Auth being configured.
 *
 * User data sources: users, github_oauth_tokens, github_installations,
 * github_webhook_configs, notification_history, run_feedback, runs.
 *
 * Consent preferences use the consent_preferences table created by migration
 * 012_consent_preferences (user_id VARCHAR PK, analytics/marketing/functional
 * booleans) — the schema shipped in the merged #748 P0 work.
 */

import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'gdpr' });

export interface UserDataExport {
  user: Record<string, unknown> | null;
  oauth: Record<string, unknown>[];
  installations: Record<string, unknown>[];
  webhookConfigs: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  feedback: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  consent: Record<string, unknown>[];
  exportedAt: string;
}

async function getUserId(userId: string): Promise<number | null> {
  if (/^\d+$/.test(userId)) return Number(userId);
  const result = await queryWithRetry<{ id: number }>('SELECT id FROM users WHERE supabase_uid = $1 LIMIT 1', [userId]);
  return result?.rows?.[0]?.id ?? null;
}

async function anonymizeEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(email).digest('hex').slice(0, 16);
  return `anon-${hash}@anonymized.local`;
}

/**
 * Export all personal data held about a user (data portability, GDPR Art. 20).
 */
export async function exportUserData(userId: string): Promise<UserDataExport> {
  const numericId = await getUserId(userId);
  const empty: UserDataExport = {
    user: null,
    oauth: [],
    installations: [],
    webhookConfigs: [],
    notifications: [],
    feedback: [],
    runs: [],
    consent: [],
    exportedAt: new Date().toISOString(),
  };
  if (!numericId) return empty;

  const [user, oauth, installations, webhookConfigs, notifications, feedback, runs, consent] = await Promise.all([
    queryWithRetry('SELECT id, email, name, created_at FROM users WHERE id = $1', [numericId]),
    queryWithRetry(
      'SELECT github_login, github_user_id, scope, created_at FROM github_oauth_tokens WHERE user_id = $1',
      [numericId],
    ),
    queryWithRetry(
      'SELECT account_login, account_type, repo_scope, created_at FROM github_installations WHERE user_id = $1',
      [numericId],
    ),
    queryWithRetry('SELECT owner, repo, active, created_at FROM github_webhook_configs WHERE user_id = $1', [
      numericId,
    ]),
    queryWithRetry(
      'SELECT event_type, channel, title, body, read_at, created_at FROM notification_history WHERE user_id = $1',
      [numericId],
    ),
    queryWithRetry('SELECT r.run_id, r.verdict, r.comment, r.created_at FROM run_feedback r WHERE r.user_id = $1', [
      numericId,
    ]),
    queryWithRetry(
      `SELECT r.id, r.repo_owner, r.repo_name, r.issue_number, r.status, r.created_at, r.duration_ms
         FROM run_history r
         JOIN github_installations gi ON gi.installation_id = r.installation_id
         WHERE gi.user_id = $1`,
      [numericId],
    ),
    queryWithRetry('SELECT analytics, marketing, functional, updated_at FROM consent_preferences WHERE user_id = $1', [
      userId,
    ]),
  ]);

  return {
    user: user.rows[0] ?? null,
    oauth: oauth.rows,
    installations: installations.rows,
    webhookConfigs: webhookConfigs.rows,
    notifications: notifications.rows,
    feedback: feedback.rows,
    runs: runs.rows,
    consent: consent.rows,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Erase all personal data about a user (right to erasure, GDPR Art. 17).
 * Deletes the local users row and all related user-scoped rows, then records a
 * deletion request. Returns true when the user existed.
 */
export async function eraseUserData(userId: string): Promise<boolean> {
  const numericId = await getUserId(userId);
  if (!numericId) return false;

  const existing = await queryWithRetry('SELECT id FROM users WHERE id = $1', [numericId]);
  if (existing.rows.length === 0) return false;

  // github_* / notification tables key on the numeric users.id; the
  // consent_preferences table (012_consent_preferences) keys on the auth
  // user id (VARCHAR), so it is deleted with the original id.
  const tables = ['github_webhook_configs', 'github_installations', 'github_oauth_tokens', 'notification_history'];
  for (const table of tables) {
    try {
      await queryWithRetry(`DELETE FROM ${table} WHERE user_id = $1`, [numericId]);
    } catch (err) {
      log.warn({ err: String(err), table, userId: numericId }, 'Erasure: table delete failed (non-fatal)');
    }
  }
  try {
    await queryWithRetry('DELETE FROM consent_preferences WHERE user_id = $1', [userId]);
  } catch (err) {
    log.warn({ err: String(err), userId }, 'Erasure: consent_preferences delete failed (non-fatal)');
  }

  try {
    await queryWithRetry('UPDATE run_feedback SET user_id = NULL WHERE user_id = $1', [numericId]);
  } catch (err) {
    log.warn({ err: String(err), userId: numericId }, 'Erasure: run_feedback unlink failed (non-fatal)');
  }

  try {
    await queryWithRetry(
      `INSERT INTO data_deletion_requests (account_id, requested_at, scheduled_deletion_at, status)
       VALUES ($1, NOW(), NOW(), 'completed')`,
      [numericId],
    );
  } catch (err) {
    log.warn({ err: String(err), userId: numericId }, 'Erasure: deletion request record failed (non-fatal)');
  }

  try {
    await queryWithRetry('DELETE FROM users WHERE id = $1', [numericId]);
  } catch (err) {
    log.error({ err: String(err), userId: numericId }, 'Erasure: users row delete failed');
    throw err;
  }

  log.info({ userId: numericId }, 'User data erased (right to erasure)');
  return true;
}

/**
 * Anonymize a user's personal data: replace email/name with deterministic
 * hashed placeholders so the row can be retained for analytics without PII.
 */
export async function anonymizeUserData(userId: string): Promise<boolean> {
  const numericId = await getUserId(userId);
  if (!numericId) return false;

  const user = await queryWithRetry<{ email: string | null; name: string | null }>(
    'SELECT email, name FROM users WHERE id = $1',
    [numericId],
  );
  const row = user.rows[0];
  if (!row) return false;

  const anonEmail = await anonymizeEmail(row.email);
  await queryWithRetry('UPDATE users SET email = $1, name = $2, updated_at = NOW() WHERE id = $3', [
    anonEmail ?? `anon-${numericId}@anonymized.local`,
    row.name ? `anon-${numericId}` : null,
    numericId,
  ]);

  log.info({ userId: numericId }, 'User data anonymized');
  return true;
}

export interface ConsentPreference {
  key: string;
  granted: boolean;
  updatedAt: string;
}

// Columns on the consent_preferences table (012_consent_preferences).
const CONSENT_COLUMNS = ['analytics', 'marketing', 'functional'] as const;
type ConsentColumn = (typeof CONSENT_COLUMNS)[number];

/**
 * Upsert a consent preference for a user. The consent_preferences table uses
 * one column per category (analytics/marketing/functional), so a preference
 * key maps to its column and the other columns are preserved.
 */
export async function setConsentPreference(userId: string, key: string, granted: boolean): Promise<void> {
  const column = (CONSENT_COLUMNS as readonly string[]).includes(key) ? (key as ConsentColumn) : null;
  if (!column) {
    log.warn({ key, userId }, 'Unknown consent key ignored');
    return;
  }

  const existing = await queryWithRetry<Record<ConsentColumn, boolean | null>>(
    'SELECT analytics, marketing, functional FROM consent_preferences WHERE user_id = $1',
    [userId],
  );
  const current = existing.rows[0] ?? {};
  const analytics = column === 'analytics' ? granted : Boolean(current.analytics);
  const marketing = column === 'marketing' ? granted : Boolean(current.marketing);
  const functional = column === 'functional' ? granted : Boolean(current.functional);

  await queryWithRetry(
    `INSERT INTO consent_preferences (user_id, analytics, marketing, functional, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       analytics = EXCLUDED.analytics,
       marketing = EXCLUDED.marketing,
       functional = EXCLUDED.functional,
       updated_at = NOW()`,
    [userId, analytics, marketing, functional],
  );
}

/**
 * Get consent preferences for a user, merging stored values over defaults.
 */
export async function getConsentPreferences(userId: string): Promise<ConsentPreference[]> {
  const result = await queryWithRetry<Record<ConsentColumn, boolean | null> & { updated_at: string }>(
    'SELECT analytics, marketing, functional, updated_at FROM consent_preferences WHERE user_id = $1',
    [userId],
  );
  const row = result.rows[0];
  const updatedAt = row?.updated_at ? new Date(row.updated_at).toISOString() : new Date(0).toISOString();

  return [
    { key: 'necessary', granted: true, updatedAt },
    ...CONSENT_COLUMNS.map((key) => ({
      key,
      granted: row ? Boolean(row[key]) : false,
      updatedAt,
    })),
  ];
}
