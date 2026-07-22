import { getTracker } from './index.js';
import type { TicketCategory } from '../classifier/ticketClassifier.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'non-code-result' });

export interface NonCodeResultParams {
  ticketId: string;
  category: TicketCategory;
  summary: string;
  details: string;
  evidenceUrls?: string[];
}

export async function postNonCodeResult(
  trackerType: 'linear' | 'jira',
  params: NonCodeResultParams,
): Promise<void> {
  const tracker = getTracker(trackerType);
  if (!tracker) {
    log.warn({ trackerType }, 'No tracker found — cannot post result');
    return;
  }

  const { ticketId, category, summary, details, evidenceUrls } = params;

  const categoryLabels: Record<string, string> = {
    code: 'Code',
    research: 'Research',
    design: 'Design',
    content: 'Content',
    process: 'Process',
    other: 'Other',
  };

  const prefix = categoryLabels[category] || 'Other';

  const evidenceSection = evidenceUrls && evidenceUrls.length > 0
    ? `\n\n**Evidence**\n${evidenceUrls.map(u => `- ${u}`).join('\n')}`
    : '';

  const commentBody = [
    `### ${prefix} Task Result`,
    '',
    `**Summary**: ${summary}`,
    '',
    details,
    evidenceSection,
    '',
    '---',
    '_Posted automatically by STAS_',
  ].join('\n');

  try {
    await tracker.postComment(ticketId, commentBody);
    if (evidenceUrls && evidenceUrls.length > 0) {
      await tracker.createLink(ticketId, evidenceUrls[0], `${prefix} Task Evidence`);
    }
    log.info({ ticketId, category }, 'Non-code result posted to tracker');
  } catch (err) {
    log.error({ err: String(err), ticketId }, 'Failed to post non-code result');
  }
}
