import type { AgentResult } from '../types/agent-types.js';
import { rootLogger } from '../utils/logger.js';
import { getTracker } from './index.js';

const log = rootLogger.child({ module: 'tracker-writeback' });

export interface WriteBackParams {
  trackerType: 'linear' | 'jira';
  trackerTicketId: string;
  agentResult: AgentResult;
  prUrl?: string;
  prNumber?: number;
}

function extractChangedFiles(agentResult: AgentResult): string[] | undefined {
  const changedFiles = (agentResult as Record<string, unknown>).changedFiles;
  if (Array.isArray(changedFiles) && changedFiles.every((f): f is string => typeof f === 'string')) {
    return changedFiles;
  }
  if (agentResult.diff) {
    const files = agentResult.diff
      .split('\n')
      .filter((l) => l.startsWith('+++ ') || l.startsWith('--- '))
      .map((l) => l.replace(/^(---|\+\+\+)\s+(a\/|b\/)?/, ''))
      .filter(Boolean);
    const unique = [...new Set(files)];
    return unique.length > 0 ? unique : undefined;
  }
  return undefined;
}

function buildDeliverableComment(params: {
  status: string;
  summary: string;
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  changedFiles?: string[];
  errors?: string[];
}): string {
  const lines: string[] = [`## ${params.status}`, '', params.summary, ''];

  if (params.prUrl && params.prNumber) {
    lines.push(`**Pull Request**: [#${params.prNumber}](${params.prUrl})`);
  }
  if (params.branchName) {
    lines.push(`**Branch**: \`${params.branchName}\``);
  }
  if (params.changedFiles && params.changedFiles.length > 0) {
    lines.push('', '**Files Changed**:', ...params.changedFiles.map((f) => `- \`${f}\``));
  }
  if (params.errors && params.errors.length > 0) {
    lines.push('', '**Errors**:', ...params.errors.map((e) => `- ${e}`));
  }

  lines.push('', '---', '_🤖 STAS — Automated Implementation_');
  return lines.join('\n');
}

export async function writeBack(params: WriteBackParams): Promise<void> {
  const tracker = getTracker(params.trackerType);
  if (!tracker) return;

  const { trackerTicketId, agentResult, prUrl, prNumber } = params;
  const changedFiles = extractChangedFiles(agentResult);

  try {
    if (agentResult.fixReady && agentResult.confidence === 'high' && prUrl) {
      await tracker.updateStatus(trackerTicketId, 'In Review');
      const body = buildDeliverableComment({
        status: '✅ Fix Ready — High Confidence',
        summary: agentResult.summary || 'Fix implemented successfully.',
        prUrl,
        prNumber,
        branchName: agentResult.branchName,
        changedFiles,
      });
      await tracker.postComment(trackerTicketId, body);
    } else if (agentResult.fixReady && agentResult.confidence === 'medium' && prUrl) {
      await tracker.updateStatus(trackerTicketId, 'In Review');
      const body = buildDeliverableComment({
        status: '✏️ Draft PR Ready — Medium Confidence',
        summary: agentResult.summary || 'Fix implemented (draft).',
        prUrl,
        prNumber,
        branchName: agentResult.branchName,
        changedFiles,
      });
      await tracker.postComment(trackerTicketId, body);
    } else {
      await tracker.updateStatus(trackerTicketId, 'Backlog');
      const body = buildDeliverableComment({
        status: '❌ Fix Failed',
        summary: (agentResult.noFixReason ?? agentResult.summary) as string || 'Unknown error',
        errors: agentResult.errors,
      });
      await tracker.postComment(trackerTicketId, body);
    }
  } catch (err) {
    log.warn({ err: String(err), trackerTicketId }, 'Write-back failed (non-fatal)');
  }
}
