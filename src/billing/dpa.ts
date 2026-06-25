import { queryWithRetry } from '../db/connection.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'billing-dpa' });
export const DPA_CURRENT_VERSION = config.dataPrivacy.dpaVersion;

export interface DpaRecord {
  accountId: number;
  version: string;
  acceptedAt: string;
  ipAddress: string | null;
}

export async function getDpaStatus(accountId: number): Promise<{
  accepted: boolean;
  currentVersion: string;
  record: DpaRecord | null;
}> {
  try {
    const result = await queryWithRetry<DpaRecord>(
      `SELECT account_id as "accountId", version, accepted_at as "acceptedAt", ip_address as "ipAddress"
       FROM dpa_acceptance WHERE account_id = $1 ORDER BY accepted_at DESC LIMIT 1`,
      [accountId],
    );
    const record = result.rows[0] ?? null;
    return { accepted: record !== null && record.version === DPA_CURRENT_VERSION, currentVersion: DPA_CURRENT_VERSION, record };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to check DPA status');
    return { accepted: false, currentVersion: DPA_CURRENT_VERSION, record: null };
  }
}

export async function acceptDpa(accountId: number, ipAddress?: string): Promise<{ accepted: boolean; version: string }> {
  try {
    await queryWithRetry(
      `INSERT INTO dpa_acceptance (account_id, version, accepted_at, ip_address)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (account_id, version) DO UPDATE SET accepted_at = NOW(), ip_address = EXCLUDED.ip_address`,
      [accountId, DPA_CURRENT_VERSION, ipAddress ?? null],
    );
    log.info({ accountId, version: DPA_CURRENT_VERSION }, 'DPA accepted');
    return { accepted: true, version: DPA_CURRENT_VERSION };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to accept DPA');
    throw err;
  }
}
