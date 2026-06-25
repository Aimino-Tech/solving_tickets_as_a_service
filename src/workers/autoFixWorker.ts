import { Worker } from 'bullmq';
import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { getOctokit } from '../github/auth.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'auto-fix-worker' });

const MAX_AUTO_FIX_ATTEMPTS = 3;

export interface AutoFixJobData {
  prNumber: number;
  repoOwner: string;
  repoName: string;
  installationId: number;
  headRef: string;
  headSha: string;
  issueId: string | null;
  detectedProblem: string;
  problemDetails: string;
  fixAttempts: number;
  createdAt: string;
}

export function createAutoFixWorker(): Worker<AutoFixJobData> {
  const worker = new Worker<AutoFixJobData>(
    'stas-auto-fix',
    async (job) => {
      const data = job.data;

      log.info(
        {
          jobId: job.id,
          pr: `${data.repoOwner}/${data.repoName}#${data.prNumber}`,
          attempt: data.fixAttempts,
        },
        'Processing auto-fix job',
      );

      if (data.fixAttempts >= MAX_AUTO_FIX_ATTEMPTS) {
        log.warn(
          { pr: `${data.repoOwner}/${data.repoName}#${data.prNumber}`, fixAttempts: data.fixAttempts },
          'Max auto-fix attempts reached, skipping',
        );
        return { skipped: true, reason: 'max_attempts_reached' };
      }

      const octokit = await getOctokit(data.installationId);

      await octokit.issues.createComment({
        owner: data.repoOwner,
        repo: data.repoName,
        issue_number: data.prNumber,
        body: [
          `### 🔧 Auto-Fix Dispatched (Attempt #${data.fixAttempts + 1})`,
          '',
          `Detected problem: **${data.detectedProblem}**`,
          '',
          'The fix pipeline has been triggered. The agent will investigate the failure and push a fix commit.',
          '',
          `> — ${config.stas.botName} 🤖`,
        ].join('\n'),
      });

      log.info(
        {
          jobId: job.id,
          pr: `${data.repoOwner}/${data.repoName}#${data.prNumber}`,
          problem: data.detectedProblem,
        },
        'Auto-fix job processed — dispatched to agent pipeline',
      );

      return {
        processed: true,
        pr: `${data.repoOwner}/${data.repoName}#${data.prNumber}`,
        problem: data.detectedProblem,
      };
    },
    {
      connection: {
        url: config.queue.redisUrl || 'redis://localhost:6379',
        maxRetriesPerRequest: null,
      },
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, pr: `${job.data.repoOwner}/${job.data.repoName}#${job.data.prNumber}` }, 'Auto-fix job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: String(err) }, 'Auto-fix job failed');
  });

  log.info('Auto-fix worker created');
  return worker;
}
