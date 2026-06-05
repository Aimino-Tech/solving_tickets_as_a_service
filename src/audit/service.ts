/**
 * Audit Service — typed logging methods for every event type in the system.
 *
 * Each method constructs a standardized audit log entry and delegates
 * to the repository for persistence. All methods are fire-and-forget
 * (they catch errors internally) so callers never block on audit logging.
 *
 * @module audit/service
 */

import { auditRepository, type ActorType, type AuditLogEntry } from './repository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'audit-service' });

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function safeLog(entry: AuditLogEntry): Promise<void> {
  try {
    await auditRepository.insert(entry);
  } catch (err) {
    log.error({ err: String(err), action: entry.action }, 'Failed to write audit log entry');
  }
}

// ---------------------------------------------------------------------------
// Event-type loggers
// ---------------------------------------------------------------------------

/**
 * Log that a webhook was received.
 */
export async function logWebhookReceived(params: {
  source: string;
  eventType?: string;
  deliveryId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: 'webhook',
    actorId: params.deliveryId,
    action: 'webhook.received',
    resourceType: 'webhook',
    resourceId: params.deliveryId,
    details: {
      source: params.source,
      eventType: params.eventType,
      ...params.details,
    },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    correlationId: params.correlationId,
  });
}

/**
 * Log a fix job lifecycle event.
 */
export async function logFixJobEvent(params: {
  jobId: string;
  event: 'created' | 'started' | 'completed' | 'failed' | 'retried' | 'cancelled';
  accountId?: string;
  repo?: string;
  issueNumber?: number;
  error?: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: 'system',
    actorId: params.accountId,
    action: `fix.${params.event}`,
    resourceType: 'issue',
    resourceId: params.repo ? `${params.repo}#${params.issueNumber ?? 0}` : undefined,
    details: {
      jobId: params.jobId,
      repo: params.repo,
      issueNumber: params.issueNumber,
      error: params.error,
      ...params.details,
    },
    correlationId: params.correlationId,
  });
}

/**
 * Log that a PR was created.
 */
export async function logPrCreated(params: {
  prUrl: string;
  prNumber: number;
  repo: string;
  accountId?: string;
  issueNumber?: number;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: 'system',
    actorId: params.accountId,
    action: 'pr.created',
    resourceType: 'pr',
    resourceId: `${params.repo}#${params.prNumber}`,
    details: {
      prUrl: params.prUrl,
      prNumber: params.prNumber,
      repo: params.repo,
      issueNumber: params.issueNumber,
    },
    correlationId: params.correlationId,
  });
}

/**
 * Log a credit transaction (purchase, usage, adjustment, refund).
 */
export async function logCreditTransaction(params: {
  type: 'purchase' | 'usage' | 'adjustment' | 'refund';
  accountId: string;
  amount: number;
  balance?: number;
  description?: string;
  stripePaymentIntentId?: string;
  actorType?: ActorType;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: params.actorType ?? 'user',
    actorId: params.accountId,
    action: `credit.${params.type}`,
    resourceType: 'credit',
    resourceId: params.accountId,
    details: {
      amount: params.amount,
      balance: params.balance,
      description: params.description,
      stripePaymentIntentId: params.stripePaymentIntentId,
      ...params.details,
    },
    correlationId: params.correlationId,
  });
}

/**
 * Log an account tier change.
 */
export async function logTierChange(params: {
  accountId: string;
  previousTier: string;
  newTier: string;
  changedBy: ActorType;
  changedById?: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: params.changedBy,
    actorId: params.changedById,
    action: 'account.tier_changed',
    resourceType: 'account',
    resourceId: params.accountId,
    details: {
      previousTier: params.previousTier,
      newTier: params.newTier,
      ...params.details,
    },
    correlationId: params.correlationId,
  });
}

/**
 * Log an admin action.
 */
export async function logAdminAction(params: {
  adminId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: 'admin',
    actorId: params.adminId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    details: params.details,
    ipAddress: params.ipAddress,
    correlationId: params.correlationId,
  });
}

/**
 * Log a rate limit hit.
 */
export async function logRateLimitHit(params: {
  accountId?: string;
  ipAddress?: string;
  route: string;
  limit: number;
  windowMs: number;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  await safeLog({
    actorType: 'user',
    actorId: params.accountId,
    action: 'rate_limit.hit',
    resourceType: 'system',
    resourceId: 'rate_limit',
    details: {
      route: params.route,
      limit: params.limit,
      windowMs: params.windowMs,
      ip: params.ipAddress,
      ...params.details,
    },
    ipAddress: params.ipAddress,
    correlationId: params.correlationId,
  });
}
