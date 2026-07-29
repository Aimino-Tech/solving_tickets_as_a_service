import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'low-credit-warning' });

const WARNING_THRESHOLD = 0.2;
const CRITICAL_THRESHOLD = 0.1;

export interface LowCreditAccount {
  accountId: number;
  balance: number;
  lifetimeCredits: number;
  email: string | null;
  ratio: number;
}

export async function findLowCreditAccounts(): Promise<LowCreditAccount[]> {
  try {
    const result = await queryWithRetry<any>(
      `SELECT cb.account_id, cb.balance, cb.lifetime_credits, a.email
       FROM credit_balances cb
       JOIN accounts a ON a.id = cb.account_id
       WHERE cb.lifetime_credits > 0
         AND cb.balance > 0
         AND cb.balance::float / NULLIF(cb.lifetime_credits, 0)::float <= $1
       ORDER BY cb.balance ASC`,
      [WARNING_THRESHOLD],
    );
    return (result.rows || []).map((row: any) => ({
      accountId: row.account_id,
      balance: Number(row.balance),
      lifetimeCredits: Number(row.lifetime_credits),
      email: row.email,
      ratio: row.lifetime_credits > 0 ? Number(row.balance) / Number(row.lifetime_credits) : 0,
    }));
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to find low-credit accounts');
    return [];
  }
}

export async function sendLowCreditAlerts(): Promise<number> {
  const accounts = await findLowCreditAccounts();
  let alertCount = 0;

  for (const account of accounts) {
    try {
      const isCritical = account.ratio <= CRITICAL_THRESHOLD;
      const title = isCritical ? 'Critical: Credits Almost Exhausted' : 'Warning: Low Credits';
      const thresholdPct = Math.round((isCritical ? CRITICAL_THRESHOLD : WARNING_THRESHOLD) * 100);
      const body = isCritical
        ? `Your credit balance (${account.balance}) is critically low (under ${thresholdPct}% of lifetime purchases). Please top up to avoid service interruption.`
        : `Your credit balance (${account.balance}) is running low (under ${thresholdPct}% of lifetime purchases). Consider purchasing more credits.`;

      await queryWithRetry(
        `INSERT INTO notification_history (user_id, event_type, channel, title, body, metadata)
         VALUES (
           (SELECT user_id FROM accounts WHERE id = $1),
           $2, 'in_app', $3, $4,
           $5::jsonb
         )`,
        [
          account.accountId,
          isCritical ? 'low_credits_critical' : 'low_credits_warning',
          title,
          body,
          JSON.stringify({
            accountId: account.accountId,
            balance: account.balance,
            lifetimeCredits: account.lifetimeCredits,
            ratio: account.ratio,
          }),
        ],
      );

      if (account.email) {
        await queryWithRetry(
          `INSERT INTO notification_history (user_id, event_type, channel, title, body, metadata)
           VALUES (
             (SELECT user_id FROM accounts WHERE id = $1),
             $2, 'email', $3, $4,
             $5::jsonb
           )`,
          [
            account.accountId,
            isCritical ? 'low_credits_critical' : 'low_credits_warning',
            title,
            body,
            JSON.stringify({ to: account.email }),
          ],
        );
      }

      alertCount++;
    } catch (err) {
      log.error({ err: String(err), accountId: account.accountId }, 'Failed to send low-credit alert');
    }
  }

  if (alertCount > 0) {
    log.info({ alertCount }, 'Low-credit alerts sent');
  }
  return alertCount;
}
