import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../security/authMiddleware.js';
import { gitHubOAuthRepository } from '../db/repositories/GitHubOAuthRepository.js';
import { gitHubInstallationRepository } from '../db/repositories/GitHubInstallationRepository.js';
import { gitHubWebhookRepository } from '../db/repositories/GitHubWebhookRepository.js';
import { getInstallationToken } from '../github/auth.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'github-oauth' });
const oauthRouter: Router = Router();
const installRouter: Router = Router();

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
}

interface GitHubInstallationItem {
  id: number;
  account: { login: string; id: number; type: string };
  repository_selection: string;
  repositories_url: string;
}

interface GitHubRepoItem {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  default_branch: string;
  language: string | null;
  updated_at: string;
}

async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.github.oauthClientId,
      client_secret: config.github.oauthClientSecret,
      code,
      redirect_uri: config.github.oauthRedirectUrl,
    }),
  });
  return resp.json() as Promise<GitHubTokenResponse>;
}

async function getGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'stas-bot',
    },
  });
  return resp.json() as Promise<GitHubUserResponse>;
}

async function getInstallationRepos(accessToken: string, reposUrl: string): Promise<GitHubRepoItem[]> {
  const resp = await fetch(reposUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'stas-bot',
    },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { repositories: GitHubRepoItem[] };
  return data.repositories ?? [];
}

oauthRouter.post('/url', requireAuth, (_req: Request, res: Response) => {
  const oauthUrl = new URL('https://github.com/login/oauth/authorize');
  oauthUrl.searchParams.set('client_id', config.github.oauthClientId);
  oauthUrl.searchParams.set('redirect_uri', config.github.oauthRedirectUrl);
  oauthUrl.searchParams.set('scope', 'repo,user');
  oauthUrl.searchParams.set('state', Math.random().toString(36).slice(2));
  res.json({ url: oauthUrl.toString() });
});

oauthRouter.post('/callback', requireAuth, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: 'Authorization code is required' });
      return;
    }

    const tokenResp = await exchangeCodeForToken(code);
    if (tokenResp.error) {
      log.warn({ error: tokenResp.error, description: tokenResp.error_description }, 'GitHub OAuth token exchange failed');
      res.status(400).json({ error: tokenResp.error_description || 'Failed to exchange authorization code' });
      return;
    }

    const accessToken = tokenResp.access_token;
    const githubUser = await getGitHubUser(accessToken);
    const encrypted = Buffer.from(accessToken).toString('base64');

    await gitHubOAuthRepository.upsert({
      userId: req.user!.id,
      accessTokenEncrypted: encrypted,
      githubLogin: githubUser.login,
      githubUserId: githubUser.id,
    });

    res.json({
      githubLogin: githubUser.login,
      githubUserId: githubUser.id,
      avatarUrl: githubUser.avatar_url,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'GitHub OAuth callback failed');
    res.status(500).json({ error: 'Failed to complete GitHub OAuth flow' });
  }
});

oauthRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await gitHubOAuthRepository.findByUserId(req.user!.id);
    if (!token) {
      res.json({ connected: false });
      return;
    }
    res.json({
      connected: true,
      githubLogin: token.githubLogin,
      githubUserId: token.githubUserId,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get GitHub OAuth status');
    res.status(500).json({ error: 'Failed to get connection status' });
  }
});

oauthRouter.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await gitHubOAuthRepository.delete(req.user!.id);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to disconnect GitHub');
    res.status(500).json({ error: 'Failed to disconnect GitHub' });
  }
});

installRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await gitHubOAuthRepository.findByUserId(req.user!.id);
    if (!token) {
      res.status(401).json({ error: 'GitHub not connected' });
      return;
    }

    const accessToken = Buffer.from(token.accessTokenEncrypted, 'base64').toString();
    const resp = await fetch('https://api.github.com/user/installations', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'stas-bot',
      },
    });

    if (!resp.ok) {
      res.status(resp.status).json({ error: 'Failed to fetch installations' });
      return;
    }

    const data = (await resp.json()) as { installations: GitHubInstallationItem[] };

    const installations = await Promise.all(
      data.installations.map(async (inst) => {
        const repos = await getInstallationRepos(accessToken, inst.repositories_url);
        const webhooks = await gitHubWebhookRepository.findByUserId(req.user!.id);
        const configuredRepos = repos.map((r) => {
          const wh = webhooks.find((w) => w.owner === r.owner.login && w.repo === r.name);
          return {
            id: r.id,
            name: r.name,
            fullName: r.full_name,
            owner: r.owner.login,
            private: r.private,
            description: r.description,
            defaultBranch: r.default_branch,
            language: r.language,
            stasInstalled: !!wh,
            webhookId: wh?.webhookId ?? null,
          };
        });

        return {
          installationId: inst.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type,
          repoScope: inst.repository_selection,
          repos: configuredRepos,
        };
      }),
    );

    res.json({ installations });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list installations');
    res.status(500).json({ error: 'Failed to list installations' });
  }
});

installRouter.post('/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const { installationId, accountLogin, accountType, repoScope } = req.body;
    if (!installationId || !accountLogin) {
      res.status(400).json({ error: 'installationId and accountLogin are required' });
      return;
    }

    const existing = await gitHubInstallationRepository.findByInstallationId(installationId);
    if (!existing) {
      await gitHubInstallationRepository.create({
        userId: req.user!.id,
        installationId,
        accountLogin,
        accountType: accountType ?? 'User',
        repoScope: repoScope ?? 'selected',
      });
    }

    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to sync installation');
    res.status(500).json({ error: 'Failed to sync installation' });
  }
});

installRouter.delete('/:installationId', requireAuth, async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.params.installationId);
    await gitHubInstallationRepository.delete(installationId);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to remove installation');
    res.status(500).json({ error: 'Failed to remove installation' });
  }
});

installRouter.post('/:installationId/repos/:owner/:repo/webhook', requireAuth, async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.params.installationId);
    const { owner, repo } = req.params;

    const existing = await gitHubWebhookRepository.findByOwnerAndRepo(owner, repo);
    if (existing && existing.active) {
      res.json({ success: true, webhookId: existing.webhookId, alreadyConfigured: true });
      return;
    }

    const token = await getInstallationToken(installationId);
    const webhookUrl = `${config.stas.publicUrl}${config.github.webhookPath}`;

    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'stas-bot',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['issues', 'pull_request'],
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: config.github.webhookSecret,
          insecure_ssl: '0',
        },
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      log.warn({ status: resp.status, body: errBody }, 'Failed to create webhook');
      res.status(resp.status).json({ error: 'Failed to create webhook', detail: errBody });
      return;
    }

    const hook = (await resp.json()) as { id: number };

    await gitHubWebhookRepository.create({
      userId: req.user!.id,
      installationId,
      owner,
      repo,
      webhookId: hook.id,
      webhookUrl,
    });

    res.json({ success: true, webhookId: hook.id });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to configure webhook');
    res.status(500).json({ error: 'Failed to configure webhook' });
  }
});

installRouter.delete('/:installationId/repos/:owner/:repo/webhook', requireAuth, async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.params.installationId);
    const { owner, repo } = req.params;

    const existing = await gitHubWebhookRepository.findByOwnerAndRepo(owner, repo);
    if (!existing) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    const token = await getInstallationToken(installationId);
    await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${existing.webhookId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'stas-bot',
      },
    });

    await gitHubWebhookRepository.deactivate(existing.id);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to remove webhook');
    res.status(500).json({ error: 'Failed to remove webhook' });
  }
});

export { oauthRouter, installRouter };
