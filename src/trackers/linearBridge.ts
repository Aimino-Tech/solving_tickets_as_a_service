import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { getOctokit } from '../github/auth.js';
import { LinearTracker } from './linear.js';

const log = rootLogger.child({ module: 'linear-bridge' });

export interface LinearIssueMapping {
  linearTicketId: string;
  githubIssueNumber: number;
  repoOwner: string;
  repoName: string;
}

const ticketMappings = new Map<string, LinearIssueMapping>();

export function validateBridgeConfig(): { repoOwner: string; repoName: string; installationId: number } {
  const repoOwner = config.trackers?.defaultRepoOwner;
  const repoName = config.trackers?.defaultRepoName;
  const installationId = config.trackers?.installationId;
  if (!repoOwner) throw new Error('TRACKER_DEFAULT_REPO_OWNER must be set');
  if (!repoName) throw new Error('TRACKER_DEFAULT_REPO_NAME must be set');
  if (!installationId) throw new Error('TRACKER_INSTALLATION_ID must be set');
  return { repoOwner, repoName, installationId };
}

export async function bridgeLinearTicket(linearTicketId: string): Promise<number | null> {
  const existing = ticketMappings.get(linearTicketId);
  if (existing) {
    log.info({ linearTicketId, githubIssueNumber: existing.githubIssueNumber }, 'Linear ticket already bridged — skipping');
    return existing.githubIssueNumber;
  }

  const { repoOwner, repoName, installationId } = validateBridgeConfig();

  const tracker = new LinearTracker();
  const ticket = await tracker.getTicket(linearTicketId);

  const ticketTitle = ticket.title;
  const ticketDescription = ticket.description ?? '';
  const ticketUrl = ticket.url;

  const octokit = await getOctokit(installationId);
  const body = ticketDescription
    ? `${ticketDescription}\n\n---\n_From Linear: ${ticketUrl}_`
    : `_From Linear: ${ticketUrl}_`;

  const ghIssue = await octokit.issues.create({
    owner: repoOwner,
    repo: repoName,
    title: ticketTitle,
    body,
    labels: [config.syntaro.label],
  });

  const mapping: LinearIssueMapping = {
    linearTicketId,
    githubIssueNumber: ghIssue.data.number,
    repoOwner,
    repoName,
  };
  ticketMappings.set(linearTicketId, mapping);

  log.info({ linearTicketId, githubIssueNumber: ghIssue.data.number }, 'Linear ticket bridged to GitHub issue');

  return ghIssue.data.number;
}

export function getMapping(linearTicketId: string): LinearIssueMapping | undefined {
  return ticketMappings.get(linearTicketId);
}
