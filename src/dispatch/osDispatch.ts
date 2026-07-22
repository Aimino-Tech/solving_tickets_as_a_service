import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import { createSlackProgressSender } from '../channels/slack/progressSender.js';

const log = rootLogger.child({ module: 'os-dispatch' });

let _slackSender: ReturnType<typeof createSlackProgressSender> | null = null;

function getSlackSender() {
  if (!_slackSender) {
    _slackSender = createSlackProgressSender();
  }
  return _slackSender;
}

async function sendSlackProgress(
  data: IssueJobData,
  phase: import('../channels/base.js').ProgressPhase,
  detail?: string,
  prUrl?: string,
): Promise<void> {
  if (!data.slackChannel) return;
  const channelTarget = data.slackThreadTs
    ? `${data.slackChannel}:${data.slackThreadTs}`
    : data.slackChannel;
  await getSlackSender().sendProgress({
    channel: 'slack',
    channelTarget,
    runId: data.trackerTicketId || `gh-${data.issueNumber}`,
    phase,
    message: detail || phase,
    detail,
    timestamp: new Date().toISOString(),
    prUrl,
  });
}

export interface DispatchResult {
  success: boolean;
  runId?: string;
  summary?: string;
  prUrl?: string;
  errors?: string[];
}

export async function dispatchToOpenSymphony(data: IssueJobData): Promise<DispatchResult> {
  const osUrl = config.opensymphony?.dispatchUrl;
  if (!osUrl) {
    log.error('OPEN_SYMPHONY_DISPATCH_URL not configured — cannot dispatch');
    await sendSlackProgress(data, 'error', 'OpenSymphony dispatch URL not configured');
    return { success: false, errors: ['OpenSymphony dispatch URL not configured'] };
  }

  const apiKey = config.opensymphony?.apiKey;
  const tenant = config.opensymphony?.tenant || 'default';

  const payload = {
    issue_id: data.trackerTicketId || `gh-${data.issueNumber}`,
    repo: `${data.repoOwner}/${data.repoName}`,
    tenant,
    title: data.issueTitle,
    body: data.issueBody,
    labels: data.labels,
    source: data.source || 'github',
    slack_channel: data.slackChannel,
    slack_thread_ts: data.slackThreadTs,
    tracker_type: data.trackerType,
    tracker_ticket_id: data.trackerTicketId,
    installation_id: data.installationId,
  };

  await sendSlackProgress(data, 'queued', `Dispatched: "${data.issueTitle}"`);

  try {
    log.info({ osUrl, repo: payload.repo }, 'Dispatching to OpenSymphony');
    await sendSlackProgress(data, 'investigating', 'Agent is analyzing the issue...');

    const response = await fetch(osUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      log.error({ status: response.status, error: errorText }, 'OpenSymphony dispatch failed');
      await sendSlackProgress(data, 'failed', `HTTP ${response.status}: ${errorText}`);
      return { success: false, errors: [`HTTP ${response.status}: ${errorText}`] };
    }

    const result = (await response.json()) as Record<string, unknown>;
    const runId = String(result.run_id || '');
    const prUrl = result.pr_url ? String(result.pr_url) : undefined;

    log.info({ runId, prUrl }, 'OpenSymphony dispatch accepted');

    if (prUrl) {
      await sendSlackProgress(data, 'pr_created', 'Pull request created', prUrl);
    } else {
      await sendSlackProgress(data, 'verifying', 'Fix submitted for verification...');
    }

    return {
      success: true,
      runId,
      summary: String(result.summary || 'Dispatched to OpenSymphony'),
      prUrl,
    };
  } catch (err) {
    log.error({ err: String(err) }, 'OpenSymphony dispatch error');
    await sendSlackProgress(data, 'error', String(err));
    return { success: false, errors: [String(err)] };
  }
}
