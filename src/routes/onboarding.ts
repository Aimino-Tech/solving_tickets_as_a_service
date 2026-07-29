import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { z } from 'zod';
import {
  getWizardProgress,
  startWizard,
  recordGitHubInstallation,
  recordRepoSelection,
  recordBillingSetup,
  recordTeamSetup,
  resetWizard,
  skipWizard,
  getWizardConfig,
} from '../onboarding/wizard.js';
import type { GitHubInstallationParams, RepoSelectionParams, BillingSetupParams, TeamSetupParams } from '../onboarding/wizard.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'onboarding' });

const router: Router = Router();

const GitHubInstallSchema = z.object({
  installationId: z.number().int().positive(),
  accountLogin: z.string().optional(),
  accountType: z.enum(['user', 'organization']).optional(),
  reposGranted: z.number().int().optional(),
});

const RepoSelectionSchema = z.object({
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  repoId: z.number().int().optional(),
});

const BillingSetupSchema = z.object({
  planId: z.string().optional(),
  trialDays: z.number().int().optional(),
  skipBilling: z.boolean().optional(),
});

const TeamSetupSchema = z.object({
  teamName: z.string().optional(),
  skipTeam: z.boolean().optional(),
});

const StepParamSchema = z.enum(['github-install', 'repo-selection', 'billing-setup', 'team-setup']);

router.use(requireAuth);

function getTenantId(req: Request): string {
  return String(req.user!.id);
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await startWizard(tenantId);
    res.status(201).json({ success: true, progress });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to start wizard');
    res.status(500).json({ error: 'Failed to start wizard' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await getWizardProgress(tenantId);
    res.json({ progress, config: getWizardConfig() });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get wizard state');
    res.status(500).json({ error: 'Failed to get wizard state' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await getWizardProgress(tenantId);
    res.json({ progress, config: getWizardConfig() });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get wizard status');
    res.status(500).json({ error: 'Failed to get wizard status' });
  }
});

router.post('/step/:step', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { step } = req.params;

    const parsedStep = StepParamSchema.safeParse(step);
    if (!parsedStep.success) {
      res.status(400).json({
        error: 'Invalid step',
        message: 'Step must be one of: github-install, repo-selection, billing-setup, team-setup',
      });
      return;
    }

    let progress;

    switch (parsedStep.data) {
      case 'github-install': {
        const body = GitHubInstallSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
          return;
        }
        progress = await recordGitHubInstallation(tenantId, body.data as GitHubInstallationParams);
        break;
      }
      case 'repo-selection': {
        const body = RepoSelectionSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
          return;
        }
        progress = await recordRepoSelection(tenantId, body.data as RepoSelectionParams);
        break;
      }
      case 'billing-setup': {
        const body = BillingSetupSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
          return;
        }
        progress = await recordBillingSetup(tenantId, body.data as BillingSetupParams);
        break;
      }
      case 'team-setup': {
        const body = TeamSetupSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'Invalid request body', details: body.error.issues });
          return;
        }
        progress = await recordTeamSetup(tenantId, body.data as TeamSetupParams);
        break;
      }
    }

    res.json({ success: true, progress });
  } catch (err) {
    const message = String(err);
    if (message.includes('must be') || message.includes('before')) {
      res.status(400).json({ error: message });
      return;
    }
    log.error({ err: message }, 'Failed to complete wizard step');
    res.status(500).json({ error: 'Failed to complete wizard step' });
  }
});

router.post('/skip', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await skipWizard(tenantId);
    res.json({ success: true, progress });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to skip onboarding');
    res.status(500).json({ error: 'Failed to skip onboarding' });
  }
});

router.post('/reset', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await resetWizard(tenantId);
    res.json({ success: true, progress });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to reset wizard');
    res.status(500).json({ error: 'Failed to reset wizard' });
  }
});

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = getWizardConfig();
    res.json({ config });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get wizard config');
    res.status(500).json({ error: 'Failed to get wizard config' });
  }
});

export { router as onboardingRouter };
