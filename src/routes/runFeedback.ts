import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { sessionStore } from '../pipeline/sessionOrchestrator.js';

const log = rootLogger.child({ module: 'run-feedback' });
const router: Router = Router();
router.use(requireAuth);

interface RunRow {
  id: number;
  status: string;
  pr_url: string | null;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  installation_id: number | null;
  summary: string | null;
}

interface FeedbackRow {
  id: number;
  run_id: number;
  user_id: number | null;
  verdict: string;
  comment: string | null;
  action_taken: string | null;
  created_at: string;
}

async function getRun(runId: number): Promise<RunRow | undefined> {
  const rh = await queryWithRetry<RunRow>(
    `SELECT id, status, pr_url, repo_owner, repo_name, issue_number, installation_id, summary
     FROM run_history WHERE id = $1`,
    [runId],
  );
  if (rh.rows[0]) return rh.rows[0];
  const legacy = await queryWithRetry<RunRow>(
    'SELECT id, status, pr_url, repo_owner, repo_name, issue_number, installation_id, summary FROM runs WHERE id = $1',
    [runId],
  );
  return legacy.rows[0];
}

async function requeueFix(run: RunRow): Promise<void> {
  try {
    if (!run.installation_id) return;
    const { dispatchToOpenSymphony } = await import('../dispatch/osDispatch.js');
    const result = await dispatchToOpenSymphony({
      installationId: run.installation_id,
      repoOwner: run.repo_owner,
      repoName: run.repo_name,
      repoPrivate: false,
      issueNumber: run.issue_number,
      issueTitle: run.summary || `Re-fix ${run.repo_owner}/${run.repo_name}#${run.issue_number}`,
      issueBody: null,
      labels: [],
      source: 'github',
    });
    if (result.success) {
      log.info({ runId: run.id, osRunId: result.runId }, 'Re-analysis fix re-dispatched to OpenSymphony');
    } else {
      log.warn({ runId: run.id, errors: result.errors }, 'Re-analysis re-dispatch failed');
    }
  } catch (err) {
    log.warn({ err: String(err), runId: run.id }, 'Re-analysis re-dispatch error');
  }
}

async function getGitHubToken(): Promise<string | null> {
  const auth = await import('../github/auth.js');
  if (!config.github.appId || !config.github.privateKeyEnv) return null;
  try {
    const appAuth = auth.createAuth({ appId: config.github.appId, privateKey: config.github.privateKeyEnv });
    const { token } = await appAuth({ type: 'app' });
    return token;
  } catch {
    return null;
  }
}

async function postIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  const installationsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'syntaro-bot' },
  });
  if (!installationsResponse.ok) return;
  const instData = (await installationsResponse.json()) as { id: number };
  const instTokenResponse = await fetch(`https://api.github.com/app/installations/${instData.id}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'syntaro-bot' },
  });
  if (!instTokenResponse.ok) return;
  const { token: instToken } = (await instTokenResponse.json()) as { token: string };
  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${instToken}`, 'Content-Type': 'application/json', 'User-Agent': 'syntaro-bot' },
    body: JSON.stringify({ body }),
  });
}

router.post('/:id/feedback', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const { verdict, comment } = req.body as { verdict?: string; comment?: string };
    if (!verdict || !['good', 'bad_fix', 'not_working'].includes(verdict)) {
      res.status(400).json({ error: 'verdict must be one of: good, bad_fix, not_working' });
      return;
    }
    const run = await getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const result = await queryWithRetry<FeedbackRow>(
      `INSERT INTO run_feedback (run_id, user_id, verdict, comment, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [runId, req.user!.id, verdict, comment || null],
    );
    await queryWithRetry(
      'UPDATE runs SET feedback_verdict = $1 WHERE id = $2',
      [verdict, runId],
    );
    if (verdict === 'bad_fix' || verdict === 'not_working') {
      const reanalysisComment = `## SYNTARO Re-analysis Triggered\n\nYou reported this fix as **"${verdict === 'bad_fix' ? 'Bad Fix' : 'Not Working'}"**. SYNTARO will re-analyze the issue with an adjusted approach.\n\n${comment ? `> ${comment}\n\n` : ''}*Re-analysis in progress — a new PR will be created.*`;
      await postIssueComment(run.repo_owner, run.repo_name, run.issue_number, reanalysisComment);
      await requeueFix(run);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to submit feedback');
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

router.get('/:id/feedback', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const result = await queryWithRetry<FeedbackRow>(
      'SELECT * FROM run_feedback WHERE run_id = $1 ORDER BY created_at DESC',
      [runId],
    );
    res.json({ feedback: result.rows });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to fetch feedback');
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

router.post('/:id/escalate', async (req: Request, res: Response) => {
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
    const run = await getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    await queryWithRetry(
      'UPDATE runs SET status = $1, escalated_at = NOW() WHERE id = $2',
      ['escalated', runId],
    );
    await queryWithRetry<FeedbackRow>(
      `INSERT INTO run_feedback (run_id, user_id, verdict, comment, action_taken, created_at)
       VALUES ($1, $2, 'escalate', $3, 'escalated', NOW())`,
      [runId, req.user!.id, reason],
    );
    const escalationComment = `## SYNTARO Escalation\n\nThis issue has been **escalated to the SYNTARO team** for manual review.\n\n**Reason:** ${reason}\n\nA human operator will review this issue shortly.`;
    await postIssueComment(run.repo_owner, run.repo_name, run.issue_number, escalationComment);
    res.json({ success: true, message: 'Issue escalated to SYNTARO team' });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to escalate');
    res.status(500).json({ error: 'Failed to escalate' });
  }
});

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const run = await getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (run.status === 'completed' || run.status === 'failed') {
      res.status(400).json({ error: `Cannot cancel a ${run.status} run` });
      return;
    }
    await queryWithRetry(
      "UPDATE runs SET status = 'cancelled' WHERE id = $1",
      [runId],
    );
    const sessions = sessionStore.list({ issueId: String(run.issue_number) });
    for (const session of sessions) {
      sessionStore.delete(session.sessionId);
    }
    const cancelComment = `## SYNTARO Fix Cancelled\n\nThe automated fix for this issue has been **cancelled** as you requested.\n\nIf you'd like SYNTARO to try again, re-label the issue with the appropriate label.`;
    await postIssueComment(run.repo_owner, run.repo_name, run.issue_number, cancelComment);
    res.json({ success: true, message: 'Run cancelled' });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to cancel run');
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

router.post('/:id/rollback', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const { reason } = req.body as { reason?: string; auto_revert?: boolean };
    const run = await getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (!run.pr_url) {
      res.status(400).json({ error: 'No PR associated with this run' });
      return;
    }
    if (run.status !== 'completed') {
      res.status(400).json({ error: 'Can only rollback completed runs' });
      return;
    }
    await queryWithRetry(
      'UPDATE runs SET status = $1, rolled_back_at = NOW() WHERE id = $2',
      ['rolled_back', runId],
    );
    await queryWithRetry<FeedbackRow>(
      `INSERT INTO run_feedback (run_id, user_id, verdict, comment, action_taken, created_at)
       VALUES ($1, $2, 'bad_fix', $3, 'rolled_back', NOW())`,
      [runId, req.user!.id, reason || 'Rollback requested'],
    );
    if (req.body.auto_revert !== false) {
      const prUrlParts = run.pr_url.match(/\/repos?\/([^/]+)\/([^/]+)\/pulls?\/(\d+)/);
      if (prUrlParts) {
        const [, owner, repo, prNumber] = prUrlParts;
        try {
          const token = await getGitHubToken();
          if (token) {
            await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', 'User-Agent': 'syntaro-bot' },
              body: JSON.stringify({ state: 'closed' }),
            });
          }
        } catch {
          log.warn({ prUrl: run.pr_url }, 'Failed to close PR during rollback');
        }
      }
    }
    const rollbackComment = `## SYNTARO Rollback\n\nThe fix for this issue has been **rolled back**.${reason ? `\n\n**Reason:** ${reason}` : ''}\n\nThe associated PR has been closed.`;
    await postIssueComment(run.repo_owner, run.repo_name, run.issue_number, rollbackComment);
    res.json({ success: true, message: 'Run rolled back' });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to rollback');
    res.status(500).json({ error: 'Failed to rollback' });
  }
});

export { router as runFeedbackRouter };
