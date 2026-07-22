import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import { getSlackProgressSender } from '../channels/slack/progressSender.js';

const log = rootLogger.child({ module: 'os-dispatch' });

export interface DispatchResult {
  success: boolean;
  runId?: string;
  summary?: string;
  prUrl?: string;
  errors?: string[];
}

async function sendSlackProgress(
  data: IssueJobData,
  phase: string,
  message: string,
  prUrl?: string,
): Promise<void> {
  if (!data.slackChannel || !data.slackThreadTs) return;
  const sender = getSlackProgressSender();
  await sender.sendProgress(data.slackChannel, data.slackThreadTs, phase, message, prUrl);
}

async function sendSlackResult(
  data: IssueJobData,
  success: boolean,
  summary: string,
  prUrl?: string,
): Promise<void> {
  if (!data.slackChannel || !data.slackThreadTs) return;
  const sender = getSlackProgressSender();
  await sender.sendResult(data.slackChannel, data.slackThreadTs, success, summary, prUrl);
}

export async function dispatchToOpenSymphony(data: IssueJobData): Promise<DispatchResult> {
  await sendSlackProgress(data, 'queued', 'Fix request received — queuing for dispatch');

  const osUrl = config.opensymphony?.dispatchUrl;
  if (!osUrl) {
    log.error('OPEN_SYMPHONY_DISPATCH_URL not configured — cannot dispatch');
    await sendSlackResult(data, false, 'Dispatch URL not configured — cannot process fix request');
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
    tracker_type: data.trackerType,
    tracker_ticket_id: data.trackerTicketId,
    installation_id: data.installationId,
    slack_channel: data.slackChannel,
    slack_thread_ts: data.slackThreadTs,
  };

  try {
    log.info({ osUrl, repo: payload.repo }, 'Dispatching to OpenSymphony');

    await sendSlackProgress(data, 'investigating', `Analyzing issue in ${data.repoOwner}/${data.repoName}`);

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
      await sendSlackResult(data, false, `Dispatch failed: HTTP ${response.status}`);
      return { success: false, errors: [`HTTP ${response.status}: ${errorText}`] };
    }

    const result = (await response.json()) as Record<string, unknown>;
    log.info({ runId: result.run_id, prUrl: result.pr_url }, 'OpenSymphony dispatch accepted');

    if (result.pr_url) {
      await sendSlackResult(data, true, 'Fix completed successfully', String(result.pr_url));
    } else {
      await sendSlackProgress(data, 'fixing', 'Fix dispatched to agent pipeline');
    }

    return {
      success: true,
      runId: String(result.run_id || ''),
      summary: String(result.summary || 'Dispatched to OpenSymphony'),
      prUrl: result.pr_url ? String(result.pr_url) : undefined,
    };
  } catch (err) {
    log.error({ err: String(err) }, 'OpenSymphony dispatch error');
    await sendSlackResult(data, false, `Dispatch error: ${String(err).slice(0, 200)}`);
    return { success: false, errors: [String(err)] };
  }
}

export async function pollAndReportProgress(
  data: IssueJobData,
  runId: string,
  pollUrl: string,
): Promise<void> {
  if (!data.slackChannel || !data.slackThreadTs) return;

  const sender = getSlackProgressSender();
  const maxPolls = 60;
  const pollIntervalMs = 5000;

  for (let i = 0; i < maxPolls; i++) {
    try {
      const response = await fetch(pollUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) break;

      const status = await response.json() as { status?: string; prUrl?: string; message?: string };
      const phase = status.status || 'unknown';

      if (phase === 'completed' || phase === 'pr_created') {
        await sender.sendResult(data.slackChannel, data.slackThreadTs, true, 'Fix completed successfully', status.prUrl);
        return;
      }
      if (phase === 'failed' || phase === 'error') {
        await sender.sendResult(data.slackChannel, data.slackThreadTs, false, status.message || 'Fix failed');
        return;
      }

      if (i % 6 === 0) {
        await sender.sendProgress(data.slackChannel, data.slackThreadTs, phase, status.message || `Pipeline in progress (${phase})`, status.prUrl);
      }
    } catch {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
