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
import { rootLogger } from '../utils/logger.js';
import type { BillingPlan, IssueJobData } from '../utils/types.js';
import { rateLimiter } from '../ratelimit/limiter.js';
import { getRateLimitForAccount } from '../ratelimit/tiers.js';
import { getTierForAccount } from '../ratelimit/tiers.js';
import { accountsRepository } from '../db/repositories/index.js';

const log = rootLogger.child({ module: 'webhooks-github' });

type EnqueueHandler = (data: IssueJobData) => Promise<string | undefined>;

/**
 * Post a simple "issue received" comment in AI-disabled mode.
 * Uses the GitHub App installation token to authenticate.
 */
async function postIssueReceivedComment(
  installationId: number,
  repoOwner: string,
  repoName: string,
  issueNumber: number,
): Promise<void> {
  try {
    const { getOctokit } = await import('../github/auth.js');
    const octokit = await getOctokit(installationId);
    await octokit.issues.createComment({
      owner: repoOwner,
      repo: repoName,
      issue_number: issueNumber,
      body: `### 📥 Issue Received\n\nThis issue has been received and queued for processing.\n\n> STAS is running in **AI-disabled mode**. No automated fix will be attempted.\n> An operator needs to claim and process this issue manually.\n\nIssue ID: #${issueNumber}`,
    });
    log.info(
      { repo: `${repoOwner}/${repoName}`, issueNumber },
      'Posted "issue received" comment (AI-disabled mode)',
    );
  } catch (err) {
    log.warn(
      { err: String(err), repo: `${repoOwner}/${repoName}`, issueNumber },
      'Failed to post "issue received" comment',
    );
  }
}

/**
 * Create the GitHub webhooks handler with all event listeners registered.
 */
export function createGithubWebhooks(enqueue: EnqueueHandler): Webhooks {
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

    const installationId = payload.installation?.id ?? 0;
    const tier = getTierForAccount(installationId);
    const priorityMap: Record<string, number> = { enterprise: 10, team: 15, pro: 20, free: 30 };
    const issueLabels: string[] = (payload.issue.labels ?? [])
      .map((l: { name?: string } | string) => (typeof l === 'string' ? l : l.name))
      .filter(Boolean) as string[];
    const jobData: IssueJobData = {
      installationId,
      repoOwner: payload.repository.owner.login,
      repoName: payload.repository.name,
      repoPrivate: payload.repository.private,
      issueNumber: payload.issue.number,
      issueTitle: payload.issue.title,
      issueBody: payload.issue.body,
      labels: issueLabels,
      billingPlan: tier as 'free' | 'pro' | 'enterprise' | undefined,
      priority: priorityMap[tier] ?? 30,
    };

    if (!jobData.installationId) {
      if (config.github.token) {
        log.warn(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'No installation ID — falling back to GITHUB_TOKEN',
        );
      } else {
        log.error(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'No installation ID and no GITHUB_TOKEN — cannot process',
        );
        return;
      }
    }

    // ── AI-Disabled Mode ────────────────────────────────────────
    // When STAS_AI_DISABLED=true, the issue is stored as pending without
    // dispatching to OpenCode. An operator must claim and complete it manually.
    if (config.stas.aiDisabled) {
      log.info(
        {
          repo: `${jobData.repoOwner}/${jobData.repoName}`,
          issueNumber: jobData.issueNumber,
        },
        'AI-disabled mode — storing issue as pending without dispatch',
      );

      // Save a pending RunRecord
      try {
        const { createStorage } = await import('../storage/index.js');
        const storage = await createStorage();
        if (storage) {
          await storage.saveRun({
            installationId: jobData.installationId,
            repoOwner: jobData.repoOwner,
            repoName: jobData.repoName,
            issueNumber: jobData.issueNumber,
            status: 'pending',
          });
        }
      } catch (storageErr) {
        log.warn({ err: String(storageErr) }, 'Failed to save pending RunRecord');
      }

      // Post "issue received" comment
      await postIssueReceivedComment(
        installationId || 0,
        jobData.repoOwner,
        jobData.repoName,
        jobData.issueNumber,
      );

      return; // Do not enqueue — skip OpenCode dispatch
    }

    // ── Normal Mode: Save pending record, check rate limits, enqueue ──

    // Save a 'pending' RunRecord before enqueueing, so every labeled issue
    // is recorded. The worker will update the record to 'running' / 'completed' / 'failed'.
    try {
      const { createStorage } = await import('../storage/index.js');
      const storage = await createStorage();
      if (!storage) {
        log.warn('Storage not available - cannot save pending RunRecord');
        return;
      }
      await storage.saveRun({
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
      await enqueue(jobData);
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

      const installationId = payload.installation?.id ?? 0;
      const tier = getTierForAccount(installationId);
      const priorityMap: Record<string, number> = { enterprise: 10, team: 15, pro: 20, free: 30 };
      const editIssueLabels: string[] = (payload.issue.labels ?? [])
        .map((l: { name?: string } | string) => (typeof l === 'string' ? l : l.name))
        .filter(Boolean) as string[];
      const jobData: IssueJobData = {
        installationId,
        repoOwner: payload.repository.owner.login,
        repoName: payload.repository.name,
        repoPrivate: payload.repository.private,
        issueNumber: payload.issue.number,
        issueTitle: payload.issue.title,
        issueBody: payload.issue.body,
        labels: editIssueLabels,
        billingPlan: tier as 'free' | 'pro' | 'enterprise' | undefined,
        priority: priorityMap[tier] ?? 30,
      };

      // ── AI-Disabled Mode (also for edits) ─────────────────────
      if (config.stas.aiDisabled) {
        log.info(
          {
            repo: `${jobData.repoOwner}/${jobData.repoName}`,
            issueNumber: jobData.issueNumber,
          },
          'AI-disabled mode — edit received, storing as pending',
        );
        try {
          const { createStorage } = await import('../storage/index.js');
          const storage = await createStorage();
          if (storage) {
            await storage.saveRun({
              installationId: jobData.installationId,
              repoOwner: jobData.repoOwner,
              repoName: jobData.repoName,
              issueNumber: jobData.issueNumber,
              status: 'pending',
            });
          }
        } catch (storageErr) {
          log.warn({ err: String(storageErr) }, 'Failed to save pending RunRecord on edit');
        }
        return;
      }

      if (!jobData.installationId && !config.github.token) {
        log.warn(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'No installation ID and no GITHUB_TOKEN — cannot process edited issue',
        );
        return;
      }

      if (!jobData.installationId) {
        log.warn(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'No installation ID — falling back to GITHUB_TOKEN for edited issue',
        );
      }

      // ── Rate limit check (skip when using PAT fallback) ────────
      if (jobData.installationId) {
        const repo = `${jobData.repoOwner}/${jobData.repoName}`;
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
      }

      try {
        await enqueue(jobData);
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
  if (lower.includes('team')) return 'team';
  if (lower.includes('pro') || lower.includes('premium')) return 'pro';
  return 'free';
}

/**
 * Suggest labels based on issue content using keyword matching.
 * Useful for recommending labels before the full triage runs.
 * Can be called with a single text string or (title, body).
 */
export function suggestLabels(titleOrText: string, body?: string): string[] {
  const text = body ? `${titleOrText}\n${body}`.toLowerCase() : titleOrText.toLowerCase();
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
    'support for',
    'implement',
    'add ',
    'like to',
    'need ',
    'want ',
    'propose',
  ];
  if (featurePatterns.some((p) => text.includes(p))) {
    labels.push('enhancement');
  }

  // Question indicators
  const questionPatterns = ['how to', 'how do i', 'question', 'help', 'not sure', 'what is', 'how can', 'guide', 'is there', 'can i', 'what are', 'does this', 'where', 'why does', 'explain'];
  if (questionPatterns.some((p) => text.includes(p))) {
    labels.push('question');
  }

  // Documentation indicators
  const docsPatterns = ['docs', 'documentation', 'readme', 'typo', 'spelling', 'readability'];
  if (docsPatterns.some((p) => text.includes(p))) {
    labels.push('documentation');
  }

  // Security indicators
  const securityPatterns = ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'exploit', 'auth bypass', 'authentication bypass', 'authorization'];
  if (securityPatterns.some((p) => text.includes(p))) {
    labels.push('security');
  }

  // Performance indicators
  const perfPatterns = ['slow', 'performance', 'latency', 'memory', 'leak', 'optimize', 'bottleneck', 'cpu', 'response time', 'throughput', 'degradation'];
  if (perfPatterns.some((p) => text.includes(p))) {
    labels.push('performance');
  }

  return labels;
}
