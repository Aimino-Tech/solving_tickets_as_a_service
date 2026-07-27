import { getOctokit } from '../github/auth.js';
import { rootLogger } from '../utils/logger.js';
import { createSlackNotifier } from './slack.js';
import type { NotificationData } from './base.js';

const log = rootLogger.child({ module: 'notification-service' });

export async function notifyFixStarted(
  owner: string,
  repo: string,
  issueNumber: number,
  installationId: number,
  issueTitle: string,
): Promise<void> {
  const botName = 'STAS';
  const body = `## 🔍 ${botName} is Investigating\n\n` +
    `${botName} has started working on issue #${issueNumber}: **${issueTitle}**\n\n` +
    `⏳ The agent is analyzing the issue and preparing a fix. You'll be notified when a PR is ready.\n\n` +
    `---\n*Powered by STAS — Solving Tickets As A Service*`;

  try {
    const octokit = await getOctokit(installationId);
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });

    const slackNotifier = createSlackNotifier();
    const data: NotificationData = { repoOwner: owner, repoName: repo, issueNumber, issueTitle };
    await slackNotifier.sendNotification('fix_started', data);
  } catch (err) {
    log.warn({ err: String(err), owner, repo, issueNumber }, 'notifyFixStarted failed');
  }
}

export async function notifyPRCreated(
  owner: string,
  repo: string,
  issueNumber: number,
  installationId: number,
  issueTitle: string,
  prUrl: string,
  prNumber: number,
): Promise<void> {
  const botName = 'STAS';
  const body = `## ✅ ${botName} Created a Fix PR\n\n` +
    `${botName} has created a pull request for issue #${issueNumber}: **${issueTitle}**\n\n` +
    `👉 [Pull Request #${prNumber}](${prUrl})\n\n` +
    `Please review the changes when you have a moment.\n\n` +
    `---\n*Powered by STAS — Solving Tickets As A Service*`;

  try {
    const octokit = await getOctokit(installationId);
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });

    const slackNotifier = createSlackNotifier();
    const data: NotificationData = { repoOwner: owner, repoName: repo, issueNumber, issueTitle, prUrl };
    await slackNotifier.sendNotification('pr_created', data);
  } catch (err) {
    log.warn({ err: String(err), owner, repo, issueNumber }, 'notifyPRCreated failed');
  }
}
