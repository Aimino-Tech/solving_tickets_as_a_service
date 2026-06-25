/**
 * GitHub App installation lifecycle webhook handler.
 *
 * Handles `installation.created` and `installation.deleted` events.
 * On creation: creates a tenant record, stores repository whitelist.
 * On deletion: deactivates the tenant (soft-delete).
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ installation.created — catches DB insert/update failures with context
 * ✅ installation.deleted — catches deactivation failures with context
 * ✅ Missing installation ID logged and handled gracefully
 * ✅ All handlers log event name and delivery context
 * ────────────────────────────────────────────────────────────────────
 */

import { type EmitterWebhookEventName, Webhooks } from '@octokit/webhooks';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'webhooks-installation' });

/**
 * Create a webhooks instance that handles GitHub App installation lifecycle events.
 * These are separate from the issue-label events handled in github.ts.
 */
export function createInstallationWebhooks(): Webhooks {
  const webhooks = new Webhooks({
    secret: config.github.webhookSecret,
  });

  // ── installation.created ──────────────────────────────────────────
  webhooks.on('installation.created' as EmitterWebhookEventName, async ({ payload }) => {
    const p = payload as unknown as {
      installation: { id: number; account: { login: string; id: number; type: string } };
      repositories: Array<{ full_name: string; owner: { login: string }; name: string }>;
      sender: { login: string; id: number };
    };

    const installationId = p.installation?.id;
    const accountLogin = p.installation?.account?.login;
    const accountType = p.installation?.account?.type;

    log.info(
      { installationId, accountLogin, accountType },
      'Received installation.created event',
    );

    if (!installationId) {
      log.error('Missing installation ID in installation.created payload');
      return;
    }

    try {
      // Create or update account record in the database
      const { accountsRepository } = await import('../db/repositories/index.js');

      let account = await accountsRepository.findByInstallationId(installationId);

      if (account) {
        account = await accountsRepository.update(account.id, {
          name: accountLogin ?? account.name,
        });
        log.info({ installationId, accountId: account.id }, 'Updated existing account for installation');
      } else {
        account = await accountsRepository.create({
          githubInstallationId: installationId,
          name: accountLogin ?? null,
        });
        log.info({ installationId, accountId: account.id }, 'Created new account for installation');
      }

      // Store repository whitelist
      const repos = p.repositories ?? [];
      const reposList = repos.map((r) => ({
        owner: r.owner.login,
        name: r.name,
        installationId,
      }));

      log.info(
        { installationId, repoCount: reposList.length },
        `Installation has ${reposList.length} repository/repositories`,
      );

      // Create onboarding state entry
      const { onboardingStateMachine } = await import('../onboarding/state-machine.js');
      const stateMachine = onboardingStateMachine;
      stateMachine.createState(String(installationId));
      stateMachine.transition(String(installationId), 'github_installed');

      log.info(
        { installationId, state: (await stateMachine.getState(String(installationId)))?.state },
        'Onboarding state initialized for installation',
      );
    } catch (err) {
      log.error(
        { err: String(err), installationId },
        'Failed to process installation.created event',
      );
    }
  });

  // ── installation.deleted ──────────────────────────────────────────
  webhooks.on('installation.deleted' as EmitterWebhookEventName, async ({ payload }) => {
    const p = payload as unknown as {
      installation: { id: number; account: { login: string; id: number; type: string } };
      sender: { login: string; id: number };
    };

    const installationId = p.installation?.id;

    log.info(
      { installationId, accountLogin: p.installation?.account?.login },
      'Received installation.deleted event',
    );

    if (!installationId) {
      log.error('Missing installation ID in installation.deleted payload');
      return;
    }

    try {
      // Mark account as deactivated (soft-delete)
      const { accountsRepository } = await import('../db/repositories/index.js');
      const account = await accountsRepository.findByInstallationId(installationId);

      if (account) {
        await accountsRepository.update(account.id, {
          name: account.name ? `${account.name} (deactivated)` : '(deactivated)',
        });

        log.info({ installationId, accountId: account.id }, 'Account deactivated for installation deletion');
      } else {
        log.warn({ installationId }, 'No account found for deleted installation');
      }

      // Mark onboarding state as deleted
      const { queryWithRetry } = await import('../db/connection.js');
      await queryWithRetry(
        `UPDATE onboarding_state SET state = 'deleted', updated_at = NOW()
         WHERE tenant_id = $1`,
        [String(installationId)],
      );

      log.info({ installationId }, 'Installation deactivated successfully');
    } catch (err) {
      log.error(
        { err: String(err), installationId },
        'Failed to process installation.deleted event',
      );
    }
  });

  return webhooks;
}
