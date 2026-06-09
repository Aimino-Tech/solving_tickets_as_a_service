import type { AgentResult } from '../agent/types.js';
import { getTracker } from './index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'tracker-writeback' });

export interface WriteBackParams {
  trackerType: 'linear' | 'jira';
  trackerTicketId: string;
  agentResult: AgentResult;
  prUrl?: string;
  prNumber?: number;
}

export async function writeBack(params: WriteBackParams): Promise<void> {
  const tracker = getTracker(params.trackerType);
  if (!tracker) return;

  const { trackerTicketId, agentResult, prUrl, prNumber } = params;

  try {
    if (agentResult.fixReady && agentResult.confidence === 'high' && prUrl) {
      await tracker.updateStatus(trackerTicketId, 'In Review');
      await tracker.postComment(
        trackerTicketId,
        `✅ **Fix PR Created**: [#${prNumber}](${prUrl})\n\nConfidence: High\n\n> Automated by STAS`,
      );
    } else if (agentResult.fixReady && agentResult.confidence === 'medium' && prUrl) {
      await tracker.updateStatus(trackerTicketId, 'In Review');
      await tracker.postComment(
        trackerTicketId,
        `✏️ **Draft PR Created**: [#${prNumber}](${prUrl})\n\nConfidence: Medium — needs human review\n\n> Automated by STAS`,
      );
    } else {
      await tracker.updateStatus(trackerTicketId, 'Backlog');
      await tracker.postComment(
        trackerTicketId,
        `❌ **Fix Failed**: ${agentResult.noFixReason || agentResult.summary || 'Unknown error'}\n\n> Automated by STAS`,
      );
    }
  } catch (err) {
    log.warn({ err: String(err), trackerTicketId }, 'Write-back failed (non-fatal)');
  }
}
