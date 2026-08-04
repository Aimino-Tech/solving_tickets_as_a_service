/**
 * Bitbucket workspace API — dashboard-facing endpoints for connecting a
 * Bitbucket workspace and managing per-repo SYNTARO webhooks.
 *
 * Routes (mounted at /api/v1/bitbucket):
 *   GET    /status                    — connection status (username/workspace)
 *   POST   /connect                   — set workspace credentials (in-memory)
 *   DELETE /disconnect                — clear workspace credentials
 *   GET    /repos                     — list workspace repos + webhook status
 *   POST   /repos/:owner/:repo/webhook — create the SYNTARO webhook on a repo
 *   DELETE /repos/:owner/:repo/webhook — remove the SYNTARO webhook from a repo
 */

import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { BitbucketPlatformClient } from '../platforms/bitbucket/index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'routes-bitbucket' });

const router: Router = Router();

interface BitbucketConnection {
  username: string;
  appPassword: string;
  workspace: string;
}

/**
 * Connection state is seeded from env and can be overridden at runtime via
 * POST /connect. In-memory per process — self-host v1 (single workspace per
 * instance, mirroring the BITBUCKET_* env model).
 */
const connection: BitbucketConnection = {
  username: config.bitbucket.username,
  appPassword: config.bitbucket.appPassword,
  workspace: process.env.BITBUCKET_WORKSPACE ?? '',
};

function client(): BitbucketPlatformClient {
  return new BitbucketPlatformClient(`${connection.username}:${connection.appPassword}`, config.bitbucket.baseUrl);
}

function isConnected(): boolean {
  return Boolean(connection.username && connection.appPassword && connection.workspace);
}

router.get('/status', requireAuth, (_req: Request, res: Response) => {
  res.json({
    connected: isConnected(),
    workspace: connection.workspace,
    username: isConnected() ? connection.username : null,
  });
});

router.post('/connect', requireAuth, async (req: Request, res: Response) => {
  const username = String(req.body.username ?? '').trim();
  const appPassword = String(req.body.appPassword ?? '').trim();
  const workspace = String(req.body.workspace ?? '').trim();

  if (!username || !appPassword || !workspace) {
    res.status(400).json({ error: 'username, appPassword and workspace are required' });
    return;
  }

  const probe = new BitbucketPlatformClient(`${username}:${appPassword}`, config.bitbucket.baseUrl);
  try {
    const repos = await probe.listRepos(workspace);
    connection.username = username;
    connection.appPassword = appPassword;
    connection.workspace = workspace;
    log.info({ workspace, repoCount: repos.length }, 'Bitbucket workspace connected');
    res.json({ connected: true, workspace, repoCount: repos.length });
  } catch (err) {
    log.warn({ err: String(err), workspace, username }, 'Bitbucket connect verification failed');
    res.status(401).json({ error: 'Connection failed — check credentials and workspace name' });
  }
});

router.delete('/disconnect', requireAuth, (_req: Request, res: Response) => {
  connection.username = '';
  connection.appPassword = '';
  connection.workspace = '';
  log.info('Bitbucket workspace disconnected');
  res.json({ success: true });
});

router.get('/repos', requireAuth, async (_req: Request, res: Response) => {
  if (!isConnected()) {
    res.json({ connected: false, repos: [] });
    return;
  }
  try {
    const bb = client();
    const repos = await bb.listRepos(connection.workspace);
    const withWebhooks = await Promise.all(
      repos.map(async (repo) => {
        let webhookActive = false;
        try {
          const hooks = await bb.listWebhooks(connection.workspace, repo.name);
          webhookActive = hooks.some((h) => h.active && h.url.includes('/webhook/bitbucket'));
        } catch {
          webhookActive = false;
        }
        return { ...repo, webhookActive };
      }),
    );
    res.json({ connected: true, workspace: connection.workspace, repos: withWebhooks });
  } catch (err) {
    log.error({ err: String(err), workspace: connection.workspace }, 'Failed to list Bitbucket repos');
    res.status(500).json({ error: 'Failed to list Bitbucket repos' });
  }
});

router.post('/repos/:owner/:repo/webhook', requireAuth, async (req: Request, res: Response) => {
  if (!isConnected()) {
    res.status(401).json({ error: 'Bitbucket workspace not connected' });
    return;
  }
  const owner = String(req.params.owner);
  const repo = String(req.params.repo);
  const baseUrl = process.env.SYNTARO_PUBLIC_URL || 'https://api.syntaro.io';
  try {
    const { uuid } = await client().createWebhook(
      owner,
      repo,
      `${baseUrl}/webhook/bitbucket`,
      config.bitbucket.webhookSecret,
    );
    log.info({ owner, repo, webhookUuid: uuid }, 'Bitbucket repo webhook created');
    res.json({ success: true, webhookUuid: uuid });
  } catch (err) {
    log.error({ err: String(err), owner, repo }, 'Failed to create Bitbucket repo webhook');
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.delete('/repos/:owner/:repo/webhook', requireAuth, async (req: Request, res: Response) => {
  if (!isConnected()) {
    res.status(401).json({ error: 'Bitbucket workspace not connected' });
    return;
  }
  const owner = String(req.params.owner);
  const repo = String(req.params.repo);
  try {
    const bb = client();
    const hooks = await bb.listWebhooks(owner, repo);
    const target = hooks.find((h) => h.url.includes('/webhook/bitbucket'));
    if (target) {
      await bb.removeWebhook(owner, repo, target.uuid);
    }
    log.info({ owner, repo }, 'Bitbucket repo webhook removed');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err), owner, repo }, 'Failed to remove Bitbucket repo webhook');
    res.status(500).json({ error: 'Failed to remove webhook' });
  }
});

export { router as bitbucketRouter };
