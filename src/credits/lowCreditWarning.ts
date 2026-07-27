import { rootLogger } from '../utils/logger.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { notificationHistoryRepository } from '../db/repositories/NotificationHistoryRepository.js';

const log = rootLogger.child({ module: 'low-credit-warning' });

const WARNING_THRESHOLD = 0.2;
const CRITICAL_THRESHOLD = 0.1;

interface AccountBalance {
  accountId: number;
  userId: number;
  balance: number;
  lifetimeCredits: number;
}

export async function checkLowCreditAccounts(): Promise<void> {
  const { queryWithRetry } = await import('../db/connection.js');
  const result = await queryWithRetry<AccountBalance>(
    `SELECT cb.account_id as "accountId", cb.balance, cb.lifetime_credits as "lifetimeCredits",
            u.id as "userId"
     FROM credit_balances cb
     JOIN accounts a ON a.id = cb.account_id
     LEFT JOIN users u ON u.email = a.email
     WHERE cb.lifetime_credits > 0
       AND cb.balance::float / NULLIF(cb.lifetime_credits, 0) < $1`,
    [WARNING_THRESHOLD],
  );

  for (const account of result.rows) {
    const ratio = account.lifetimeCredits > 0 ? account.balance / account.lifetimeCredits : 1;
    const level = ratio < CRITICAL_THRESHOLD ? 'critical' : 'warning';

    log.warn({ accountId: account.accountId, balance: account.balance, ratio, level },
      `Low credit ${level} for account ${account.accountId}`);

    if (account.userId) {
      const title = level === 'critical' ? 'Credits Critically Low' : 'Credits Running Low';
      const body = level === 'critical'
        ? `Your credit balance (${account.balance}) is critically low. Please top up to avoid service interruption.`
        : `Your credit balance (${account.balance}) is running low. Consider purchasing more credits.`;

      await notificationHistoryRepository.insert({
        userId: account.userId,
        eventType: level === 'critical' ? 'pipeline_failed' : 'review_needed',
        channel: 'in_app',
        title,
        body,
        metadata: { accountId: account.accountId, balance: account.balance, level },
      });
    }
  }
}
