import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { getInstallationToken } from '../github/auth.js';
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
  if (h?.startsWith('Bearer ')) {
    const token = h.slice(7);
    if (!token.startsWith('eyJ')) return token; // real GitHub OAuth token
  }
  // Check DB-stored OAuth token
  if (req.user) {
    const s = await gitHubOAuthRepository.findByUserId(req.user.id);
    if (s) {
      // DB returns snake_case keys; support both
      const encToken = (s as any).access_token_encrypted ?? s.accessTokenEncrypted;
      if (encToken) {
        try { return decrypt(encToken); }
        catch (e) { log.warn({ err: String(e) }, 'Failed to decrypt GitHub token'); }
      }
    } else {
      log.warn({ userId: req.user.id }, 'No GitHub token found in DB');
    }
  } else {
    log.warn('getGitHubToken called without req.user');
  }
  // Dev fallback
  if (config.github.devToken) return config.github.devToken;
  return null;
}

/**
 * Normalize a pg row (snake_case keys) to camelCase keys for API responses.
 */
function normalizeInstallationRow(s: Record<string, unknown>) {
  return {
    installationId: (s as any).installation_id ?? (s as any).installationId,
    accountLogin: (s as any).account_login ?? (s as any).accountLogin,
    accountType: (s as any).account_type ?? (s as any).accountType,
    avatarUrl: (s as any).avatar_url ?? (s as any).avatarUrl ?? null,
    repoScope: (s as any).repo_scope ?? (s as any).repoScope,
    repos: (s as any).repos_json ?? (s as any).repos ?? [],
    stored: true,
    storedId: (s as any).id,
  };
}

router.get('/installations', async (req: Request, res: Response) => {
  try {
    const token = await getGitHubToken(req);
    const stored = await gitHubInstallationRepository.findByUserId(Number(req.user!.id));
    const storedRows = (stored as unknown as Record<string, unknown>[]).map(normalizeInstallationRow);

    if (!token) {
      res.json({ installations: storedRows, error: 'GitHub OAuth token not available — showing saved installations only' });
      return;
    }

    const r = await fetch('https://api.github.com/user/installations', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot' },
    });

    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      log.warn({ status: r.status, body: errBody }, 'GitHub API error fetching installations — falling back to DB');
      res.json({ installations: storedRows, error: `GitHub API returned ${r.status} — showing saved installations only` });
      return;
    }

    const d = await r.json();
    const sm = new Map(storedRows.map((s) => [s.installationId, s]));
    const installations = (d.installations ?? []).map((i: any) => ({
      installationId: i.id,
      accountLogin: i.account?.login ?? 'unknown',
      accountType: i.target_type ?? 'User',
      avatarUrl: i.account?.avatar_url ?? null,
      repoScope: i.repository_selection ?? 'selected',
      htmlUrl: i.html_url ?? null,
      stored: sm.has(i.id),
      storedId: sm.get(i.id)?.storedId ?? null,
    }));

    // Merge in any DB-only installations not returned by GitHub API
    for (const s of storedRows) {
      if (!sm.has(s.installationId)) {
        installations.push(s);
      }
    }

    res.json({ installations });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list installations');
    try {
      const stored = await gitHubInstallationRepository.findByUserId(Number(req.user!.id));
      const storedRows = (stored as unknown as Record<string, unknown>[]).map(normalizeInstallationRow);
      res.json({ installations: storedRows, error: 'Failed to list installations — showing saved installations only' });
    } catch {
      res.status(500).json({ error: 'Failed to list installations' });
    }
  }
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

router.post('/installations/sync', async (req: Request, res: Response) => {
  try {
    const { installationId, accountLogin, accountType, repoScope, avatarUrl, repos } = req.body;
    if (!installationId || !accountLogin) {
      res.status(400).json({ error: 'installationId and accountLogin are required' });
      return;
    }
    const inst = await gitHubInstallationRepository.create({
      userId: req.user!.id,
      installationId,
      accountLogin,
      accountType: accountType || 'User',
      repoScope: repoScope || 'selected',
      avatarUrl: avatarUrl || null,
      reposJson: repos,
    });
    log.info({ installationId, accountLogin, userId: req.user!.id }, 'Installation synced');
    res.json({ success: true, installation: inst });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to sync installation');
    res.status(500).json({ error: 'Failed to sync installation' });
  }
});

router.delete('/installations/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid installation ID' }); return; }
    const inst = await gitHubInstallationRepository.findByInstallationId(id);
    if (!inst) { res.status(404).json({ error: 'Installation not found' }); return; }
    const instUserId = (inst as any).user_id ?? inst.userId;
    if (instUserId !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
    const delInstallationId = Number((inst as any).installation_id ?? inst.installationId);
    await gitHubWebhookRepository.deleteByInstallationId(delInstallationId);
    await gitHubInstallationRepository.delete(inst.id);
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
    const instUserId = (inst as any).user_id ?? inst.userId;
    if (instUserId !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }

    let webhookId: number | null = null;
    let warning: string | undefined;

    const token = await getGitHubToken(req);
    if (token) {
      const baseUrl = process.env.STAS_PUBLIC_URL || req.protocol + '://' + req.get('host');
      const whResp = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/hooks', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'web', active: true, events: ['issues', 'pull_request', 'issue_comment', 'label'], config: { url: baseUrl + config.github.webhookPath, content_type: 'json', secret: config.github.webhookSecret } }),
      });
      if (whResp.ok) {
        const whData = await whResp.json();
        webhookId = whData.id;
        await gitHubWebhookRepository.create({ userId: req.user!.id, installationId: iid, repoOwner: owner, repoName: repo, webhookId: whData.id, webhookUrl: whData.config.url, active: whData.active });
      } else {
        const errBody = await whResp.text().catch(() => '');
        log.warn({ status: whResp.status, body: errBody, owner, repo }, 'GitHub API webhook creation failed — connecting repo without webhook');
        warning = 'Repo connected without webhook (GitHub API ' + whResp.status + ').';
      }
    } else {
      warning = 'Repo connected. No GitHub OAuth token available for webhook creation.';
    }

    const fullName = owner + '/' + repo;
    const existingRepos: Array<any> = Array.isArray((inst as any).repos_json) ? (inst as any).repos_json : [];
    const updatedRepos = existingRepos.map((r: any) =>
      r.fullName === fullName ? { ...r, stasInstalled: true } : r
    );
    if (!updatedRepos.find((r: any) => r.fullName === fullName)) {
      updatedRepos.push({ name: repo, owner, fullName, private: false, stasInstalled: true });
    }
    const actualInstallationId = (inst as any).installation_id ?? inst.installationId;
    await gitHubInstallationRepository.create({
      userId: req.user!.id,
      installationId: Number(actualInstallationId),
      accountLogin: (inst as any).account_login ?? inst.accountLogin,
      accountType: (inst as any).account_type ?? inst.accountType,
      repoScope: (inst as any).repo_scope ?? inst.repoScope,
      reposJson: updatedRepos,
    });

    res.status(201).json({ success: true, webhookId, warning });
  } catch (err) { log.error({ err: String(err) }, 'Failed to create webhook'); res.status(500).json({ error: 'Failed to create webhook' }); }
});

router.delete('/installations/:id/repos/:owner/:repo/webhook', async (req: Request, res: Response) => {
  try {
    const token = await getGitHubToken(req);
    if (!token) { res.status(401).json({ error: 'GitHub access token not available' }); return; }
    const iid = Number(req.params.id);
    const { owner, repo } = req.params;
    const existing = await gitHubWebhookRepository.findByOwnerAndRepo(owner, repo);
    if (!existing) {
      // Remove from DB even if no webhook record
    } else {
      if (existing.userId !== req.user!.id) { res.status(403).json({ error: 'Forbidden' }); return; }
      try {
        await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/hooks/' + existing.webhookId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot' } });
      } catch { log.warn({ owner, repo }, 'GitHub API delete webhook failed — removing from DB anyway'); }
      await gitHubWebhookRepository.deactivate(existing.id);
    }
    // Mark repo as not installed in the installation record
    const inst = await gitHubInstallationRepository.findByInstallationId(iid);
    if (inst && Array.isArray((inst as any).repos_json)) {
      const updatedRepos = (inst as any).repos_json.map((r: any) =>
        r.fullName === owner + '/' + repo ? { ...r, stasInstalled: false } : r
      );
      await gitHubInstallationRepository.create({
        userId: req.user!.id,
        installationId: iid,
        accountLogin: inst.accountLogin,
        accountType: inst.accountType,
        repoScope: inst.repoScope,
        reposJson: updatedRepos,
      });
    }
    res.json({ success: true });
  } catch (err) { log.error({ err: String(err) }, 'Failed to delete webhook'); res.status(500).json({ error: 'Failed to delete webhook' }); }
});

export { router as githubRouter };
