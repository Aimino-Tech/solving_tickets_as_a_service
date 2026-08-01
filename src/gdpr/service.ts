import { isTableNotFoundError, queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { anonymizePii } from './anonymize.js';

const log = rootLogger.child({ module: 'gdpr-service' });

export interface ErasureResult {
  usersDeleted: number;
  accountsAnonymized: number;
}

export interface DataArchive {
  schema: 'stas-user-data-export';
  generatedAt: string;
  expiresAt: string;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    plan?: string;
    subscriptionStatus?: string;
    createdAt?: string;
  };
  accounts: Array<Record<string, unknown>>;
}

export type ConsentPreferences = Record<string, boolean>;

export async function eraseUserData(userId: string, email: string): Promise<ErasureResult> {
  const result: ErasureResult = { usersDeleted: 0, accountsAnonymized: 0 };

  try {
    const del = await queryWithRetry('DELETE FROM users WHERE id = $1', [userId]);
    result.usersDeleted = del.rowCount ?? 0;
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), userId }, 'Failed to delete user row');
    }
  }

  try {
    const anon = anonymizePii(email);
    const upd = await queryWithRetry(
      `UPDATE accounts
         SET email = $1, name = $2, plan = NULL, updated_at = NOW()
       WHERE email = $3`,
      [anon.email, anon.name, email],
    );
    result.accountsAnonymized = upd.rowCount ?? 0;
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), email }, 'Failed to anonymize account rows');
    }
  }

  try {
    await queryWithRetry('DELETE FROM cookie_consent WHERE user_id = $1', [userId]);
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), userId }, 'Failed to delete cookie consent record');
    }
  }

  log.info({ userId, ...result }, 'GDPR erasure completed');
  return result;
}

export async function exportUserData(userId: string, email: string): Promise<DataArchive> {
  const account = {
    id: userId,
    email,
    name: null as string | null,
    plan: undefined,
    subscriptionStatus: undefined,
    createdAt: undefined,
  };
  const accounts: Array<Record<string, unknown>> = [];

  try {
    const userRes = await queryWithRetry<{
      id: string;
      email: string;
      name: string | null;
      plan: string | null;
      subscription_status: string | null;
      created_at: Date | string | null;
    }>('SELECT id, email, name, plan, subscription_status, created_at FROM users WHERE id = $1', [userId]);
    if (userRes.rows[0]) {
      const row = userRes.rows[0];
      account.id = row.id;
      account.email = row.email;
      account.name = row.name;
      account.plan = row.plan ?? undefined;
      account.subscriptionStatus = row.subscription_status ?? undefined;
      account.createdAt = row.created_at ? new Date(row.created_at).toISOString() : undefined;
    }
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), userId }, 'Failed to read user row for export');
    }
  }

  try {
    const acctRes = await queryWithRetry<Record<string, unknown>>(
      'SELECT id, email, name, plan, created_at FROM accounts WHERE email = $1',
      [email],
    );
    accounts.push(...acctRes.rows);
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), email }, 'Failed to read account rows for export');
    }
  }

  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    schema: 'stas-user-data-export',
    generatedAt,
    expiresAt,
    user: account,
    accounts,
  };
}

export async function getCookiePreferences(userId: string): Promise<ConsentPreferences> {
  try {
    const res = await queryWithRetry<{ preferences: ConsentPreferences }>(
      'SELECT preferences FROM cookie_consent WHERE user_id = $1',
      [userId],
    );
    if (res.rows[0]?.preferences) return res.rows[0].preferences;
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), userId }, 'Failed to read cookie preferences');
    }
  }
  return {};
}

export async function setCookiePreferences(
  userId: string,
  preferences: ConsentPreferences,
): Promise<ConsentPreferences> {
  try {
    await queryWithRetry(
      `INSERT INTO cookie_consent (user_id, preferences, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()`,
      [userId, JSON.stringify(preferences)],
    );
  } catch (err) {
    if (!isTableNotFoundError(err)) {
      log.error({ err: String(err), userId }, 'Failed to save cookie preferences');
    }
  }
  return preferences;
}
