/**
 * Bitbucket workspace API — dashboard-facing endpoints for connecting a
 * Bitbucket workspace and managing per-repo SYNTARO webhooks.
 *
 * Credentials are stored per logged-in user (encrypted API token in
 * bitbucket_connections). Env BITBUCKET_API_TOKEN / BITBUCKET_APP_PASSWORD
 * remains a self-host fallback for the webhook runtime only.
 *
 * Routes (mounted at /api/v1/bitbucket):
 *   GET    /status                     — connection status for current user
 *   POST   /connect                    — verify + persist API token
 *   DELETE /disconnect                 — remove current user's connection
 *   GET    /repos                      — list workspace repos + webhook status
 *   POST   /repos/:owner/:repo/webhook — create the SYNTARO webhook on a repo
 *   DELETE /repos/:owner/:repo/webhook — remove the SYNTARO webhook from a repo
 */

import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { bitbucketConnectionRepository } from '../db/repositories/BitbucketConnectionRepository.js';
import { clientFromBitbucketConnection, clientFromStoredConnection, displayWorkspace, isPendingWorkspace, pendingWorkspaceForUser } from './bitbucketOAuth.js';
import { encrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'routes-bitbucket' });

const router: Router = Router();

function userId(req: Request): string {
  return String(req.user!.id);
}

async function loadUserConnection(req: Request) {
  return bitbucketConnectionRepository.findByUserId(userId(req));
}

/** Pull Atlassian/Bitbucket human-readable error from thrown client errors. */
function bitbucketErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'bitbucketMessage' in err && typeof (err as { bitbucketMessage?: string }).bitbucketMessage === 'string') {
    return (err as { bitbucketMessage: string }).bitbucketMessage;
  }
  if (err instanceof Error) {
    // Legacy/wrapped: "... failed: 401 {json}"
    const jsonMatch = err.message.match(/\{[\s\S]*\}$/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { error?: { message?: string }; message?: string };
        const msg = parsed.error?.message ?? parsed.message;
        if (msg) return msg;
      } catch {
        /* fall through */
      }
    }
    return err.message;
  }
  return String(err);
}

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await loadUserConnection(req);
    if (!row) {
      res.json({ connected: false, workspace: '', username: null, authMethod: null });
      return;
    }
    res.json({
      connected: true,
      workspace: displayWorkspace(row.workspace),
      workspacePending: isPendingWorkspace(row.workspace),
      username: row.username,
      authMethod: row.authMethod,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to load Bitbucket status');
    res.status(500).json({ error: 'Failed to load Bitbucket status' });
  }
});

/**
 * Forge app (Bitbucket App) status for the dashboard Settings page.
 * Reports whether the install link is configured and whether the app is
 * installed on the user's connected workspace.
 */
router.get('/forge-status', requireAuth, async (req: Request, res: Response) => {
  const installUrl = config.forge.installUrl;
  let workspaceConnected: string | null = null;
  let appInstalled = false;
  try {
    const row = await loadUserConnection(req);
    if (row && !isPendingWorkspace(row.workspace)) {
      workspaceConnected = row.workspace;
      const { bitbucketForgeInstallationRepository } = await import(
        '../db/repositories/BitbucketForgeInstallationRepository.js'
      );
      const forge = await bitbucketForgeInstallationRepository.findByWorkspace(row.workspace);
      appInstalled = Boolean(forge?.workspaceUuid);
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to resolve Forge installation status');
  }
  res.json({
    configured: Boolean(installUrl),
    installUrl: installUrl || null,
    workspaceConnected,
    appInstalled,
  });
});

router.post('/connect', requireAuth, async (req: Request, res: Response) => {
  // Atlassian API tokens authenticate as email:token (Basic auth).
  const apiToken = String(req.body.apiToken ?? req.body.appPassword ?? '').trim();
  const preferredWorkspace = String(req.body.workspace ?? '').trim();
  const uid = userId(req);
  // Prefer explicit Atlassian email from the form; fall back to SYNTARO login email.
  const email = String(req.body.email ?? req.user?.email ?? '').trim().toLowerCase();

  if (!apiToken) {
    res.status(400).json({ error: 'apiToken is required' });
    return;
  }
  if (!email || !email.includes('@')) {
    res.status(400).json({
      error: 'Atlassian account email is required (must be the email registered with Atlassian/Bitbucket)',
    });
    return;
  }

  try {
    const probe = clientFromBitbucketConnection(email, apiToken, 'api_token');
    let workspaces: Array<{ slug: string; name: string }>;
    try {
      await probe.getAuthenticatedUser();
      workspaces = await probe.listWorkspaces();
    } catch (err) {
      const detail = bitbucketErrorMessage(err);
      log.warn({ err: detail, emailUsed: email, userId: uid }, 'Bitbucket connect verification failed');
      // 400 — not 401. 401 clears the dashboard JWT session (client redirects to /login).
      let error = detail;
      const lower = detail.toLowerCase();
      if (lower.includes('not supported for this endpoint') || lower.includes('invalid, expired')) {
        error =
          `${detail} Tried Atlassian email: ${email}. ` +
          'Fix: (1) Create API token with scopes → app Bitbucket (not a plain token). ' +
          '(2) SYNTARO login email must be the same Atlassian account email that created the token. ' +
          '(3) Paste the full token once — it is shown only at creation.';
      } else if (lower.includes('no bitbucket scopes')) {
        error =
          `${detail} Recreate with Create API token with scopes → Bitbucket, and enable User/Workspaces/Repos/PRs/Issues/Webhooks as listed in Settings.`;
      }
      res.status(400).json({
        error,
        emailUsed: email,
        hint:
          'Create an API token with Bitbucket scopes (Account settings → Security → API tokens). Use the same Atlassian account email that owns the token.',
      });
      return;
    }

    const resolvedSlug =
      (preferredWorkspace && workspaces.some((w) => w.slug === preferredWorkspace)
        ? preferredWorkspace
        : workspaces[0]?.slug) ?? '';
    // Account connect first; workspace optional until the user creates/joins one on Bitbucket.
    const workspace = resolvedSlug || pendingWorkspaceForUser(uid);
    const workspacePending = isPendingWorkspace(workspace);

    if (!workspacePending) {
      const existing = await bitbucketConnectionRepository.findByWorkspace(workspace);
      if (existing && existing.userId !== uid) {
        res.status(409).json({ error: 'This Bitbucket workspace is already connected by another user' });
        return;
      }
    }

    let repos: Array<{ name: string; fullName: string; private: boolean; mainbranch: string }> = [];
    if (!workspacePending) {
      try {
        repos = await probe.listRepos(workspace);
      } catch (err) {
        const detail = bitbucketErrorMessage(err);
        res.status(400).json({ error: detail, emailUsed: email });
        return;
      }
    }

    try {
      await bitbucketConnectionRepository.upsert({
        userId: uid,
        // Store Atlassian account email — API tokens use email:token Basic auth.
        username: email,
        appPasswordEncrypted: encrypt(apiToken),
        workspace,
        authMethod: 'api_token',
        refreshTokenEncrypted: null,
        bitbucketUuid: null,
        scope: null,
        tokenExpiresAt: null,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('idx_bitbucket_connections_workspace') || /unique|duplicate/i.test(msg)) {
        res.status(409).json({ error: 'This Bitbucket workspace is already connected by another user' });
        return;
      }
      throw err;
    }

    log.info(
      {
        workspace: displayWorkspace(workspace),
        workspacePending,
        repoCount: repos.length,
        userId: uid,
        emailUsed: email,
      },
      'Bitbucket workspace connected',
    );
    res.json({
      connected: true,
      workspace: displayWorkspace(workspace),
      workspacePending,
      repoCount: repos.length,
      workspaces: workspaces.map((w) => w.slug),
      emailUsed: email,
    });
  } catch (err) {
    log.error({ err: String(err), userId: uid }, 'Bitbucket connect failed');
    res.status(500).json({ error: 'Failed to connect Bitbucket workspace' });
  }
});

router.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await bitbucketConnectionRepository.delete(userId(req));
    log.info({ userId: userId(req) }, 'Bitbucket workspace disconnected');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to disconnect Bitbucket');
    res.status(500).json({ error: 'Failed to disconnect Bitbucket' });
  }
});

router.get('/repos', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await loadUserConnection(req);
    if (!row) {
      res.json({ connected: false, repos: [] });
      return;
    }
    if (isPendingWorkspace(row.workspace)) {
      res.json({
        connected: true,
        workspace: '',
        workspacePending: true,
        repos: [],
      });
      return;
    }
    const bb = await clientFromStoredConnection(row);
    const repos = await bb.listRepos(row.workspace);
    const withWebhooks = await Promise.all(
      repos.map(async (repo) => {
        let webhookActive = false;
        try {
          const hooks = await bb.listWebhooks(row.workspace, repo.name);
          webhookActive = hooks.some((h) => h.active && h.url.includes('/webhook/bitbucket'));
        } catch {
          webhookActive = false;
        }
        return { ...repo, webhookActive };
      }),
    );
    res.json({ connected: true, workspace: row.workspace, workspacePending: false, repos: withWebhooks });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list Bitbucket repos');
    res.status(500).json({ error: 'Failed to list Bitbucket repos' });
  }
});

router.post('/repos/:owner/:repo/webhook', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await loadUserConnection(req);
    if (!row) {
      res.status(401).json({ error: 'Bitbucket workspace not connected' });
      return;
    }
    const owner = String(req.params.owner);
    const repo = String(req.params.repo);
    const baseUrl = process.env.SYNTARO_PUBLIC_URL || 'https://api.syntaro.io';
    const { uuid } = await (await clientFromStoredConnection(row)).createWebhook(
      owner,
      repo,
      `${baseUrl}/webhook/bitbucket`,
      config.bitbucket.webhookSecret,
    );
    log.info({ owner, repo, webhookUuid: uuid, userId: userId(req) }, 'Bitbucket repo webhook created');
    res.json({ success: true, webhookUuid: uuid });
  } catch (err) {
    log.error({ err: String(err), owner: req.params.owner, repo: req.params.repo }, 'Failed to create Bitbucket repo webhook');
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.delete('/repos/:owner/:repo/webhook', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await loadUserConnection(req);
    if (!row) {
      res.status(401).json({ error: 'Bitbucket workspace not connected' });
      return;
    }
    const owner = String(req.params.owner);
    const repo = String(req.params.repo);
    const bb = await clientFromStoredConnection(row);
    const hooks = await bb.listWebhooks(owner, repo);
    const target = hooks.find((h) => h.url.includes('/webhook/bitbucket'));
    if (target) {
      await bb.removeWebhook(owner, repo, target.uuid);
    }
    log.info({ owner, repo, userId: userId(req) }, 'Bitbucket repo webhook removed');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err), owner: req.params.owner, repo: req.params.repo }, 'Failed to remove Bitbucket repo webhook');
    res.status(500).json({ error: 'Failed to remove webhook' });
  }
});

export { router as bitbucketRouter };
