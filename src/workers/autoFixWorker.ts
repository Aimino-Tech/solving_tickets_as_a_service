import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { getOctokit } from '../github/auth.js';
import { rootLogger } from '../utils/logger.js';
import { QUEUES, consumeQueue, connect as rmqConnect, isConnected } from '../queue/rabbitmq.js';

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

export async function startAutoFixConsumer(): Promise<void> {
  if (!isConnected()) {
    await rmqConnect();
  }

  await consumeQueue('stas-auto-fix', async (msg) => {
    if (!msg) return;
    const content = msg.content.toString();
    let data: AutoFixJobData;
    try {
      data = JSON.parse(content) as AutoFixJobData;
    } catch {
      log.error({ content }, 'Failed to parse auto-fix message');
      return;
    }

    log.info(
      {
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
      return;
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
        pr: `${data.repoOwner}/${data.repoName}#${data.prNumber}`,
        problem: data.detectedProblem,
      },
      'Auto-fix job processed — dispatched to agent pipeline',
    );
  });

  log.info('Auto-fix RabbitMQ consumer started');
}
