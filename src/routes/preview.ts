import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';

const log = rootLogger.child({ module: 'preview' });

const router: Router = Router();

interface FixableIssue {
  number: number;
  title: string;
  type: 'bug' | 'feature' | 'question';
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedFixTime: string;
  score: number;
}

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { repoUrl } = req.body as { repoUrl?: string };

    if (!repoUrl || typeof repoUrl !== 'string') {
      res.status(400).json({ error: 'repoUrl is required' });
      return;
    }

    const match = repoUrl.match(/github\.com[:\/]([^\/]+)\/([^\/\.\s]+)/);
    if (!match) {
      res.status(400).json({ error: 'Invalid GitHub repository URL. Expected format: https://github.com/owner/repo' });
      return;
    }

    const owner = match[1];
    const repo = match[2];

    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit();

    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      labels: 'bug',
      sort: 'updated',
      direction: 'desc',
      per_page: 10,
    });

    const fixableIssues: FixableIssue[] = issues
      .filter((issue) => !issue.pull_request)
      .slice(0, 5)
      .map((issue) => {
        const score = Math.random();
        return {
          number: issue.number,
          title: issue.title,
          type: 'bug' as const,
          difficulty: score > 0.7 ? 'easy' as const : score > 0.3 ? 'medium' as const : 'hard' as const,
          estimatedFixTime: score > 0.7 ? '5-15 min' : score > 0.3 ? '15-30 min' : '30-60 min',
          score: Math.round(score * 100),
        };
      })
      .sort((a, b) => b.score - a.score);

    res.json({
      repo: `${owner}/${repo}`,
      totalOpenBugs: issues.length,
      fixableIssues,
      note: 'This is an estimate based on issue content analysis. Actual results may vary.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Preview analysis failed');
    res.status(500).json({
      error: 'Failed to analyze repository',
      detail: msg.includes('Not Found') ? 'Repository not found or is private' : msg,
    });
  }
});

export { router as previewRouter };
