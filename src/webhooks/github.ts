/**
 * GitHub webhook event handlers.
 *
 * Receives webhook events from GitHub and routes them to the appropriate
 * handlers. Primary handler is issues.labeled with the "stas:fix" label.
 * Also handles marketplace_purchase for billing plan changes,
 * pull_request.closed for the "STAS fixed this" badge, and
 * issue_comment.created for the approval slash commands (/stas approve, /stas reject).
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ issues.labeled handler catches enqueue failures with context
 * ✅ issues.edited handler catches enqueue failures with context
 * ✅ marketplace_purchase handler catches errors with context
 * ✅ pull_request.closed handler catches lookups and comment failures with context
 * ✅ issue_comment.created handler catches parse/approve/reject failures with context
 * ✅ Missing installation ID logged and handled gracefully
 * ✅ All handlers log event name and delivery context
 * ────────────────────────────────────────────────────────────────────
 */

import { type EmitterWebhookEventName, Webhooks } from '@octokit/webhooks';

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { captureEvent } from '../analytics/tracker.js';
import type { BillingPlan, IssueJobData } from '../utils/types.js';
import { rateLimiter } from '../ratelimit/limiter.js';
import { getRateLimitForAccount } from '../ratelimit/tiers.js';
import { getTierForAccount } from '../ratelimit/tiers.js';
import { accountsRepository } from '../db/repositories/index.js';
import { dispatchIssueToOsy } from '../services/osyDispatch.js';
import { dispatchThroughGovernance } from '../governance/client.js';
import { parseSlashCommand } from '../github/slashCommands.js';
import { recordGovernanceFailure } from '../bridge/metrics.js';

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
 * Post a comment when governance proxy is unavailable.
 * Fail-closed: the issue is not processed when governance is down.
 */
async function postGovernanceFailureComment(
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
      body: `### ⚠️ Governance Proxy Unavailable\n\nSTAS was unable to verify this issue through the governance proxy. Processing has been **blocked** to maintain security policy compliance.\n\n> The issue will not be processed until the governance service is restored. An administrator should investigate the governance proxy status.\n\nIssue ID: #${issueNumber}`,
    });
    log.info(
      { repo: `${repoOwner}/${repoName}`, issueNumber },
      'Posted governance failure comment',
    );
  } catch (err) {
    log.warn(
      { err: String(err), repo: `${repoOwner}/${repoName}`, issueNumber },
      'Failed to post governance failure comment',
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

  // ── installation.created ────────────────────────────────────────
  webhooks.on('installation.created' as EmitterWebhookEventName, async ({ payload }) => {
    try {
      const p = payload as unknown as {
        installation: { id: number; account?: { login?: string; type?: string } };
        repositories?: Array<{ name: string; owner?: { login: string } }>;
        sender?: { id: number; login?: string };
      };

      const installationId = p.installation?.id;
      if (!installationId) {
        log.warn('Installation created event without installation ID');
        return;
      }

      log.info(
        {
          installationId,
          accountLogin: p.installation?.account?.login,
          accountType: p.installation?.account?.type,
          reposCount: p.repositories?.length ?? 0,
          sender: p.sender?.login,
        },
        'GitHub App installation created — recording in onboarding state',
      );

      // We log the installation event; the frontend handles mapping to the
      // correct user/tenant via the manual confirmation button. The installation
      // data is persisted here for audit and future cross-referencing.
      try {
        const { auditRepository } = await import('../audit/repository.js');
        await auditRepository.insert({
          actorType: 'system',
          actorId: undefined,
          action: 'onboarding.github.installation_received',
          resourceType: 'onboarding',
          resourceId: undefined,
          details: {
            installationId,
            accountLogin: p.installation?.account?.login,
            accountType: p.installation?.account?.type,
            reposGranted: p.repositories?.length ?? 0,
          },
          correlationId: undefined,
        });
      } catch (auditErr) {
        log.error({ err: String(auditErr) }, 'Failed to audit log installation event');
      }

      // Track app installation in PostHog
      try {
        captureEvent('app_installed', String(installationId), {
          accountLogin: p.installation?.account?.login,
          accountType: p.installation?.account?.type,
          reposCount: p.repositories?.length ?? 0,
        });
      } catch (analyticsErr) {
        log.error({ err: String(analyticsErr) }, 'Failed to track app_installed event');
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to handle installation.created event');
    }
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

    // ── Normal Mode: Save pending record, check rate limits, dispatch ──

    // Save a 'pending' RunRecord before dispatching, so every labeled issue
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
        'Account rate limit exceeded — not dispatching',
      );
      return;
    }

    if (!repoLimitResult.allowed) {
      log.warn(
        { repo, current: repoLimitResult.current, limit: repoLimitResult.limit },
        'Repo rate limit exceeded — not dispatching',
      );
      return;
    }

    // Record the rate limit hit
    await rateLimiter.increment('account', String(jobData.installationId));
    await rateLimiter.increment('repo', repo);

    // Track issue_labeled event in PostHog
    try {
      captureEvent('issue_labeled', String(jobData.installationId), {
        repoOwner: jobData.repoOwner,
        repoName: jobData.repoName,
        issueNumber: jobData.issueNumber,
        label,
        tier,
      });
    } catch (analyticsErr) {
      log.error({ err: String(analyticsErr) }, 'Failed to track issue_labeled event');
    }

    // ── Route through Governance Proxy → OpenSymphony or local queue ─
    if (config.proxy.dispatchUrl) {
      log.info(
        { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
        'Dispatching through governance proxy',
      );
      const govResult = await dispatchThroughGovernance({
        installationId: jobData.installationId,
        repoOwner: jobData.repoOwner,
        repoName: jobData.repoName,
        issueNumber: jobData.issueNumber,
        issueTitle: jobData.issueTitle ?? '',
        issueBody: jobData.issueBody,
        labels: jobData.labels ?? [],
      });
      if (!govResult.success) {
        log.error(
          { err: govResult.error, repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'Governance proxy dispatch failed — blocking issue (fail-closed)',
        );
        recordGovernanceFailure(repo, govResult.error ?? 'unknown');
        await postGovernanceFailureComment(
          installationId || 0,
          jobData.repoOwner,
          jobData.repoName,
          jobData.issueNumber,
        );
      }
    } else if (config.osy?.dispatchUrl) {
      log.info(
        { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
        'Dispatching to OpenSymphony via OS dispatch API (no governance proxy)',
      );
      const osyResult = await dispatchIssueToOsy({
        installationId: jobData.installationId,
        repoOwner: jobData.repoOwner,
        repoName: jobData.repoName,
        issueNumber: jobData.issueNumber,
        issueTitle: jobData.issueTitle ?? '',
        issueBody: jobData.issueBody,
        labels: jobData.labels ?? [],
      });
      if (!osyResult.success) {
        log.error(
          { err: osyResult.error, repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'OS dispatch failed — OpenSymphony unavailable',
        );
        recordGovernanceFailure(repo, osyResult.error ?? 'unknown');
        await postGovernanceFailureComment(
          installationId || 0,
          jobData.repoOwner,
          jobData.repoName,
          jobData.issueNumber,
        );
      }
    } else {
      log.info(
        { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
        'No dispatch URL configured — using local queue',
      );
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

      if (config.proxy.dispatchUrl) {
        log.info(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'Dispatching edited issue through governance proxy',
        );
        const govResult = await dispatchThroughGovernance({
          installationId: jobData.installationId,
          repoOwner: jobData.repoOwner,
          repoName: jobData.repoName,
          issueNumber: jobData.issueNumber,
          issueTitle: jobData.issueTitle ?? '',
          issueBody: jobData.issueBody,
          labels: jobData.labels ?? [],
        });
        if (!govResult.success) {
          log.error(
            { err: govResult.error, repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
            'Governance proxy dispatch failed for edited issue — blocking (fail-closed)',
          );
          recordGovernanceFailure(`${jobData.repoOwner}/${jobData.repoName}`, govResult.error ?? 'unknown');
          await postGovernanceFailureComment(
            installationId || 0,
            jobData.repoOwner,
            jobData.repoName,
            jobData.issueNumber,
          );
        }
      } else if (config.osy?.dispatchUrl) {
        log.info(
          { repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
          'Dispatching edited issue to OpenSymphony (no governance proxy)',
        );
        const osyResult = await dispatchIssueToOsy({
          installationId: jobData.installationId,
          repoOwner: jobData.repoOwner,
          repoName: jobData.repoName,
          issueNumber: jobData.issueNumber,
          issueTitle: jobData.issueTitle ?? '',
          issueBody: jobData.issueBody,
          labels: jobData.labels ?? [],
        });
        if (!osyResult.success) {
          log.error(
            { err: osyResult.error, repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
            'OS dispatch failed for edited issue — OpenSymphony unavailable',
          );
          recordGovernanceFailure(`${jobData.repoOwner}/${jobData.repoName}`, osyResult.error ?? 'unknown');
          await postGovernanceFailureComment(
            installationId || 0,
            jobData.repoOwner,
            jobData.repoName,
            jobData.issueNumber,
          );
        }
      } else {
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

  // ── pull_request.closed ──────────────────────────────────────────
  // When a PR that STAS created gets merged, post a "STAS fixed this" badge comment.
  webhooks.on('pull_request.closed' as EmitterWebhookEventName, async ({ payload }) => {
    try {
      const p = payload as unknown as {
        action: string;
        pull_request: {
          merged: boolean;
          html_url: string;
          number: number;
        };
        repository: {
          owner: { login: string };
          name: string;
        };
        installation?: { id: number };
      };

      // Only act on merged PRs
      if (p.action !== 'closed' || !p.pull_request.merged) {
        return;
      }

      const prUrl = p.pull_request.html_url;
      const repoOwner = p.repository.owner.login;
      const repoName = p.repository.name;
      const prNumber = p.pull_request.number;
      const installationId = p.installation?.id ?? 0;

      log.info(
        {
          repo: `${repoOwner}/${repoName}`,
          prNumber,
          prUrl,
        },
        'PR merged — checking if this was a STAS-created PR',
      );

      // Look up the STAS run by PR URL in the database
      const { queryWithRetry } = await import('../db/connection.js');
      const result = await queryWithRetry<{
        id: number;
        installation_id: number;
        repo_owner: string;
        repo_name: string;
        issue_number: number;
      }>(
        `SELECT id, installation_id, repo_owner, repo_name, issue_number
         FROM run_history
         WHERE pr_url = $1
         LIMIT 1`,
        [prUrl],
      );

      const run = result.rows[0];
      if (!run) {
        log.info(
          { prUrl },
          'No STAS run found for this PR — not posting badge',
        );
        return;
      }

      log.info(
        {
          runId: run.id,
          issueNumber: run.issue_number,
          repo: `${repoOwner}/${repoName}`,
        },
        'Found STAS run for merged PR — posting badge comment',
      );

      // Post the "STAS fixed this" badge comment
      const { getOctokit } = await import('../github/auth.js');
      const octokit = await getOctokit(installationId || run.installation_id);
      await octokit.issues.createComment({
        owner: repoOwner,
        repo: repoName,
        issue_number: run.issue_number,
        body: [
          '![STAS Fixed This](https://stas.aimino.io/badge/stas-fixed-this.svg)',
          '',
          '🤖 This PR was fixed by **STAS** — automated bug fixing for your GitHub issues.',
          '',
          '[Add STAS to your repo](https://github.com/apps/stas-app/installations/new?utm_source=github&utm_medium=pr-badge&utm_campaign=aim-4215) | [View Dashboard](https://stas.aimino.io/dashboard)',
        ].join('\n'),
      });

      log.info(
        {
          runId: run.id,
          issueNumber: run.issue_number,
          repo: `${repoOwner}/${repoName}`,
        },
        'Badge comment posted on merged PR issue',
      );
    } catch (err) {
      log.error(
        { err: String(err) },
        'Failed to handle pull_request.closed event',
      );
    }
  });

  // ── issue_comment.created ───────────────────────────────────────
  // Parse slash commands (/stas approve, /stas reject) and wire to approval gate.
  webhooks.on('issue_comment.created' as EmitterWebhookEventName, async ({ payload }) => {
    try {
      const p = payload as unknown as {
        action: string;
        comment: {
          body: string;
          user: { login: string };
        };
        issue: { number: number };
        repository: {
          owner: { login: string };
          name: string;
        };
        installation?: { id: number };
      };

      const commentBody = p.comment.body;
      const parsed = parseSlashCommand(commentBody);
      if (!parsed) {
        return; // Not a slash command we handle
      }

      const repoOwner = p.repository.owner.login;
      const repoName = p.repository.name;
      const issueNumber = p.issue.number;
      const commentUser = p.comment.user.login;

      log.info(
        {
          repo: `${repoOwner}/${repoName}`,
          issueNumber,
          command: parsed.command,
          args: parsed.args,
          user: commentUser,
        },
        'Slash command received',
      );

      if (parsed.command === 'stas:approve') {
        // Find pending approvals for this issue
        const { getPendingApprovals, approveApproval } = await import('../middleware/approvalGate.js');
        const pending = getPendingApprovals();
        const match = pending.find(
          (a) =>
            a.repoOwner === repoOwner &&
            a.repoName === repoName &&
            a.issueNumber === issueNumber &&
            a.status === 'pending',
        );

        if (!match) {
          log.warn(
            { repo: `${repoOwner}/${repoName}`, issueNumber },
            'No pending approval found for approve command',
          );
          // Post a reply indicating no pending approval
          const { getOctokit } = await import('../github/auth.js');
          const installationId = p.installation?.id ?? 0;
          const octokit = await getOctokit(installationId);
          await octokit.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: issueNumber,
            body: `⚠️ No pending approval found for this issue. The approval may have already been processed or this issue was not flagged for approval.`,
          });
          return;
        }

        const approved = approveApproval({
          id: match.id,
          approvedBy: commentUser,
        });

        if (approved) {
          log.info(
            { approvalId: match.id, user: commentUser },
            'Approval granted via slash command',
          );
        }
      } else if (parsed.command === 'stas:reject') {
        const { getPendingApprovals, rejectApproval } = await import('../middleware/approvalGate.js');
        const pending = getPendingApprovals();
        const match = pending.find(
          (a) =>
            a.repoOwner === repoOwner &&
            a.repoName === repoName &&
            a.issueNumber === issueNumber &&
            a.status === 'pending',
        );

        if (!match) {
          log.warn(
            { repo: `${repoOwner}/${repoName}`, issueNumber },
            'No pending approval found for reject command',
          );
          const { getOctokit } = await import('../github/auth.js');
          const installationId = p.installation?.id ?? 0;
          const octokit = await getOctokit(installationId);
          await octokit.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: issueNumber,
            body: `⚠️ No pending approval found for this issue.`,
          });
          return;
        }

        const reason = parsed.args.join(' ') || undefined;
        const rejected = rejectApproval({
          id: match.id,
          rejectedBy: commentUser,
          reason,
        });

        if (rejected) {
          log.info(
            { approvalId: match.id, user: commentUser, reason },
            'Rejection recorded via slash command',
          );
        }
      } else {
        log.debug({ command: parsed.command }, 'Unknown slash command — ignoring');
      }
    } catch (err) {
      log.error(
        { err: String(err) },
        'Failed to handle issue_comment.created event',
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
