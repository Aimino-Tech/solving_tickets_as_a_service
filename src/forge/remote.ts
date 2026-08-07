/**
 * Forge remote endpoints — the SYNTARO side of the Forge Remote proxy.
 *
 * Mounted at /forge/remote (see server.ts). Every endpoint verifies the FIT
 * token, extracts the x-forge-oauth-system token, rotates it into the
 * installation registry, and forwards the event into the existing pipeline.
 *
 *   POST /forge/remote/events         — Bitbucket product events
 *   POST /forge/remote/lifecycle      — app installed/upgraded
 *   POST /forge/remote/uninstall      — preUninstall cleanup
 *   POST /forge/remote/token-refresh  — hourly scheduled trigger (keeps a
 *                                       fresh bot token cached for the worker)
 */

import { type NextFunction, type Request, type Response, Router } from 'express';
import { auditLog } from '../audit/middleware.js';
import { config } from '../config.js';
import { bitbucketForgeInstallationRepository } from '../db/repositories/BitbucketForgeInstallationRepository.js';
import { encrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';
import { extractForgeContext, FitVerificationError } from './fit.js';
import type { ForgeBitbucketEvent, ForgeLifecycleEvent, ForgeRequestContext } from './types.js';

const log = rootLogger.child({ module: 'forge-remote' });

type EnqueueHandler = (data: import('../utils/types.js').IssueJobData) => Promise<string | undefined>;

interface ForgeRequest extends Request {
  forge?: ForgeRequestContext;
}

/** Parse the JSON body — /forge/remote is served through the raw-body
 *  middleware, so req.body arrives as a Buffer. */
function parseBody(req: Request): ForgeBitbucketEvent | ForgeLifecycleEvent {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8'));
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }
  return req.body;
}

/** Normalize a Bitbucket workspace identifier: strip { } UUID braces for storage. */
function normalizeWorkspaceUuid(uuid: string | undefined): string | undefined {
  const trimmed = (uuid ?? '').trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve a Bitbucket REST client for the current Forge context using the
 * app-system token, preferring the per-user connection when no installation
 * token is cached yet (defensive fallback).
 */
async function forgeClient(
  ctx: ForgeRequestContext,
): Promise<import('../platforms/bitbucket/index.js').BitbucketPlatformClient> {
  const { BitbucketPlatformClient } = await import('../platforms/bitbucket/index.js');
  return new BitbucketPlatformClient(`bearer:${ctx.systemToken}`, ctx.apiBaseUrl);
}

/**
 * Ensure the workspace slug for a workspace UUID is resolved and persisted.
 * Returns the slug (or UUID fallback) so git clone URLs stay valid — Bitbucket
 * git URLs need the workspace slug, while REST accepts the UUID.
 */
async function ensureWorkspaceSlug(ctx: ForgeRequestContext, workspaceUuid: string): Promise<string> {
  const existing = await bitbucketForgeInstallationRepository.findByInstallationId(ctx.installationId);
  if (existing?.workspaceSlug) return existing.workspaceSlug;

  let slug: string | null = null;
  try {
    const client = await forgeClient(ctx);
    slug = await client.resolveWorkspaceSlug(workspaceUuid);
  } catch (err) {
    log.warn(
      { err: String(err), installationId: ctx.installationId, workspaceUuid },
      'Failed to resolve workspace slug — falling back to UUID',
    );
  }
  if (slug) {
    await bitbucketForgeInstallationRepository.setWorkspace(ctx.installationId, workspaceUuid, slug);
  }
  return slug ?? workspaceUuid;
}

/** Parse a SYNTARO PR command (e.g. `/syntaro fix`). Returns null when not a command. */
export function parseSyntaroCommand(text: string | null | undefined): { command: string } | null {
  if (!text) return null;
  const match = text.match(/^\s*\/syntaro\s+(fix|review)\b/i);
  if (!match) return null;
  return { command: match[1].toLowerCase() };
}

/** Persist (or rotate) the installation + app-system token from an invocation. */
async function persistInvocation(ctx: ForgeRequestContext, workspaceUuid?: string): Promise<void> {
  try {
    await bitbucketForgeInstallationRepository.upsert({
      installationId: ctx.installationId,
      appId: ctx.appId,
      workspaceUuid: normalizeWorkspaceUuid(workspaceUuid) ?? undefined,
      apiBaseUrl: ctx.apiBaseUrl,
      systemTokenEncrypted: encrypt(ctx.systemToken),
      tokenExpiresAt: ctx.systemTokenExpiresAt,
    });
  } catch (err) {
    log.error({ err: String(err), installationId: ctx.installationId }, 'Failed to persist Forge invocation token');
  }
}

async function enqueueFixRun(
  enqueue: EnqueueHandler,
  ctx: ForgeRequestContext,
  params: {
    workspace: string;
    repo: string;
    repoPrivate: boolean;
    prNumber: number;
    prTitle: string;
    prBody: string | null;
  },
): Promise<{ enqueued: boolean; jobId?: string }> {
  const workspaceUuid = normalizeWorkspaceUuid(params.workspace);
  const workspaceSlug = workspaceUuid ? await ensureWorkspaceSlug(ctx, workspaceUuid) : params.workspace;

  const jobData: import('../utils/types.js').IssueJobData = {
    installationId: Number(ctx.installationId) || 0,
    repoOwner: workspaceSlug,
    repoName: params.repo,
    repoPrivate: params.repoPrivate,
    issueNumber: params.prNumber,
    issueTitle: params.prTitle,
    issueBody: params.prBody,
    source: 'bitbucket',
    labels: [config.syntaro.label],
    jobKind: 'pr-completion',
    forgeInstallationId: ctx.installationId,
    forgeWorkspaceUuid: workspaceUuid,
  };
  const jobId = await enqueue(jobData);
  return { enqueued: Boolean(jobId), jobId };
}

/** Post a status comment on the PR using the bot identity. */
async function postPrComment(
  ctx: ForgeRequestContext,
  workspace: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  try {
    const client = await forgeClient(ctx);
    await client.createComment(`${workspace}/${repo}`, prNumber, body);
  } catch (err) {
    log.warn({ err: String(err), workspace, repo, prNumber }, 'Failed to post PR status comment');
  }
}

function auditForgeEvent(actorType: string, action: string, details: Record<string, unknown>): void {
  try {
    auditLog({
      actorType: actorType as 'system' | 'admin' | 'user' | 'webhook',
      actorId: 'forge',
      action,
      resourceType: 'bitbucket_forge_installation',
      resourceId: String(details.installationId ?? 'unknown'),
      details,
    });
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to audit Forge event');
  }
}

/** FIT auth middleware — attach forge context or reject with 401. */
async function forgeAuth(req: ForgeRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    req.forge = await extractForgeContext(
      req.headers.authorization,
      req.headers['x-forge-oauth-system'] as string | undefined,
    );
    next();
  } catch (err) {
    if (err instanceof FitVerificationError) {
      res.status(401).json({ error: err.message });
      return;
    }
    log.error({ err: String(err) }, 'Forge auth middleware failed');
    res.status(500).json({ error: 'Forge auth failed' });
  }
}

export function createForgeRemoteRouter(enqueue: EnqueueHandler): Router {
  const router: Router = Router();

  router.use(forgeAuth);

  router.post('/events', async (req: ForgeRequest, res: Response) => {
    const ctx = req.forge!;
    const payload = parseBody(req) as ForgeBitbucketEvent;

    if (payload.selfGenerated) {
      return res.json({ ok: true, skipped: 'self-generated' });
    }

    const workspaceUuid = normalizeWorkspaceUuid(payload.workspace?.uuid);
    await persistInvocation(ctx, workspaceUuid);
    if (workspaceUuid) {
      await ensureWorkspaceSlug(ctx, workspaceUuid);
    }

    if (payload.eventType === 'avi:bitbucket:created:pullrequest-comment') {
      const { repository, pullrequest, comment } = payload;
      if (!repository?.slug || !pullrequest || !comment) {
        return res.status(400).json({ error: 'Incomplete pullrequest-comment payload' });
      }

      let commentText: string | null = null;
      try {
        const client = await forgeClient(ctx);
        const data = await client.getPullRequestComment(
          `${workspaceUuid}/${repository.slug}`,
          pullrequest.id,
          comment.id,
        );
        commentText = data.content?.raw ?? null;
      } catch (err) {
        log.warn({ err: String(err), commentId: comment.id }, 'Failed to fetch PR comment text');
      }

      const parsed = parseSyntaroCommand(commentText);
      if (!parsed) {
        return res.json({ ok: true, skipped: 'not-a-syntaro-command' });
      }

      let prTitle = pullrequest.title?.value ?? `PR #${pullrequest.id}`;
      let prBody: string | null = null;
      try {
        const client = await forgeClient(ctx);
        const detail = await client.getPullRequestDetail(`${workspaceUuid}/${repository.slug}`, pullrequest.id);
        if (detail.title) prTitle = detail.title;
        prBody = detail.description ?? null;
      } catch (err) {
        log.warn({ err: String(err) }, 'Failed to fetch PR detail');
      }

      const result = await enqueueFixRun(enqueue, ctx, {
        workspace: workspaceUuid!,
        repo: repository.slug,
        repoPrivate: false,
        prNumber: pullrequest.id,
        prTitle,
        prBody,
      });

      const workspaceSlug = workspaceUuid ? await ensureWorkspaceSlug(ctx, workspaceUuid) : workspaceUuid;
      await postPrComment(
        ctx,
        workspaceSlug ?? workspaceUuid!,
        repository.slug,
        pullrequest.id,
        result.enqueued
          ? '🚀 **SYNTARO is working on this pull request.**\n\nA fix run has been dispatched. The bot will push to this branch and update the PR once the fix is ready.'
          : '⚠️ **SYNTARO** — could not dispatch a fix run for this PR (queue unavailable). Please try again later.',
      );
      auditForgeEvent('system', 'forge.pr_command.fix', {
        workspace: workspaceUuid,
        repo: repository.slug,
        prNumber: pullrequest.id,
        enqueued: result.enqueued,
        installationId: ctx.installationId,
      });
      return res.json({ ok: true, enqueued: result.enqueued });
    }

    if (payload.eventType === 'avi:bitbucket:created:pullrequest') {
      const { repository, pullrequest } = payload;
      if (!repository?.slug || !pullrequest) {
        return res.status(400).json({ error: 'Incomplete pullrequest payload' });
      }

      let prTitle = pullrequest.title?.value ?? `PR #${pullrequest.id}`;
      let prBody: string | null = null;
      try {
        const client = await forgeClient(ctx);
        const detail = await client.getPullRequestDetail(`${workspaceUuid}/${repository.slug}`, pullrequest.id);
        if (detail.title) prTitle = detail.title;
        prBody = detail.description ?? null;
      } catch (err) {
        log.warn({ err: String(err) }, 'Failed to fetch PR detail');
      }

      if (!prBody?.includes(config.syntaro.label)) {
        return res.json({ ok: true, skipped: 'no-syntaro-marker' });
      }

      const result = await enqueueFixRun(enqueue, ctx, {
        workspace: workspaceUuid!,
        repo: repository.slug,
        repoPrivate: false,
        prNumber: pullrequest.id,
        prTitle,
        prBody,
      });
      auditForgeEvent('system', 'forge.pr_marker.fix', {
        workspace: workspaceUuid,
        repo: repository.slug,
        prNumber: pullrequest.id,
        enqueued: result.enqueued,
        installationId: ctx.installationId,
      });
      return res.json({ ok: true, enqueued: result.enqueued });
    }

    log.debug({ eventType: payload.eventType }, 'Ignoring unhandled Forge event');
    return res.json({ ok: true, skipped: 'unhandled-event' });
  });

  router.post('/lifecycle', async (req: ForgeRequest, res: Response) => {
    const ctx = req.forge!;
    const payload = parseBody(req) as ForgeLifecycleEvent;
    await persistInvocation(ctx);
    log.info(
      { installationId: ctx.installationId, appId: ctx.appId, lifecycleId: payload.id },
      'Forge lifecycle event — installation registered',
    );
    auditForgeEvent('system', 'forge.lifecycle.installed', {
      installationId: ctx.installationId,
      appId: ctx.appId,
    });
    return res.json({ ok: true });
  });

  router.post('/uninstall', async (req: ForgeRequest, res: Response) => {
    const ctx = req.forge!;
    await bitbucketForgeInstallationRepository.delete(ctx.installationId);
    log.info({ installationId: ctx.installationId }, 'Forge preUninstall — installation removed');
    auditForgeEvent('system', 'forge.lifecycle.uninstalled', {
      installationId: ctx.installationId,
    });
    return res.json({ ok: true });
  });

  router.post('/token-refresh', async (req: ForgeRequest, res: Response) => {
    const ctx = req.forge!;
    await persistInvocation(ctx);
    return res.json({ ok: true, tokenExpiresAt: ctx.systemTokenExpiresAt?.toISOString() ?? null });
  });

  return router;
}
