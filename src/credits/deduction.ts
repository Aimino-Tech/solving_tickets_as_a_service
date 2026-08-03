import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { notificationHistoryRepository } from '../db/repositories/NotificationHistoryRepository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'credit-deduction' });

const CREDIT_COST_PER_FIX = 50;
const LOW_BALANCE_THRESHOLD = 100;
const CRITICAL_BALANCE_THRESHOLD = 25;

export async function deductForFixRun(
  accountId: number,
  runId: string,
  issueTitle?: string,
): Promise<{ success: boolean; balance: number; error?: string }> {
  try {
    const balance = await creditsRepository.getBalance(accountId);
    if (balance.balance < CREDIT_COST_PER_FIX) {
      log.warn({ accountId, balance: balance.balance, required: CREDIT_COST_PER_FIX }, 'Insufficient credits for fix run');
      return { success: false, balance: balance.balance, error: 'Insufficient credits' };
    }

    const newBalance = await creditsRepository.deduct(accountId, CREDIT_COST_PER_FIX, {
      description: `Fix run ${runId}${issueTitle ? `: ${issueTitle}` : ''}`,
    });

    log.info({ accountId, runId, amount: CREDIT_COST_PER_FIX, newBalance: newBalance.balance }, 'Credits deducted for fix run');

    if (newBalance.balance <= CRITICAL_BALANCE_THRESHOLD) {
      await sendLowBalanceAlert(accountId, newBalance.balance, 'critical');
    } else if (newBalance.balance <= LOW_BALANCE_THRESHOLD) {
      await sendLowBalanceAlert(accountId, newBalance.balance, 'warning');
    }

    return { success: true, balance: newBalance.balance };
  } catch (err) {
    log.error({ err: String(err), accountId, runId }, 'Failed to deduct credits');
    return { success: false, balance: 0, error: String(err) };
  }
}

export async function refundForFailedRun(
  accountId: number,
  runId: string,
): Promise<void> {
  try {
    await creditsRepository.credit(accountId, CREDIT_COST_PER_FIX, {
      type: 'refund',
      description: `Refund for failed fix run ${runId}`,
    });
    log.info({ accountId, runId, amount: CREDIT_COST_PER_FIX }, 'Credits refunded for failed fix run');
  } catch (err) {
    log.error({ err: String(err), accountId, runId }, 'Failed to refund credits');
  }
}

export async function checkLowBalance(accountId: number): Promise<{ isLow: boolean; level?: 'warning' | 'critical'; balance: number }> {
  try {
    const balance = await creditsRepository.getBalance(accountId);
    if (balance.balance <= CRITICAL_BALANCE_THRESHOLD) {
      return { isLow: true, level: 'critical', balance: balance.balance };
    }
    if (balance.balance <= LOW_BALANCE_THRESHOLD) {
      return { isLow: true, level: 'warning', balance: balance.balance };
    }
    return { isLow: false, balance: balance.balance };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to check low balance');
    return { isLow: false, balance: 0 };
  }
}

async function sendLowBalanceAlert(accountId: number, balance: number, level: 'warning' | 'critical'): Promise<void> {
  try {
    const title = level === 'critical'
      ? 'Critical: Credit balance is very low'
      : 'Warning: Credit balance running low';
    const body = level === 'critical'
      ? `Your SYNTARO credit balance is ${balance} credits. Top up to avoid service interruption.`
      : `Your SYNTARO credit balance is ${balance} credits. Consider purchasing more credits soon.`;

    await notificationHistoryRepository.create({
      userId: String(accountId),
      eventType: 'low_balance',
      channel: 'in_app',
      title,
      body,
      metadata: { balance, level },
    });

    log.info({ accountId, balance, level }, 'Low balance alert sent');
  } catch (err) {
    log.warn({ err: String(err), accountId }, 'Failed to send low balance alert');
  }
}
