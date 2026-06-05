/**
 * Structured message templates for GitHub issue comments and PR bodies.
 *
 * Every message type follows a consistent format so the bot's voice is
 * predictable across all interactions.
 */

import type { AgentResult } from '../agent/types.js';
import { config } from '../config.js';

const BOT_NAME = config.stas.botName;
const BOT_SIGNATURE = `> — ${BOT_NAME} 🤖`;

/**
 * High-confidence fix — PR is ready for review (non-draft).
 */
export function highConfidenceIssueComment(prNumber: number, result: AgentResult): string {
  return [
    `### ✅ Fix Ready — PR ##${prNumber}`,
    '',
    result.summary,
    '',
    `**Confidence**: High — tests pass and the fix looks clean.`,
    '',
    `| Detail | Value |`,
    `|---|---|`,
    `| PR | [#${prNumber}](https://github.com/pulls/${prNumber}) |`,
    `| Branch | \`${result.branchName ?? 'auto-fix'}\` |`,
    result.diff
      ? `<details><summary>📋 Diff Preview</summary>\n\n\`\`\`diff\n${result.diff.slice(0, 5000)}\n\`\`\`\n</details>`
      : '',
    '',
    'Please review and merge at your convenience.',
    BOT_SIGNATURE,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Medium-confidence fix — draft PR created, needs human review.
 */
export function draftIssueComment(prNumber: number, result: AgentResult): string {
  return [
    `### ✏️ Draft PR Ready — PR ##${prNumber}`,
    '',
    result.summary,
    '',
    '**Confidence**: Medium — the fix compiles and basic tests pass, but manual review is recommended.',
    '',
    `| Detail | Value |`,
    `|---|---|`,
    `| PR | [#${prNumber}](https://github.com/pulls/${prNumber}) |`,
    `| Branch | \`${result.branchName ?? 'auto-fix'}\` |`,
    result.errors?.length ? `\n**Notes**:\n${result.errors.map((e) => `- ${e}`).join('\n')}` : '',
    '',
    'Please review the draft, make any needed changes, and mark it ready for review.',
    BOT_SIGNATURE,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Low-confidence fix — tests are failing, but changes are pushed to a branch.
 */
export function lowConfidenceComment(result: AgentResult, testOutput: string): string {
  return [
    `### ⚠️ Attempted Fix — Tests Need Attention`,
    '',
    result.summary,
    '',
    '**Confidence**: Low — the fix was attempted but some tests are not passing.',
    '',
    testOutput
      ? `<details><summary>📋 Test Output</summary>\n\n\`\`\`\n${testOutput.slice(0, 10000)}\n\`\`\`\n</details>`
      : '',
    result.errors?.length ? `\n**Errors encountered**:\n${result.errors.map((e) => `- ${e}`).join('\n')}` : '',
    '',
    'A branch with the attempted changes has been pushed. You can inspect it and continue from there.',
    BOT_SIGNATURE,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * No fix possible — explains why and invites contributors.
 */
export function noFixComment(
  result: AgentResult,
  relevantPRs?: Array<{ url: string; title: string; state: string }>,
): string {
  const lines: string[] = [`### ❌ Could Not Fix`, '', result.noFixReason || result.summary, ''];

  if (relevantPRs && relevantPRs.length > 0) {
    lines.push(
      '**Related pull requests**:',
      '',
      ...relevantPRs.map((pr) => `- [${pr.title}](${pr.url}) — ${pr.state}`),
      '',
    );
  }

  lines.push('This issue may need manual investigation. Contributions are welcome!', '', BOT_SIGNATURE);

  return lines.join('\n');
}

/**
 * Unexpected error — something went wrong in the agent pipeline.
 */
export function noResultComment(): string {
  return [
    `### 🤔 Unexpected Result`,
    '',
    'The agent produced an unexpected result. This might be a transient issue.',
    '',
    'Please try re-labeling the issue to trigger a new attempt, or investigate manually.',
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * Investigation-only mode — just findings, no fix.
 */
export function investigationComment(summary: string): string {
  return [
    `### 🔍 Investigation Results`,
    '',
    summary,
    '',
    'This was an investigation-only run. No changes were made to the codebase.',
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * Issue already fixed — the agent detected the problem no longer reproduces.
 */
export function alreadyFixedComment(result: AgentResult): string {
  return [
    `### ✅ Looks Like This Is Already Fixed`,
    '',
    result.summary,
    '',
    'The issue could not be reproduced on the latest code. It may have been resolved by another change.',
    '',
    'If you believe this is incorrect, please add more details to the issue and re-label it.',
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * Error comment — something went wrong in the pipeline.
 */
export function errorComment(message: string): string {
  return [
    `### ❌ Error`,
    '',
    `\`\`\`\n${message.slice(0, 5000)}\n\`\`\``,
    '',
    'The bot encountered an error while processing this issue.',
    '',
    'If this persists, please check the bot logs or open a GitHub issue.',
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * Feature request skip — the issue is a feature request, not a bug.
 */
export function featureSkipComment(): string {
  return [
    `### 🚀 Feature Request Detected`,
    '',
    `${BOT_NAME} currently handles bug fixes only. This issue appears to be a feature request.`,
    '',
    'Consider using a dedicated feature request template or discussing the feature in Discussions.',
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * Question skip — the issue is a question/support request.
 */
export function questionSkipComment(): string {
  return [
    `### ❓ Question Detected`,
    '',
    `${BOT_NAME} currently handles bug fixes only. This issue appears to be a question or support request.`,
    '',
    "For questions, please use GitHub Discussions or the project's support channel.",
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * CI failure follow-up — a PR's CI checks failed.
 */
export function ciFailureComment(prNumber: number, failedChecks: string[]): string {
  return [
    `### ⚠️ CI Checks Failed — PR ##${prNumber}`,
    '',
    'The following CI checks failed for the automated fix:',
    '',
    ...failedChecks.map((check) => `- ❌ ${check}`),
    '',
    'The PR may need manual adjustments to pass CI.',
    BOT_SIGNATURE,
  ].join('\n');
}

/**
 * Build a structured PR body.
 */
export function buildPRBody(params: {
  issueNumber: number;
  result: AgentResult;
  fileLinks: string[];
  isDraft: boolean;
  branchName: string;
}): string {
  const { issueNumber, result, fileLinks, branchName } = params;

  return [
    `## Summary`,
    '',
    result.summary,
    '',
    `Closes #${issueNumber}.`,
    '',
    `## Changes`,
    '',
    fileLinks.length > 0 ? fileLinks.map((f) => `- \`${f}\``).join('\n') : '_(file list not available)_',
    '',
    `## Verification`,
    '',
    result.testOutput
      ? `<details><summary>Test Output</summary>\n\n\`\`\`\n${result.testOutput.slice(0, 5000)}\n\`\`\`\n</details>`
      : 'Tests were run as part of the fix process.',
    '',
    `## Branch`,
    '',
    `\`${branchName}\``,
    '',
    '---',
    '',
    `_🤖 Automated fix by ${BOT_NAME}_`,
  ].join('\n');
}
