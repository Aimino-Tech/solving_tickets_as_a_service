import { getTracker } from './index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'noncode-handler' });

export interface NonCodeTicketResult {
  ticketId: string;
  summary: string;
  details?: string;
  evidenceUrl?: string;
  evidenceType?: 'doc' | 'link' | 'image' | 'file';
}

const NON_CODE_LABELS = new Set([
  'research', 'design', 'content', 'process', 'documentation',
  'docs', 'task', 'chore', 'maintenance', 'refactor',
  'discussion', 'question', 'idea',
]);

const CODE_LABELS = new Set([
  'bug', 'feature', 'enhancement', 'fix', 'improvement',
  'feat', 'hotfix', 'patch',
]);

export function isNonCodeTicket(labels: string[]): boolean {
  const normalized = labels.map(l => l.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hasNonCodeLabel = normalized.some(l => NON_CODE_LABELS.has(l));
  const hasCodeLabel = normalized.some(l => CODE_LABELS.has(l));
  return hasNonCodeLabel && !hasCodeLabel;
}

export function classifyTicketType(labels: string[]): 'code' | 'non-code' | 'unknown' {
  const normalized = labels.map(l => l.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hasNonCode = normalized.some(l => NON_CODE_LABELS.has(l));
  const hasCode = normalized.some(l => CODE_LABELS.has(l));

  if (hasCode && !hasNonCode) return 'code';
  if (hasNonCode && !hasCode) return 'non-code';
  if (hasCode && hasNonCode) return 'code';
  return 'unknown';
}

export async function postNonCodeResult(result: NonCodeTicketResult): Promise<void> {
  const tracker = getTracker('linear');
  if (!tracker) {
    log.warn('Linear tracker not available — cannot post non-code result');
    return;
  }

  const evidenceSection = result.evidenceUrl
    ? `\n\n**Evidence:** [${result.evidenceType === 'doc' ? 'Document' : result.evidenceType === 'link' ? 'Link' : 'Attachment'}](${result.evidenceUrl})`
    : '';

  const detailsSection = result.details
    ? `\n\n**Details:**\n${result.details}`
    : '';

  const body = [
    `## 🎯 Ticket Result`,
    ``,
    `**Summary:** ${result.summary}`,
    detailsSection,
    evidenceSection,
    ``,
    `> Automated result posting by SYNTARO`,
  ].join('\n');

  try {
    await tracker.postComment(result.ticketId, body);
    await tracker.updateStatus(result.ticketId, 'Done');
    log.info({ ticketId: result.ticketId }, 'Non-code result posted to Linear');
  } catch (err) {
    log.error({ err: String(err), ticketId: result.ticketId }, 'Failed to post non-code result');
    throw err;
  }
}

export async function postResearchResult(
  ticketId: string,
  params: {
    findings: string;
    sources?: string[];
    recommendations?: string[];
    reportUrl?: string;
  },
): Promise<void> {
  const details = [
    params.sources?.length ? `**Sources consulted:**\n${params.sources.map(s => `- ${s}`).join('\n')}` : '',
    params.recommendations?.length ? `**Recommendations:**\n${params.recommendations.map(r => `- ${r}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  await postNonCodeResult({
    ticketId,
    summary: params.findings.slice(0, 200) + (params.findings.length > 200 ? '...' : ''),
    details,
    evidenceUrl: params.reportUrl,
    evidenceType: 'doc',
  });
}

export async function postDesignResult(
  ticketId: string,
  params: {
    description: string;
    mockupUrl?: string;
    specUrl?: string;
    decisions?: string[];
  },
): Promise<void> {
  const details = [
    params.decisions?.length ? `**Key decisions:**\n${params.decisions.map(d => `- ${d}`).join('\n')}` : '',
    params.specUrl ? `**Spec:** [Design Spec](${params.specUrl})` : '',
  ].filter(Boolean).join('\n\n');

  await postNonCodeResult({
    ticketId,
    summary: params.description.slice(0, 200) + (params.description.length > 200 ? '...' : ''),
    details,
    evidenceUrl: params.mockupUrl,
    evidenceType: 'image',
  });
}

export async function postProcessResult(
  ticketId: string,
  params: {
    outcome: string;
    actions?: string[];
    owner?: string;
    nextSteps?: string[];
  },
): Promise<void> {
  const details = [
    params.actions?.length ? `**Actions taken:**\n${params.actions.map(a => `- ${a}`).join('\n')}` : '',
    params.owner ? `**Owner:** ${params.owner}` : '',
    params.nextSteps?.length ? `**Next steps:**\n${params.nextSteps.map(n => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  await postNonCodeResult({
    ticketId,
    summary: params.outcome.slice(0, 200) + (params.outcome.length > 200 ? '...' : ''),
    details,
  });
}
