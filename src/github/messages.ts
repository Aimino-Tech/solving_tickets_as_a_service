// @ts-nocheck
/**
 * @deprecated Use `@stas/github-client` instead.
 * This file wraps the standalone package for backward compatibility.
 */
import {
  highConfidenceIssueComment as hcComment,
  draftIssueComment as drComment,
  lowConfidenceComment as lcComment,
  noFixComment as nfComment,
  noResultComment as nrComment,
  investigationComment as invComment,
  alreadyFixedComment as afComment,
  errorComment as errComment,
  featureSkipComment as fsComment,
  questionSkipComment as qsComment,
  timeoutComment as toComment,
  retryComment as rtComment,
  modelFallbackComment as mfComment,
  queueRetryComment as qrComment,
  deadLetterComment as dlComment,
  phantomIssueComment as piComment,
  ciFailureComment as ciComment,
  regressionBlockComment as rbComment,
  verificationWarningComment as vwComment,
  buildPRBody as bpBody,
  type AgentResult,
  type VerificationResult,
// @ts-expect-error - File outside rootDir, handled at runtime
} from '../../packages/github-client/src/index.js';
import { BOT_SIGNATURE } from '../platforms/messages.js';

export type { AgentResult, VerificationResult };

export function highConfidenceIssueComment(prNumber: number, result: Record<string, unknown>, botName?: string): string {
  return hcComment(prNumber, result as unknown as AgentResult, botName);
}

export function draftIssueComment(prNumber: number, result: Record<string, unknown>, botName?: string): string {
  return drComment(prNumber, result as unknown as AgentResult, botName);
}

export function lowConfidenceComment(result: Record<string, unknown>, testOutput: string, botName?: string): string {
  return lcComment(result as unknown as AgentResult, testOutput, botName);
}

export function noFixComment(result: Record<string, unknown>, relevantPRs?: Array<{ url: string; title: string; state: string }>, botName?: string): string {
  return nfComment(result as unknown as AgentResult, relevantPRs, botName);
}

export function noResultComment(botName?: string): string { return nrComment(botName); }

export function investigationComment(summary: string, botName?: string): string { return invComment(summary, botName); }

export function alreadyFixedComment(result: Record<string, unknown>, botName?: string): string {
  return afComment(result as unknown as AgentResult, botName);
}

export function errorComment(message: string, botName?: string): string { return errComment(message, botName); }

export function featureSkipComment(botName?: string): string { return fsComment(botName); }

export function questionSkipComment(botName?: string): string { return qsComment(botName); }

export function timeoutComment(phase: string, timeoutMs: number, botName?: string): string {
  return toComment(phase, timeoutMs, botName);
}

export function retryComment(attempt: number, model: string, error: string, botName?: string): string {
  return rtComment(attempt, model, error, botName);
}

export function modelFallbackComment(model: string, previousError: string, botName?: string): string {
  return mfComment(model, previousError, botName);
}

export function queueRetryComment(attempt: number, maxRetries: number, error: string, botName?: string): string {
  return qrComment(attempt, maxRetries, error, botName);
}

export function deadLetterComment(error: string, botName?: string): string { return dlComment(error, botName); }

export function phantomIssueComment(missingFiles: string[], skipReason: string, botName?: string): string {
  return piComment(missingFiles, skipReason, botName);
}

export function ciFailureComment(prNumber: number, failedChecks: string[], botName?: string): string {
  return ciComment(prNumber, failedChecks, botName);
}

export function regressionBlockComment(result: Record<string, unknown>, botName?: string): string {
  return rbComment(result as unknown as AgentResult, botName);
}

export function verificationWarningComment(result: Record<string, unknown>, botName?: string): string {
  if (!result?.verification) return '';
  return vwComment(result as unknown as AgentResult, botName);
}

export function groundingKillComment(ungrounded: string[], _botName?: string): string {
  return [
    `### ❌ Fix Aborted — Issue Grounding Check Failed`,
    '',
    'The investigation produced findings that are **not grounded** in the actual issue text.',
    'This prevents the fix agent from acting on hallucinated requirements.',
    '',
    '**Ungrounded requirement(s):**',
    '',
    ...ungrounded.map((r) => `- \`${r.slice(0, 200)}\``),
    '',
    'The bot will not proceed with a fix until the issue text supports the claimed requirements.',
    '',
    'If you believe this is a mistake, please update the issue description to clarify the requirements and re-label.',
    BOT_SIGNATURE,
  ].join('\n');
}

export function buildPRBody(params: {
  issueNumber: number;
  result: Record<string, unknown>;
  fileLinks: string[];
  isDraft: boolean;
  branchName: string;
  botName?: string;
}): string {
  const body = bpBody({ ...params, result: params.result as unknown as AgentResult });
  // Prepend AI attribution after the Closes #N line and before ## Changes
  const lines = body.split('\n');
  const closeIdx = lines.findIndex((l) => l.startsWith('Closes #'));
  if (closeIdx !== -1) {
    lines.splice(
      closeIdx + 1,
      0,
      '',
      '> **AI-generated fix** — This fix was generated by STAS AI. See the quality report below for verification.',
    );
  }
  return lines.join('\n');
}
