import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/index.js';
import { config } from '../config.js';
import {
  getWizardProgress,
  startWizard,
  recordGitHubInstallation,
  recordRepoSelection,
  recordBillingSetup,
  recordTeamSetup,
  resetWizard,
  getWizardConfig,
  getAvailableTransitions,
} from '../onboarding/wizard.js';
import type { WizardStep } from '../onboarding/wizard.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'onboarding' });

const router: Router = Router();

function getTenantId(req: Request): string {
  return String(req.user?.id ?? req.headers['x-tenant-id'] ?? 'default');
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await getWizardProgress(tenantId);
    const wizardConfig = getWizardConfig();
    res.json({ progress, config: wizardConfig, githubAppUrl: wizardConfig.githubAppUrl });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get wizard');
    res.status(500).json({ error: 'Failed to get wizard' });
  }
});

router.post('/start', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await startWizard(tenantId);
    res.json(progress);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to start wizard');
    res.status(500).json({ error: 'Failed to start wizard' });
  }
});

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await getWizardProgress(tenantId);
    const transitions = getAvailableTransitions(progress.currentStep);
    res.json({ progress, availableTransitions: transitions });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get status');
    res.status(500).json({ error: 'Failed to get status' });
  }
});

router.get('/config', async (_req: Request, res: Response) => {
  const wizardConfig = getWizardConfig();
  res.json(wizardConfig);
});

router.post('/step/github-install', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { installationId, accountLogin, accountType, reposGranted } = req.body;
    if (!installationId) { res.status(400).json({ error: 'installationId is required' }); return; }
    const progress = await recordGitHubInstallation(tenantId, {
      installationId: Number(installationId),
      accountLogin, accountType,
      reposGranted: reposGranted ? Number(reposGranted) : undefined,
    });
    res.json(progress);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to record GitHub installation');
    res.status(500).json({ error: 'Failed to record GitHub installation' });
  }
});

router.post('/step/repo-selection', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { repoOwner, repoName, repoId } = req.body;
    if (!repoOwner || !repoName) { res.status(400).json({ error: 'repoOwner and repoName are required' }); return; }
    const progress = await recordRepoSelection(tenantId, { repoOwner, repoName, repoId });
    res.json(progress);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('must be installed')) { res.status(400).json({ error: msg }); return; }
    log.error({ err: msg }, 'Failed to record repo');
    res.status(500).json({ error: 'Failed to record repo' });
  }
});

router.post('/step/billing-setup', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { planId, trialDays, skipBilling } = req.body;
    const progress = await recordBillingSetup(tenantId, {
      planId, trialDays: trialDays ? Number(trialDays) : undefined, skipBilling: skipBilling ?? false,
    });
    res.json(progress);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('must be selected')) { res.status(400).json({ error: msg }); return; }
    log.error({ err: msg }, 'Failed to record billing');
    res.status(500).json({ error: 'Failed to record billing' });
  }
});

router.post('/step/team-setup', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { teamName, skipTeam } = req.body;
    const progress = await recordTeamSetup(tenantId, { teamName, skipTeam: skipTeam ?? false });
    res.json(progress);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('must be set up')) { res.status(400).json({ error: msg }); return; }
    log.error({ err: msg }, 'Failed to record team');
    res.status(500).json({ error: 'Failed to record team' });
  }
});

router.post('/skip', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await getWizardProgress(tenantId);
    progress.state = 'skipped';
    progress.updatedAt = new Date().toISOString();
    res.json(progress);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to skip');
    res.status(500).json({ error: 'Failed to skip' });
  }
});

router.post('/reset', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const progress = await resetWizard(tenantId);
    res.json(progress);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to reset');
    res.status(500).json({ error: 'Failed to reset' });
  }
});

export { router as onboardingRouter };
