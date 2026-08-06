import { getRunStatus } from '../services/osyDispatch.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';

const log = rootLogger.child({ module: 'run-completion' });

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 60;
const TERMINAL_STATUSES = new Set(['completed', 'success', 'failed', 'error', 'cancelled']);

async function recordCompletion(
  data: IssueJobData,
  osStatus: string,
  prUrl?: string,
): Promise<void> {
  try {
    const { queryWithRetry } = await import('../db/connection.js');
    const isFailed = osStatus === 'failed' || osStatus === 'error' || osStatus === 'cancelled';
    const result = await queryWithRetry<{ id: number }>(
      `UPDATE run_history
       SET status = $1,
           pr_url = COALESCE($2, pr_url),
           duration_ms = COALESCE(duration_ms, ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000)::bigint),
           updated_at = NOW()
       WHERE installation_id = $3 AND repo_owner = $4 AND repo_name = $5 AND issue_number = $6
         AND status = 'running'
       RETURNING id`,
      [isFailed ? 'failed' : 'completed', prUrl ?? null, data.installationId ?? 0, data.repoOwner, data.repoName, data.issueNumber],
    );
    if (result.rows.length > 0) {
      log.info(
        { runId: result.rows[0].id, status: isFailed ? 'failed' : 'completed', prUrl },
        'Run completion recorded from OpenSymphony',
      );
    }
    if (data._meta?.ticketId) {
      try {
        const { ticketsRepository } = await import('../db/repositories/index.js');
        await ticketsRepository.updateStatus(data._meta.ticketId, isFailed ? 'failed' : 'fixed', prUrl);
      } catch (ticketErr) {
        log.warn({ err: String(ticketErr), ticketId: data._meta.ticketId }, 'Failed to finalize ticket status');
      }
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to record run completion');
  }
}

export function startRunCompletionPoll(runId: string, data: IssueJobData): void {
  if (!runId) return;
  let polls = 0;
  const timer = setInterval(async () => {
    polls += 1;
    try {
      const status = await getRunStatus(runId);
      if (status && TERMINAL_STATUSES.has(status.status)) {
        clearInterval(timer);
        await recordCompletion(data, status.status, status.prUrl);
        return;
      }
    } catch (err) {
      log.warn({ err: String(err), runId }, 'Run completion poll error');
    }
    if (polls >= MAX_POLLS) {
      clearInterval(timer);
      log.info({ runId }, 'Run completion poll timed out — leaving run as running');
    }
  }, POLL_INTERVAL_MS);
  timer.unref?.();
}
