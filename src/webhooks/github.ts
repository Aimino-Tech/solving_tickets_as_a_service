/**
 * GitHub webhook event handlers.
 *
 * Receives webhook events from GitHub and routes them to the appropriate
 * handlers. Primary handler is issues.labeled with the "stas:fix" label.
 * Also handles marketplace_purchase for billing plan changes.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ issues.labeled handler catches enqueue failures with context
 * ✅ issues.edited handler catches enqueue failures with context
 * ✅ marketplace_purchase handler catches errors with context
 * ✅ Missing installation ID logged and handled gracefully
 * ✅ All handlers log event name and delivery context
 * ────────────────────────────────────────────────────────────────────
 */

import { type EmitterWebhookEventName, Webhooks } from '@octokit/webhooks';

import { config } from '../config.js';
import { enqueueIssue } from '../queue/issueQueue.js';
import { rootLogger } from '../utils/logger.js';
import type { BillingPlan, IssueJobData } from '../utils/types.js';
import { rateLimiter } from '../ratelimit/limiter.js';
import { getRateLimitForAccount } from '../ratelimit/tiers.js';
import { getTierForAccount } from '../ratelimit/tiers.js';
import { accountsRepository } from '../db/repositories/index.js';

const log = rootLogger.child({ module: 'webhooks-github' });

/**
 * Create the GitHub webhooks handler with all event listeners registered.
 */
export function createGithubWebhooks(): Webhooks {
  const webhooks = new Webhooks({
    secret: config.github.webhookSecret,
  });

  // ── issues.opened ───────────────────────────────────────────────
  webhooks.on('issues.opened', async ({ payload }) => {
    log.info(
      {
        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
        issueNumber: payload.issue.number,
      },
      'Received issues.opened event',
    );
    // We wait for the label event instead of acting on open
  });

  // ── issues.labeled ──────────────────────────────────────────────
  webhooks.on('issues.labeled', async ({ payload }) => {
    const label = payload.label?.name;
    if (label !== config.stas.label) {
      log.debug({ label, expected: config.stas.label }, 'Ignoring non-target label');
      return;
    }

    log.info(
      {
        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
        issueNumber: payload.issue.number,
        label,
      },
      'Received issues.labeled with target label',
    );

    const tier = getTierForAccount(payload.installation?.id ?? 0);
    const priorityMap: Record<string, number> = { enterprise: 10, pro: 20, free: 30 };
    const jobData: IssueJobData = {
      installationId: payload.installation?.id ?? 0,
      repoOwner: payload.repository.owner.login,
      repoName: payload.repository.name,
      repoPrivate: payload.repository.private,
      issueNumber: payload.issue.number,
      issueTitle: payload.issue.title,
      issueBody: payload.issue.body,
      billingPlan: tier,
      priority: priorityMap[tier] ?? 30,
    };

    if (!jobData.installationId) {
      log.error(
        { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
        'No installation ID in payload — cannot process',
      );
      return;
    }

    // Save a 'pending' RunRecord before enqueueing, so every labeled issue
    // is recorded. The worker will update the record to 'running' / 'completed' / 'failed'.
    try {
      const { createStorage } = await import('../storage/index.js');
      const storage = await createStorage();
      await (storage as any).saveRun({
        installationId: jobData.installationId,
        repoOwner: jobData.repoOwner,
        repoName: jobData.repoName,
        issueNumber: jobData.issueNumber,
        status: 'pending',
      });
    } catch (storageErr) {
      log.warn({ err: String(storageErr) }, 'Failed to save pending RunRecord');
    }

    // ── Rate limit check ─────────────────────────────────────────
    const repo = `${jobData.repoOwner}/${jobData.repoName}`;
    const accountLimits = getRateLimitForAccount(jobData.installationId);
    const accountLimitResult = await rateLimiter.checkLimit('account', String(jobData.installationId));
    const repoLimitResult = await rateLimiter.checkLimit('repo', repo);

    if (!accountLimitResult.allowed) {
      log.warn(
        { installationId: jobData.installationId, current: accountLimitResult.current, limit: accountLimitResult.limit },
        'Account rate limit exceeded — not enqueuing',
      );
      return;
    }

    if (!repoLimitResult.allowed) {
      log.warn(
        { repo, current: repoLimitResult.current, limit: repoLimitResult.limit },
        'Repo rate limit exceeded — not enqueuing',
      );
      return;
    }

    // Record the rate limit hit
    await rateLimiter.increment('account', String(jobData.installationId));
    await rateLimiter.increment('repo', repo);
    try {
      await enqueueIssue(undefined, jobData);
    } catch (err) {
      log.error(
        {
          err: String(err),
          repo: `${jobData.repoOwner}/${jobData.repoName}`,
          issueNumber: jobData.issueNumber,
        },
        'Failed to enqueue labeled issue',
      );
    }
  });

  // ── issues.edited ────────────────────────────────────────────────
  webhooks.on('issues.edited', async ({ payload }) => {
    // If the issue already has the label and was edited, we could re-process
    const labels = payload.issue.labels ?? [];
    const hasStasLabel = labels.some(
      (l: { name?: string } | string) => (typeof l === 'string' ? l : l.name) === config.stas.label,
    );

    if (hasStasLabel) {
      log.info(
        {
          repo: `${payload.repository.owner.login}/${payload.repository.name}`,
          issueNumber: payload.issue.number,
        },
        'Target issue edited — re-enqueuing',
      );

      const tier = getTierForAccount(payload.installation?.id ?? 0);
      const priorityMap: Record<string, number> = { enterprise: 10, pro: 20, free: 30 };
      const jobData: IssueJobData = {
        installationId: payload.installation?.id ?? 0,
        repoOwner: payload.repository.owner.login,
        repoName: payload.repository.name,
        repoPrivate: payload.repository.private,
        issueNumber: payload.issue.number,
        issueTitle: payload.issue.title,
        issueBody: payload.issue.body,
        billingPlan: tier,
        priority: priorityMap[tier] ?? 30,
      };

      if (jobData.installationId) {
        // ── Rate limit check ─────────────────────────────────────
        const repo = `${jobData.repoOwner}/${jobData.repoName}`;
        const accountLimits = getRateLimitForAccount(jobData.installationId);
        const accountLimitResult = await rateLimiter.checkLimit('account', String(jobData.installationId));
        const repoLimitResult = await rateLimiter.checkLimit('repo', repo);

        if (!accountLimitResult.allowed) {
          log.warn(
            { installationId: jobData.installationId, current: accountLimitResult.current, limit: accountLimitResult.limit },
            'Account rate limit exceeded — not enqueuing edited issue',
          );
          return;
        }

        if (!repoLimitResult.allowed) {
          log.warn(
            { repo, current: repoLimitResult.current, limit: repoLimitResult.limit },
            'Repo rate limit exceeded — not enqueuing edited issue',
          );
          return;
        }

        // Record the rate limit hit
        await rateLimiter.increment('account', String(jobData.installationId));
        await rateLimiter.increment('repo', repo);

        try {
          await enqueueIssue(undefined, jobData);
        } catch (err) {
          log.error(
            {
              err: String(err),
              repo: `${jobData.repoOwner}/${jobData.repoName}`,
              issueNumber: jobData.issueNumber,
            },
            'Failed to enqueue edited issue',
          );
        }
      } else {
        log.warn(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'No installation ID in edited issue payload — skipped',
        );
      }
    }
  });

  // ── marketplace_purchase ─────────────────────────────────────────
  webhooks.on('marketplace_purchase' as EmitterWebhookEventName, async ({ payload }) => {
    try {
      const p = payload as unknown as {
        action: string;
        effective_date: string;
        marketplace_purchase: {
          account: { id: number; type: string };
          plan: { name: string };
        };
      };

      const plan: BillingPlan = {
        plan: mapMarketplacePlan(p.marketplace_purchase.plan.name),
        accountId: p.marketplace_purchase.account.id,
        effectiveAt: p.effective_date,
      };

      log.info(
        {
          action: p.action,
          accountId: plan.accountId,
          plan: plan.plan,
        },
        'Marketplace purchase event',
      );

      // Update the billing plan in the database
      if (p.action === 'purchased' || p.action === 'changed') {
        try {
          // Look up the account by GitHub installation ID
          const account = await accountsRepository.findByInstallationId(plan.accountId);
          if (account) {
            await accountsRepository.update(account.id, { tier: plan.plan });
            log.info({ accountId: account.id, tier: plan.plan }, 'Billing plan updated');
          } else {
            log.warn({ installationId: plan.accountId }, 'No account found for marketplace purchase');
          }
        } catch (dbErr) {
          log.error({ err: String(dbErr), installationId: plan.accountId }, 'Failed to update billing plan');
        }
      }
    } catch (err) {
      log.error(
        { err: String(err), payload: JSON.stringify(payload).slice(0, 500) },
        'Failed to handle marketplace purchase event',
      );
    }
  });

  return webhooks;
}

/**
 * Map GitHub Marketplace plan names to internal plan types.
 */
function mapMarketplacePlan(planName: string): BillingPlan['plan'] {
  const lower = planName.toLowerCase();
  if (lower.includes('enterprise')) return 'enterprise';
  if (lower.includes('pro') || lower.includes('premium')) return 'pro';
  return 'free';
}

/**
 * Suggest labels based on issue content using keyword matching.
 * Useful for recommending labels before the full triage runs.
 */
export function suggestLabels(title: string, body: string): string[] {
  const text = `${title}\n${body}`.toLowerCase();
  const labels: string[] = [];

  // Bug indicators
  const bugPatterns = [
    'bug',
    'fix',
    'error',
    'crash',
    'broken',
    'fails',
    'failure',
    'incorrect',
    'wrong',
    'issue',
    'problem',
    'bug report',
  ];
  if (bugPatterns.some((p) => text.includes(p))) {
    labels.push('bug');
  }

  // Feature indicators
  const featurePatterns = [
    'feature',
    'request',
    'would like',
    'please add',
    'suggestion',
    'idea',
    'enhancement',
    'new feature',
  ];
  if (featurePatterns.some((p) => text.includes(p))) {
    labels.push('enhancement');
  }

  // Question indicators
  const questionPatterns = ['how to', 'how do i', 'question', 'help', 'not sure', 'what is', 'how can', 'guide'];
  if (questionPatterns.some((p) => text.includes(p))) {
    labels.push('question');
  }

  // Documentation indicators
  const docsPatterns = ['docs', 'documentation', 'readme', 'typo', 'spelling', 'readability'];
  if (docsPatterns.some((p) => text.includes(p))) {
    labels.push('documentation');
  }

  // Performance
  const perfPatterns = ['slow', 'performance', 'latency', 'memory', 'leak', 'optimize', 'bottleneck'];
  if (perfPatterns.some((p) => text.includes(p))) {
    labels.push('performance');
  }

  return labels;
}
