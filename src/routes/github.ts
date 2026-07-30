import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { gitHubInstallationRepository } from '../db/repositories/GitHubInstallationRepository.js';
import { gitHubWebhookRepository } from '../db/repositories/GitHubWebhookRepository.js';
import { gitHubOAuthRepository } from '../db/repositories/GitHubOAuthRepository.js';
import { decrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'github-routes' });
const router: Router = Router();
const limiter = (rateLimit as any)({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
router.use(limiter);
router.use(requireAuth);

async function getGitHubToken(req: Request): Promise<string | null> {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const s = await gitHubOAuthRepository.findByUserId(req.user!.id);
  if (s) { try { return decrypt(s.accessTokenEncrypted); } catch {} }
  return null;
}

async function getAppOctokit(): Promise<Octokit | null> {
  try {
    const { getAppOctokitInstance } = await import('../github/auth.js');
    return getAppOctokitInstance();
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create App Octokit');
    return null;
  }
}

async function getInstallationToken(installationId: number): Promise<string | null> {
  try {
    const { getInstallationToken } = await import('../github/auth.js');
    return await getInstallationToken(installationId);
  } catch (err) {
    log.error({ err: String(err), installationId }, 'Failed to get installation token');
    return null;
  }
}

router.get('/installations', async (req: Request, res: Response) => {
  try {
    const octokit = await getAppOctokit();
    if (!octokit) {
      res.status(503).json({ error: 'GitHub App not configured — no app auth available' });
      return;
    }
    const r = await octokit.request('GET /app/installations', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    const d = r.data;
    const stored = await gitHubInstallationRepository.findByUserId(req.user!.id);
    const sm = new Map(stored.map(s => [s.installationId, s]));
    const installations = (Array.isArray(d) ? d : []).map((i: any) => ({
      id: i.id,
      accountLogin: i.account?.login,
      accountType: i.account?.type ?? i.target_type,
      avatarUrl: i.account?.avatar_url,
      repoScope: i.repository_selection,
      htmlUrl: i.html_url,
      stored: sm.has(i.id),
      storedId: sm.get(i.id)?.id ?? null,
    }));
    res.json({ installations });
  } catch (err) { log.error({ err: String(err) }, 'Failed to list installations'); res.status(500).json({ error: 'Failed to list installations' }); }
});

router.post('/installations', async (req: Request, res: Response) => {
  try {
    const { installationId, accountLogin, accountType, repoScope, avatarUrl } = req.body;
    if (!installationId || !accountLogin) { res.status(400).json({ error: 'installationId and accountLogin are required' }); return; }
    const existing = await gitHubInstallationRepository.findByInstallationId(installationId);
    if (existing) { res.status(409).json({ error: 'Installation already registered', installation: existing }); return; }
    const inst = await gitHubInstallationRepository.create({ userId: req.user!.id, installationId, accountLogin, accountType: accountType || 'User', repoScope: repoScope || 'selected', avatarUrl: avatarUrl || null });
    res.status(201).json(inst);
  } catch (err) { log.error({ err: String(err) }, 'Failed to store installation'); res.status(500).json({ error: 'Failed to store installation' }); }
});

router.delete('/installations/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const inst = await gitHubInstallationRepository.findById(id);
    if (!inst) { res.status(404).json({ error: 'Installation not found' }); return; }
    if (inst.userId !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
    await gitHubWebhookRepository.deleteByInstallationId(id);
    await gitHubInstallationRepository.delete(id);
    res.json({ success: true });
  } catch (err) { log.error({ err: String(err) }, 'Failed to delete installation'); res.status(500).json({ error: 'Failed to delete installation' }); }
});

router.get('/installations/:id/repos', async (req: Request, res: Response) => {
  try {
    const iid = Number(req.params.id);
    if (isNaN(iid)) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const token = await getInstallationToken(iid);
    if (!token) {
      res.status(503).json({ error: 'Failed to get installation token — check GitHub App configuration' });
      return;
    }
    const r = await fetch('https://api.github.com/installation/repositories', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot' } });
    if (!r.ok) { res.status(r.status).json({ error: 'GitHub API error' }); return; }
    const d = await r.json();
    const wh = await gitHubWebhookRepository.findByInstallationId(iid);
    const wm = new Map(wh.map(w => [w.repoOwner + '/' + w.repoName, w]));
    res.json({ repos: d.repositories.map((repo: any) => { const key = repo.full_name.toLowerCase(); const wh = wm.get(key); return { id: repo.id, owner: repo.owner.login, name: repo.name, fullName: repo.full_name, private: repo.private, description: repo.description, defaultBranch: repo.default_branch, language: repo.language, updatedAt: repo.updated_at, stasInstalled: !!wh?.active, stasWebhookId: wh?.webhookId ?? null }; }) });
  } catch (err) { log.error({ err: String(err) }, 'Failed to list repos'); res.status(500).json({ error: 'Failed to list repos' }); }
});

router.post('/installations/:id/repos/:owner/:repo/webhook', async (req: Request, res: Response) => {
  try {
    const iid = Number(req.params.id);
    if (isNaN(iid)) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const { owner, repo } = req.params;
    const inst = await gitHubInstallationRepository.findById(iid);
    if (!inst) { res.status(404).json({ error: 'Installation not found' }); return; }
    if (inst.userId !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
    const token = await getInstallationToken(iid);
    if (!token) {
      res.status(503).json({ error: 'Failed to get installation token — check GitHub App configuration' });
      return;
    }
    const baseUrl = process.env.STAS_PUBLIC_URL || req.protocol + '://' + req.get('host');
    const whResp = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/hooks', { method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'web', active: true, events: ['issues', 'pull_request', 'issue_comment', 'label'], config: { url: baseUrl + config.github.webhookPath, content_type: 'json', secret: config.github.webhookSecret } }) });
    if (!whResp.ok) { res.status(whResp.status).json({ error: 'Failed to create webhook' }); return; }
    const whData = await whResp.json();
    const stored = await gitHubWebhookRepository.create({ userId: req.user!.id, installationId: iid, repoOwner: owner, repoName: repo, webhookId: whData.id, webhookUrl: whData.config.url, active: whData.active });
    res.status(201).json(stored);
  } catch (err) { log.error({ err: String(err) }, 'Failed to create webhook'); res.status(500).json({ error: 'Failed to create webhook' }); }
});

router.delete('/installations/:id/repos/:owner/:repo/webhook', async (req: Request, res: Response) => {
  try {
    const iid = Number(req.params.id);
    if (isNaN(iid)) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const { owner, repo } = req.params;
    const existing = await gitHubWebhookRepository.findByOwnerAndRepo(owner, repo);
    if (!existing) { res.status(404).json({ error: 'Webhook not found' }); return; }
    if (existing.userId !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
    const token = await getInstallationToken(iid);
    if (!token) {
      res.status(503).json({ error: 'Failed to get installation token — check GitHub App configuration' });
      return;
    }
    await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/hooks/' + existing.webhookId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot' } });
    await gitHubWebhookRepository.deactivate(existing.id);
    res.json({ success: true });
  } catch (err) { log.error({ err: String(err) }, 'Failed to delete webhook'); res.status(500).json({ error: 'Failed to delete webhook' }); }
});

export { router as githubRouter };
