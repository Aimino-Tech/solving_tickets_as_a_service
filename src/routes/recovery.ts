import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../security/authMiddleware.js';
import { runFeedbackRepository } from '../db/repositories/RunFeedbackRepository.js';
import { runsRepository } from '../db/repositories/RunsRepository.js';
import { rootLogger } from '../utils/logger.js';
import { Octokit } from '@octokit/rest';

const log = rootLogger.child({ module: 'recovery' });
const router: Router = Router();

function getOctokit(): Octokit {
  return new Octokit({ auth: config.github.token });
}

async function commentOnIssue(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
  const octokit = getOctokit();
  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}

router.post('/runs/:id/feedback', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const { verdict, comment, triggerReanalysis, feedbackType } = req.body;

    const feedback = await runFeedbackRepository.create({
      runId: String(runId),
      userId: req.user!.id,
      verdict: verdict ?? 'bad_fix',
      comment: comment ?? null,
      feedbackType: feedbackType ?? 'user',
    });

    if (triggerReanalysis) {
      const { reposRepository } = await import('../db/repositories/ReposRepository.js');
      const repo = run.repoId ? await reposRepository.findById(run.repoId) : null;
      if (repo) {
        await commentOnIssue(repo.owner, repo.name, run.issueNumber!, [
          '## Re-analysis Triggered',
          '',
          'A re-analysis has been triggered based on your feedback.',
          comment ? '> ' + comment : '',
          '',
          'The agent will retry with an adjusted approach.',
        ].join('\n'));

        const { dispatchFullPipeline } = await import('../dispatch/celeryDispatcher.js');
        await dispatchFullPipeline({
          repoOwner: repo.owner,
          repoName: repo.name,
          repoPrivate: false,
          installationId: 0,
          issueNumber: run.issueNumber!,
          issueTitle: 'Re-analysis of #' + run.issueNumber,
          issueBody: 'Re-analysis triggered from user feedback',
        } as any);
      }
    }

    res.status(201).json(feedback);
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to submit feedback');
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

router.get('/runs/:id/feedback', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const feedback = await runFeedbackRepository.findByRunId(runId);
    res.json(feedback);
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to get feedback');
    res.status(500).json({ error: 'Failed to get feedback' });
  }
});

router.post('/runs/:id/rollback', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (!run.prUrl) {
      res.status(400).json({ error: 'No PR associated with this run' });
      return;
    }

    const prUrl = new URL(run.prUrl);
    const pathParts = prUrl.pathname.split('/');
    const owner = pathParts[1];
    const repo = pathParts[2];

    const octokit = getOctokit();
    const prData = await octokit.pulls.get({ owner, repo, pull_number: run.issueNumber! });

    const revertRef = 'revert/' + (run.branchName || prData.data.head.ref);
    await octokit.git.createRef({
      owner,
      repo,
      ref: 'refs/heads/' + revertRef,
      sha: prData.data.merge_commit_sha!,
    });

    const revertPr = await octokit.pulls.create({
      owner,
      repo,
      title: 'Revert: ' + prData.data.title,
      head: revertRef,
      base: prData.data.base.ref,
      body: [
        '## Automatic Revert',
        '',
        'This PR reverts the changes from #' + prData.data.number + '.',
        '',
        '**Reason**: User requested rollback of a fix.',
        '',
        '**Original PR**: ' + run.prUrl,
      ].join('\n'),
    });

    await runFeedbackRepository.create({
      runId: String(runId),
      userId: req.user!.id,
      verdict: 'bad_fix',
      feedbackType: 'rollback',
    });

    await runsRepository.update(runId, {
      status: 'reverted',
      revertPrUrl: revertPr.data.html_url,
      revertedAt: new Date(),
    } as any);

    log.info({ runId, revertPrUrl: revertPr.data.html_url }, 'Rollback PR created');

    res.json({
      success: true,
      revertPrUrl: revertPr.data.html_url,
      revertPrNumber: revertPr.data.number,
    });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to rollback');
    res.status(500).json({ error: 'Failed to rollback: ' + String(err) });
  }
});

router.post('/runs/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (run.status !== 'running' && run.status !== 'queued') {
      res.status(400).json({ error: 'Cannot cancel run with status ' + run.status });
      return;
    }

    const reason = req.body?.reason ?? 'User requested cancellation';

    await runsRepository.update(runId, {
      status: 'cancelled',
      cancelReason: reason,
      cancelledAt: new Date(),
    } as any);

    if (run.repoId && run.issueNumber) {
      const { reposRepository } = await import('../db/repositories/ReposRepository.js');
      const repo = await reposRepository.findById(run.repoId);
      if (repo) {
        await commentOnIssue(repo.owner, repo.name, run.issueNumber, [
          '## Fix Cancelled',
          '',
          'The automatic fix for this issue has been cancelled.',
          reason ? '> ' + reason : '',
          '',
          'No further action will be taken. You can trigger a new fix by re-labeling the issue.',
        ].join('\n'));
      }
    }

    log.info({ runId, reason }, 'Run cancelled');
    res.json({ success: true, status: 'cancelled' });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to cancel run');
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

export { router as recoveryRouter };
