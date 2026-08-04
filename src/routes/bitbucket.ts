/**
 * Bitbucket workspace API — dashboard-facing endpoints for connecting a
 * Bitbucket workspace via the SYNTARO Marketplace app and managing per-repo
 * webhooks.
 *
 * Routes (mounted at /api/v1/bitbucket):
 *   GET    /status                    — connection status (workspace, app id)
 *   GET    /install                   — Marketplace app install URL
 *   POST   /connect                   — verify + store Marketplace-app OAuth
 *                                       credentials (client id/secret) + workspace
 *   DELETE /disconnect                — revoke stored credentials
 *   GET    /repos                     — list workspace repos + webhook status
 *   POST   /repos/:owner/:repo/webhook — create the SYNTARO webhook on a repo
 *   DELETE /repos/:owner/:repo/webhook — remove the SYNTARO webhook from a repo
 *
 * Authentication uses the Marketplace-app OAuth2 client-credentials grant
 * (AIM-4633 contract): every API call fetches a fresh access token on demand.
 */

import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { fetchBitbucketToken } from '../platforms/bitbucket/oauth.js';
import { BitbucketPlatformClient } from '../platforms/bitbucket/index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'routes-bitbucket' });

const router: Router = Router();

/**
 * Scopes granted by the Marketplace app listing (must match Bitbucket.OAuth).
 */
export const BITBUCKET_APP_SCOPES = [
  'repository:read',
  'repository:write',
  'issue:read',
  'issue:write',
  'pullrequest:read',
  'pullrequest:write',
  'webhook:read',
  'webhook:write',
];

export const BITBUCKET_MARKETPLACE_URL = 'https://marketplace.atlassian.com/apps/1225120/syntaro-ai-ticket-fixing';

interface BitbucketConnection {
  clientId: string;
  clientSecret: string;
  workspace: string;
}

/**
 * Connection state is seeded from env and can be overridden at runtime via
 * POST /connect. In-memory per process — self-host v1 (single workspace per
 * instance, mirroring the BITBUCKET_* env model).
 */
const connection: BitbucketConnection = {
  clientId: config.bitbucket.clientId,
  clientSecret: config.bitbucket.clientSecret,
  workspace: config.bitbucket.workspace,
};

function isConnected(): boolean {
  return Boolean(connection.clientId && connection.clientSecret && connection.workspace);
}

async function tokenClient(): Promise<BitbucketPlatformClient> {
  const { access_token } = await fetchBitbucketToken(connection.clientId, connection.clientSecret, {
    tokenUrl: config.bitbucket.tokenUrl,
  });
  return new BitbucketPlatformClient(access_token, config.bitbucket.baseUrl);
}

router.get('/status', requireAuth, (_req: Request, res: Response) => {
  res.json({
    connected: isConnected(),
    workspace: connection.workspace,
    clientId: isConnected() ? connection.clientId : null,
    scopes: BITBUCKET_APP_SCOPES,
    marketplaceUrl: BITBUCKET_MARKETPLACE_URL,
  });
});

router.get('/install', requireAuth, (_req: Request, res: Response) => {
  res.redirect(BITBUCKET_MARKETPLACE_URL);
});

router.post('/connect', requireAuth, async (req: Request, res: Response) => {
  const clientId = String(req.body.clientId ?? '').trim();
  const clientSecret = String(req.body.clientSecret ?? '').trim();
  const workspace = String(req.body.workspace ?? '').trim();

  if (!clientId || !clientSecret || !workspace) {
    res.status(400).json({ error: 'clientId, clientSecret and workspace are required' });
    return;
  }

  try {
    // Verify the Marketplace-app credentials by fetching an access token and
    // listing the workspace repositories (mirrors OS connect probe).
    const { access_token } = await fetchBitbucketToken(clientId, clientSecret, {
      tokenUrl: config.bitbucket.tokenUrl,
    });
    const probe = new BitbucketPlatformClient(access_token, config.bitbucket.baseUrl);
    const repos = await probe.listRepos(workspace);
    connection.clientId = clientId;
    connection.clientSecret = clientSecret;
    connection.workspace = workspace;
    log.info({ workspace, repoCount: repos.length }, 'Bitbucket workspace connected');
    res.json({ connected: true, workspace, repoCount: repos.length });
  } catch (err) {
    log.warn({ err: String(err), workspace }, 'Bitbucket connect verification failed');
    res.status(401).json({ error: 'Connection failed — check the Marketplace app credentials and workspace name' });
  }
});

router.delete('/disconnect', requireAuth, (_req: Request, res: Response) => {
  connection.clientId = '';
  connection.clientSecret = '';
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
    const bb = await tokenClient();
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
    const bb = await tokenClient();
    const { uuid } = await bb.createWebhook(owner, repo, `${baseUrl}/webhook/bitbucket`, config.bitbucket.webhookSecret);
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
    const bb = await tokenClient();
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
