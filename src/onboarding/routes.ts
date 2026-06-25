/**
 * Onboarding setup wizard API routes.
 *
 * Provides endpoints for the self-service onboarding flow:
 *   GET  /api/onboarding/status         — returns current onboarding state
 *   POST /api/onboarding/step/github    — acknowledges GitHub install
 *   POST /api/onboarding/step/linear    — stores Linear token
 *   POST /api/onboarding/step/repos     — saves repo whitelist + label config
 *   POST /api/onboarding/step/test-run  — triggers test issue
 *   GET  /api/onboarding/checklist      — returns onboarding checklist progress
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Missing tenant ID returns 400 with clear message
 * ✅ State machine transition failures return friendly error messages
 * ✅ Test run failures return actionable error info
 * ✅ All endpoints log errors with context
 * ────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { onboardingStateMachine } from './state-machine.js';
import { onboardingRepoConfig } from './config.js';
import { triggerTestRun } from './test-run.js';
import type { OnboardingState } from './state-machine.js';

const log = rootLogger.child({ module: 'onboarding-routes' });

const router = Router();

// ---------------------------------------------------------------------------
// Helper: extract tenantId from request
// ---------------------------------------------------------------------------

function getTenantId(req: Request): string | null {
  // Check header first, then query param, then body
  return (
    (req.headers['x-tenant-id'] as string) ??
    (req.query.tenantId as string) ??
    (req.body?.tenantId as string) ??
    null
  );
}

// ---------------------------------------------------------------------------
// GET /api/onboarding/status
// Returns the current onboarding state for the tenant.
// ---------------------------------------------------------------------------

router.get('/status', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID. Provide x-tenant-id header or tenantId query parameter.' });
    return;
  }

  try {
    const state = await onboardingStateMachine.getState(tenantId);
    const checklist = await onboardingStateMachine.getChecklist(tenantId);

    if (!state) {
      res.json({
        tenantId,
        onboarded: false,
        state: 'not_started',
        currentStep: null,
        nextStep: 'github_installed',
        progressData: {},
        checklist,
      });
      return;
    }

    res.json({
      tenantId,
      onboarded: state.state === 'completed',
      state: state.state,
      currentStep: state.state,
      nextStep: onboardingStateMachine.getNextStep(state.state),
      progressData: state.progressData,
      checklist,
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to get onboarding status');
    res.status(500).json({ error: 'Failed to retrieve onboarding status. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/step/github
// Acknowledges that the GitHub App has been installed.
// ---------------------------------------------------------------------------

router.post('/step/github', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  const { installationId, accountLogin } = req.body as {
    installationId?: number;
    accountLogin?: string;
  } ?? {};

  try {
    const state = await onboardingStateMachine.createState(tenantId);
    await onboardingStateMachine.transition(tenantId, 'github_installed');

    if (installationId) {
      await onboardingStateMachine.updateProgress(tenantId, {
        installationId,
        accountLogin,
      });
    }

    res.json({
      success: true,
      state: 'github_installed',
      nextStep: 'linear_connected',
      message: 'GitHub App installation acknowledged.',
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to acknowledge GitHub install');
    res.status(500).json({ error: 'Failed to acknowledge GitHub App installation. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/step/linear
// Stores the Linear OAuth token after successful authentication.
// ---------------------------------------------------------------------------

router.post('/step/linear', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  const { organizationId } = req.body as { organizationId?: string } ?? {};

  try {
    // State machine transition
    await onboardingStateMachine.transition(tenantId, 'linear_connected');

    if (organizationId) {
      await onboardingStateMachine.updateProgress(tenantId, {
        linearOrganizationId: organizationId,
      });
    }

    res.json({
      success: true,
      state: 'linear_connected',
      nextStep: 'repos_configured',
      message: 'Linear account connected successfully.',
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to store Linear connection');
    res.status(500).json({ error: 'Failed to save Linear connection. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/step/repos
// Saves the repository whitelist and label configuration.
// ---------------------------------------------------------------------------

router.post('/step/repos', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  const { repos, labels } = req.body as {
    repos?: Array<{ owner: string; name: string; installationId: number; labels?: string[] }>;
    labels?: Record<string, string[]>;
  } ?? {};

  if (!repos || repos.length === 0) {
    res.status(400).json({ error: 'At least one repository must be selected.' });
    return;
  }

  try {
    const defaultLabel = config.onboarding?.defaultLabel ?? config.stas.label;

    // Save repos with labels
    const repoConfigs = repos.map((r) => ({
      owner: r.owner,
      name: r.name,
      installationId: r.installationId,
      labels: r.labels ?? labels?.[`${r.owner}/${r.name}`] ?? [defaultLabel],
    }));

    await onboardingRepoConfig.saveRepos(tenantId, repoConfigs);

    // Transition to repos_configured
    await onboardingStateMachine.transition(tenantId, 'repos_configured');

    // Update progress with repos and labels
    await onboardingStateMachine.updateProgress(tenantId, {
      repos: repos.map((r) => ({ owner: r.owner, name: r.name })),
      labels: labels ?? {},
    });

    res.json({
      success: true,
      state: 'repos_configured',
      nextStep: 'labels_set',
      repoCount: repoConfigs.length,
      message: `Configured ${repoConfigs.length} repositor${repoConfigs.length === 1 ? 'y' : 'ies'}.`,
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to save repo configuration');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to save repository configuration. Please try again.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/step/labels
// Updates label configuration for selected repos.
// ---------------------------------------------------------------------------

router.post('/step/labels', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  const { labels } = req.body as {
    labels?: Array<{ owner: string; name: string; labels: string[] }>;
  } ?? {};

  if (!labels || labels.length === 0) {
    res.status(400).json({ error: 'Label configuration is required.' });
    return;
  }

  try {
    // Update labels via GitHub API for each repo
    const repos = await onboardingRepoConfig.getRepos(tenantId);

    for (const labelConfig of labels) {
      const repo = repos.find(
        (r) => r.owner === labelConfig.owner && r.name === labelConfig.name,
      );

      if (repo) {
        await onboardingRepoConfig.updateLabels(
          repo.installationId,
          labelConfig.owner,
          labelConfig.name,
          labelConfig.labels,
        );
      }
    }

    // Transition to labels_set
    await onboardingStateMachine.transition(tenantId, 'labels_set');

    res.json({
      success: true,
      state: 'labels_set',
      nextStep: 'test_run',
      message: 'Labels configured successfully.',
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to configure labels');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to configure labels. Please try again.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/step/test-run
// Triggers a test issue to verify the end-to-end pipeline.
// ---------------------------------------------------------------------------

router.post('/step/test-run', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  const { owner, repo, labels } = req.body as {
    owner?: string;
    repo?: string;
    labels?: string[];
  } ?? {};

  if (!owner || !repo) {
    res.status(400).json({ error: 'Repository owner and name are required.' });
    return;
  }

  try {
    // Get installation ID from tenant repos
    const repos = await onboardingRepoConfig.getRepos(tenantId);
    const targetRepo = repos.find((r) => r.owner === owner && r.name === repo);

    if (!targetRepo) {
      res.status(404).json({
        error: `Repository "${owner}/${repo}" is not configured for this tenant.`,
      });
      return;
    }

    const result = await triggerTestRun(
      targetRepo.installationId,
      repo,
      owner,
      labels ?? [config.stas.label],
    );

    // Transition to test_run
    await onboardingStateMachine.transition(tenantId, 'test_run');

    // Store test issue URL in progress
    await onboardingStateMachine.updateProgress(tenantId, {
      testIssueUrl: result.issueUrl,
    });

    res.json({
      success: true,
      state: 'test_run',
      nextStep: 'completed',
      issueUrl: result.issueUrl,
      issueNumber: result.issueNumber,
      message: `Test issue #${result.issueNumber} created successfully.`,
    });
  } catch (err) {
    log.error({ err: String(err), tenantId, owner, repo }, 'Failed to trigger test run');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create test issue. Please try again.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/step/complete
// Marks the onboarding as complete.
// ---------------------------------------------------------------------------

router.post('/step/complete', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  try {
    await onboardingStateMachine.transition(tenantId, 'completed');

    // Mark the account as onboarding_completed
    const { accountsRepository } = await import('../db/repositories/index.js');
    const account = await accountsRepository.findByInstallationId(Number(tenantId));
    if (account) {
      const { queryWithRetry } = await import('../db/connection.js');
      await queryWithRetry(
        `UPDATE accounts SET onboarding_completed = TRUE, updated_at = NOW() WHERE id = $1`,
        [account.id],
      );
    }

    res.json({
      success: true,
      state: 'completed',
      message: 'Onboarding completed! STAS is now ready to process issues.',
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to complete onboarding');
    res.status(500).json({ error: 'Failed to complete onboarding. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/onboarding/checklist
// Returns the onboarding checklist with completion status.
// ---------------------------------------------------------------------------

router.get('/checklist', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  try {
    const checklist = await onboardingStateMachine.getChecklist(tenantId);

    res.json({
      tenantId,
      checklist,
      totalItems: checklist.length,
      completedItems: checklist.filter((c) => c.completed).length,
    });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to get onboarding checklist');
    res.status(500).json({ error: 'Failed to retrieve checklist. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/onboarding/repos
// Returns the configured repos for the tenant.
// ---------------------------------------------------------------------------

router.get('/repos', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant ID.' });
    return;
  }

  try {
    const repos = await onboardingRepoConfig.getRepos(tenantId);
    res.json({ repos });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to get tenant repos');
    res.status(500).json({ error: 'Failed to retrieve repositories. Please try again.' });
  }
});

export { router as onboardingRouter };
