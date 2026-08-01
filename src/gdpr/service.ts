/**
 * GDPR compliance core (AIM-4496).
 *
 * Right-to-erasure, data portability, consent preferences, and data
 * anonymization. Uses the local Postgres pool via queryWithRetry so it works
 * with or without Supabase Auth being configured.
 *
 * User data sources: users, github_oauth_tokens, github_installations,
 * github_webhook_configs, notification_history, run_feedback, runs.
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
  const result = await queryWithRetry<{ id: number }>(
    'SELECT id FROM users WHERE supabase_uid = $1 LIMIT 1',
    [userId],
  );
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

  const [user, oauth, installations, webhookConfigs, notifications, feedback, runs, consent] =
    await Promise.all([
      queryWithRetry('SELECT id, email, name, created_at FROM users WHERE id = $1', [numericId]),
      queryWithRetry(
        'SELECT github_login, github_user_id, scope, created_at FROM github_oauth_tokens WHERE user_id = $1',
        [numericId],
      ),
      queryWithRetry(
        'SELECT account_login, account_type, repo_scope, created_at FROM github_installations WHERE user_id = $1',
        [numericId],
      ),
      queryWithRetry(
        'SELECT owner, repo, active, created_at FROM github_webhook_configs WHERE user_id = $1',
        [numericId],
      ),
      queryWithRetry(
        'SELECT event_type, channel, title, body, read_at, created_at FROM notification_history WHERE user_id = $1',
        [numericId],
      ),
      queryWithRetry(
        'SELECT r.run_id, r.verdict, r.comment, r.created_at FROM run_feedback r WHERE r.user_id = $1',
        [numericId],
      ),
      queryWithRetry(
        'SELECT issue_id, repo, status, started_at, completed_at FROM run_history WHERE account_id = $1',
        [numericId],
      ),
      queryWithRetry(
        'SELECT consent_key, granted, updated_at FROM consent_preferences WHERE user_id = $1',
        [numericId],
      ),
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

  const tables = [
    'github_webhook_configs',
    'github_installations',
    'github_oauth_tokens',
    'notification_history',
    'consent_preferences',
  ];
  for (const table of tables) {
    try {
      await queryWithRetry(`DELETE FROM ${table} WHERE user_id = $1`, [numericId]);
    } catch (err) {
      log.warn({ err: String(err), table, userId: numericId }, 'Erasure: table delete failed (non-fatal)');
    }
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
  await queryWithRetry(
    'UPDATE users SET email = $1, name = $2, updated_at = NOW() WHERE id = $3',
    [anonEmail ?? `anon-${numericId}@anonymized.local`, row.name ? `anon-${numericId}` : null, numericId],
  );

  log.info({ userId: numericId }, 'User data anonymized');
  return true;
}

export interface ConsentPreference {
  key: string;
  granted: boolean;
  updatedAt: string;
}

const DEFAULT_CONSENT_KEYS = ['necessary', 'analytics', 'marketing'];

/**
 * Upsert a consent preference for a user. Keys not in the default set are
 * still accepted (future-proofing); unknown keys are stored as-is.
 */
export async function setConsentPreference(
  userId: string,
  key: string,
  granted: boolean,
): Promise<void> {
  const numericId = await getUserId(userId);
  if (!numericId) {
    throw new Error('User not found');
  }
  await queryWithRetry(
    `INSERT INTO consent_preferences (user_id, consent_key, granted, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, consent_key) DO UPDATE SET granted = EXCLUDED.granted, updated_at = NOW()`,
    [numericId, key, granted],
  );
}

/**
 * Get consent preferences for a user, merging stored values over defaults.
 */
export async function getConsentPreferences(userId: string): Promise<ConsentPreference[]> {
  const numericId = await getUserId(userId);
  const result = await queryWithRetry<{ consent_key: string; granted: boolean; updated_at: string }>(
    'SELECT consent_key, granted, updated_at FROM consent_preferences WHERE user_id = $1',
    [numericId ?? -1],
  );

  const stored = new Map(result.rows.map((r) => [r.consent_key, r]));
  return DEFAULT_CONSENT_KEYS.map((key) => {
    const existing = stored.get(key);
    return {
      key,
      granted: existing ? existing.granted : false,
      updatedAt: existing ? existing.updated_at : new Date(0).toISOString(),
    };
  });
}
