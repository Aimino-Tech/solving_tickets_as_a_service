import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { runsRepository } from '../db/repositories/index.js';
import { runFeedbackRepository } from '../db/repositories/RunFeedbackRepository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'feedback-routes' });

const router: Router = Router();

router.use(requireAuth);

const GITHUB_API_BASE = 'https://api.github.com';

router.post('/runs/:id/feedback', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const { verdict, comment } = req.body as {
      verdict?: 'good' | 'bad_fix' | 'not_working';
      comment?: string;
    };

    if (!verdict || !['good', 'bad_fix', 'not_working'].includes(verdict)) {
      res.status(400).json({ error: 'verdict must be one of: good, bad_fix, not_working' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const feedback = await runFeedbackRepository.create({
      runId: String(runId),
      userId: req.user!.id,
      verdict,
      comment: comment ?? null,
      feedbackType: 'user',
    });

    log.info({ runId, verdict, userId: req.user!.id }, 'Run feedback recorded');

    if (verdict === 'bad_fix' || verdict === 'not_working') {
      try {
        const tokenRow = await getGithubToken();
        if (tokenRow && run.issueNumber) {
          const repoInfo = run.repoId ? await getRepoInfo(run.repoId) : null;
          if (repoInfo) {
            await postGithubComment(
              repoInfo.owner, repoInfo.name, run.issueNumber,
              `## Re-analysis triggered\n\nUser reported this fix as "${verdict}". STAS will re-analyze with an adjusted approach.\n\n${comment ? `> ${comment}` : ''}`,
              tokenRow,
            );
          }
        }
      } catch (retryErr) {
        log.error({ err: String(retryErr), runId }, 'Failed to post feedback comment');
      }
    }

    res.json({ feedback });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to record feedback');
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

router.get('/runs/:id/feedback', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const feedback = await runFeedbackRepository.findByRunId(runId);
    res.json({ feedback });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to list feedback');
    res.status(500).json({ error: 'Failed to list feedback' });
  }
});

router.post('/runs/:id/escalate', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const { reason } = req.body as { reason?: string };
    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    await runsRepository.update(runId, { status: 'escalated', error: reason });

    await runFeedbackRepository.create({
      runId: String(runId),
      userId: req.user!.id,
      verdict: 'bad_fix',
      comment: reason,
      feedbackType: 'escalation',
      metadata: { escalatedBy: req.user!.id, escalationReason: reason },
    });

    log.warn({ runId, userId: req.user!.id, reason }, 'Run escalated to STAS team');

    if (run.issueNumber) {
      const tokenRow = await getGithubToken();
      if (tokenRow) {
        const repoInfo = run.repoId ? await getRepoInfo(run.repoId) : null;
        if (repoInfo) {
          await postGithubComment(
            repoInfo.owner, repoInfo.name, run.issueNumber,
            `## Escalated to STAS Team\n\nThis issue has been escalated to the STAS team for manual review.\n\n**Reason:** ${reason}\n\nA STAS operator will review and respond shortly.`,
            tokenRow,
          );
        }
      }
    }

    res.json({ success: true, status: 'escalated' });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to escalate run');
    res.status(500).json({ error: 'Failed to escalate run' });
  }
});

router.post('/runs/:id/rollback', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const { reason } = req.body as { reason?: string };
    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (!run.prUrl) {
      res.status(400).json({ error: 'No PR associated with this run to rollback' });
      return;
    }

    const tokenRow = await getGithubToken();
    if (!tokenRow) {
      res.status(401).json({ error: 'GitHub not connected — cannot rollback PR' });
      return;
    }

    const prUrl = run.prUrl;
    const prMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!prMatch) {
      res.status(400).json({ error: 'Could not parse PR URL' });
      return;
    }

    const [, owner, repo, prNumber] = prMatch;
    const closeRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenRow}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'stas-bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: 'closed' }),
    });

    if (!closeRes.ok) {
      log.error({ status: closeRes.status, prUrl }, 'Failed to close PR');
      res.status(closeRes.status).json({ error: 'Failed to close PR' });
      return;
    }

    await runsRepository.update(runId, { status: 'rolled_back', error: reason });

    await runFeedbackRepository.create({
      runId: String(runId),
      userId: req.user!.id,
      verdict: 'bad_fix',
      comment: reason,
      feedbackType: 'rollback',
      metadata: { prUrl, prNumber, rolledBackBy: req.user!.id },
    });

    if (run.issueNumber) {
      await postGithubComment(
        owner, repo, run.issueNumber,
        `## PR Rolled Back\n\nThe PR for this fix has been closed.\n\n**Reason:** ${reason}\n\nPR: [#${prNumber}](${prUrl})`,
        tokenRow,
      );
    }

    log.info({ runId, prUrl, userId: req.user!.id }, 'PR rolled back');
    res.json({ success: true, status: 'rolled_back', prUrl });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to rollback run');
    res.status(500).json({ error: 'Failed to rollback run' });
  }
});

async function getGithubToken(): Promise<string | null> {
  try {
    const { queryWithRetry } = await import('../db/connection.js');
    const tokenRow = await queryWithRetry<{ access_token_encrypted: string }>(
      'SELECT access_token_encrypted FROM github_oauth_tokens LIMIT 1',
    );
    return tokenRow.rows[0]?.access_token_encrypted ?? null;
  } catch {
    return null;
  }
}

async function getRepoInfo(repoId: number): Promise<{ owner: string; name: string } | null> {
  try {
    const { reposRepository } = await import('../db/repositories/index.js');
    const repo = await reposRepository.findById(repoId);
    return repo ? { owner: repo.owner, name: repo.name } : null;
  } catch {
    return null;
  }
}

async function postGithubComment(owner: string, repo: string, issueNumber: number, body: string, token: string): Promise<void> {
  try {
    await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'stas-bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });
  } catch (err) {
    log.warn({ err: String(err), owner, repo, issueNumber }, 'Failed to post GitHub comment');
  }
}

export { router as feedbackRouter };
