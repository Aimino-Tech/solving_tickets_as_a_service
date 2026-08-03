import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { getTracker } from '../trackers/index.js';
import { getOctokit } from '../github/auth.js';

const log = rootLogger.child({ module: 'linear-to-github' });

const recentTickets = new Map<string, number>();

const DEBOUNCE_MS = 5_000;

function isDebounced(ticketId: string): boolean {
  const last = recentTickets.get(ticketId);
  const now = Date.now();
  if (last && now - last < DEBOUNCE_MS) {
    return true;
  }
  recentTickets.set(ticketId, now);
  if (recentTickets.size > 1_000) {
    const cutoff = now - DEBOUNCE_MS;
    for (const [key, ts] of recentTickets) {
      if (ts < cutoff) recentTickets.delete(key);
    }
  }
  return false;
}

export async function handleLinearFixLabel(
  ticketId: string,
): Promise<{ issueNumber: number; repoOwner: string; repoName: string } | null> {
  const tracker = getTracker('linear');
  if (!tracker) {
    log.error('Linear tracker not configured — LINEAR_API_KEY missing');
    return null;
  }

  const ticket = await tracker.getTicket(ticketId);

  const fixLabel = config.syntaro.label;
  const hasLabel = ticket.labels?.some(
    (l) => l.toLowerCase() === fixLabel.toLowerCase(),
  );
  if (!hasLabel) {
    log.debug({ ticketId }, 'Ticket does not have syntaro:fix label — skipping');
    return null;
  }

  const repoOwner = config.trackers?.defaultRepoOwner;
  const repoName = config.trackers?.defaultRepoName;
  const installationId = config.trackers?.installationId;

  if (!repoOwner || !repoName || !installationId) {
    const msg = 'GitHub repo not configured. Set TRACKER_DEFAULT_REPO_OWNER, TRACKER_DEFAULT_REPO_NAME, and TRACKER_INSTALLATION_ID.';
    log.error({ ticketId, repoOwner, repoName, installationId }, msg);
    await tracker.postComment(
      ticketId,
      `❌ **GitHub repo not configured.**\n\nSet \`TRACKER_DEFAULT_REPO_OWNER\` and \`TRACKER_DEFAULT_REPO_NAME\` and \`TRACKER_INSTALLATION_ID\` environment variables to enable automatic GitHub issue creation.`,
    );
    return null;
  }

  if (isDebounced(ticketId)) {
    log.debug({ ticketId }, 'Ticket already processed recently — debouncing');
    return null;
  }

  try {
    const octokit = await getOctokit(installationId);

    const issue = await octokit.issues.create({
      owner: repoOwner,
      repo: repoName,
      title: ticket.title,
      body: [
        `**Linear ticket**: ${ticket.url}`,
        '',
        ticket.description || '',
        '',
        '---',
        `_Automatically created from Linear ticket ${ticketId}_`,
      ].join('\n'),
    });

    await octokit.issues.addLabels({
      owner: repoOwner,
      repo: repoName,
      issue_number: issue.data.number,
      labels: [fixLabel],
    });

    try {
      await tracker.createLink(
        ticketId,
        issue.data.html_url,
        `GitHub Issue #${issue.data.number}`,
      );
    } catch {
      log.warn({ ticketId }, 'Failed to create attachment link on Linear ticket');
    }

    log.info(
      { ticketId, issueNumber: issue.data.number, repoOwner, repoName },
      'GitHub issue created from Linear ticket',
    );

    return { issueNumber: issue.data.number, repoOwner, repoName };
  } catch (err) {
    const errorMsg = `Failed to create GitHub issue: ${err instanceof Error ? err.message : String(err)}`;
    log.error({ err: String(err), ticketId }, errorMsg);

    try {
      await tracker.postComment(ticketId, `❌ **${errorMsg}**`);
    } catch {
      log.warn({ ticketId }, 'Failed to post error comment on Linear ticket');
    }

    return null;
  }
}
