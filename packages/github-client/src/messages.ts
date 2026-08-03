export const DEFAULT_BOT_NAME = 'SYNTARO';

function botSignature(botName: string): string {
  return `> — ${botName} 🤖`;
}

export interface VerificationResult {
  preExistingTestsRegressed?: boolean;
  regressionTestCreated?: boolean;
  regressionTestPassedOnOriginal?: boolean;
  regressionTestPassedOnFix?: boolean;
  unverified?: boolean;
  details: string[];
}

export interface AgentResult {
  summary: string;
  fixReady?: boolean;
  alreadyFixed?: boolean;
  investigationOnly?: boolean;
  noFixReason?: string;
  confidence?: 'high' | 'medium' | 'low';
  branchName?: string;
  diff?: string;
  errors?: string[];
  testOutput?: string;
  verification?: VerificationResult;
}

export function highConfidenceIssueComment(prNumber: number, result: AgentResult, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
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
    sig,
  ]
    .filter(Boolean)
    .join('\n');
}

export function draftIssueComment(prNumber: number, result: AgentResult, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
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
    sig,
  ]
    .filter(Boolean)
    .join('\n');
}

export function lowConfidenceComment(result: AgentResult, testOutput: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
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
    sig,
  ]
    .filter(Boolean)
    .join('\n');
}

export function noFixComment(
  result: AgentResult,
  relevantPRs?: Array<{ url: string; title: string; state: string }>,
  botName?: string,
): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  const lines: string[] = [`### ❌ Could Not Fix`, '', result.noFixReason || result.summary, ''];
  if (relevantPRs && relevantPRs.length > 0) {
    lines.push(
      '**Related pull requests**:',
      '',
      ...relevantPRs.map((pr) => `- [${pr.title}](${pr.url}) — ${pr.state}`),
      '',
    );
  }
  lines.push('This issue may need manual investigation. Contributions are welcome!', '', sig);
  return lines.join('\n');
}

export function noResultComment(botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 🤔 Unexpected Result`,
    '',
    'The agent produced an unexpected result. This might be a transient issue.',
    '',
    'Please try re-labeling the issue to trigger a new attempt, or investigate manually.',
    sig,
  ].join('\n');
}

export function investigationComment(summary: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 🔍 Investigation Results`,
    '',
    summary,
    '',
    'This was an investigation-only run. No changes were made to the codebase.',
    sig,
  ].join('\n');
}

export function alreadyFixedComment(result: AgentResult, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### ✅ Looks Like This Is Already Fixed`,
    '',
    result.summary,
    '',
    'The issue could not be reproduced on the latest code. It may have been resolved by another change.',
    '',
    'If you believe this is incorrect, please add more details to the issue and re-label it.',
    sig,
  ].join('\n');
}

export function errorComment(message: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### ❌ Error`,
    '',
    `\`\`\`\n${message.slice(0, 5000)}\n\`\`\``,
    '',
    'The bot encountered an error while processing this issue.',
    '',
    'If this persists, please check the bot logs or open a GitHub issue.',
    sig,
  ].join('\n');
}

export function featureSkipComment(botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 🚀 Feature Request Detected`,
    '',
    `${botName ?? DEFAULT_BOT_NAME} currently handles bug fixes only. This issue appears to be a feature request.`,
    '',
    'Consider using a dedicated feature request template or discussing the feature in Discussions.',
    sig,
  ].join('\n');
}

export function questionSkipComment(botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### ❓ Question Detected`,
    '',
    `${botName ?? DEFAULT_BOT_NAME} currently handles bug fixes only. This issue appears to be a question or support request.`,
    '',
    "For questions, please use GitHub Discussions or the project's support channel.",
    sig,
  ].join('\n');
}

export function timeoutComment(phase: string, timeoutMs: number, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  const seconds = Math.round(timeoutMs / 1000);
  return [
    `### ⏱️ Phase Timed Out — ${phase}`,
    '',
    `The **${phase}** phase exceeded its time limit of ${seconds}s.`,
    '',
    'This could indicate a performance issue or an unexpected state.',
    'The pipeline will move to the next phase or abort if this is a critical phase.',
    sig,
  ].join('\n');
}

export function retryComment(attempt: number, model: string, error: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 🔄 Retrying — Attempt ${attempt}`,
    '',
    `The previous attempt failed with model \`${model}\`.`,
    '',
    `**Error**: \`${error.slice(0, 1000)}\``,
    '',
    'Retrying with next fallback model.',
    sig,
  ].join('\n');
}

export function modelFallbackComment(model: string, previousError: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 🔄 Fallback Model — ${model}`,
    '',
    `Switching to fallback model \`${model}\` after primary model failure.`,
    '',
    `**Previous error**: \`${previousError.slice(0, 1000)}\``,
    '',
    sig,
  ].join('\n');
}

export function queueRetryComment(attempt: number, maxRetries: number, error: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 🔄 Queue Retry — Attempt ${attempt}/${maxRetries}`,
    '',
    `The issue processing job failed and will be retried.`,
    '',
    `**Error**: \`${error.slice(0, 1000)}\``,
    '',
    sig,
  ].join('\n');
}

export function deadLetterComment(error: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### ❌ Max Retries Exceeded`,
    '',
    'The issue processing job has exhausted all retry attempts and has been moved to the dead-letter queue.',
    '',
    `**Final error**: \`${error.slice(0, 1000)}\``,
    '',
    'A human operator will need to investigate this issue manually.',
    sig,
  ].join('\n');
}

export function phantomIssueComment(missingFiles: string[], skipReason: string, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### 👻 Phantom Issue Detected`,
    '',
    skipReason,
    '',
    '**Missing file paths**:',
    ...missingFiles.map((f) => `- \`${f}\``),
    '',
    'The issue may originate from a fork, an unmerged branch, or a different codebase.',
    'No agent dispatch was attempted.',
    '',
    sig,
  ].join('\n');
}

export function ciFailureComment(prNumber: number, failedChecks: string[], botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  return [
    `### ⚠️ CI Checks Failed — PR ##${prNumber}`,
    '',
    'The following CI checks failed for the automated fix:',
    '',
    ...failedChecks.map((check) => `- ❌ ${check}`),
    '',
    'The PR may need manual adjustments to pass CI.',
    sig,
  ].join('\n');
}

export function regressionBlockComment(result: AgentResult, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  const ver = result.verification;
  return [
    `### ❌ Regression Detected — PR Blocked`,
    '',
    result.summary,
    '',
    'Pre-existing tests that were passing **before** the fix are now **failing**.',
    '',
    ver?.details.length ? ver.details.map((d) => `- ${d}`).join('\n') : '',
    '',
    'The fix introduces regressions in previously passing tests. Please review the changes',
    'and ensure existing functionality is preserved.',
    '',
    'A branch with the attempted changes has been pushed for inspection.',
    sig,
  ]
    .filter(Boolean)
    .join('\n');
}

export function verificationWarningComment(result: AgentResult, botName?: string): string {
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);
  const ver = result.verification;
  if (!ver) return '';

  const lines: string[] = [`### ⚠️ Verification Warnings`, ''];

  if (ver.regressionTestPassedOnOriginal === false) {
    lines.push(
      '- The regression test does **not fail** when run against the original code.',
      '  It may not properly validate the bug fix.',
    );
  }
  if (ver.regressionTestPassedOnFix === false) {
    lines.push(
      '- The regression test does **not pass** on the fixed code.',
      '  The test may need adjustment.',
    );
  }
  if (ver.regressionTestCreated === false) {
    lines.push(
      '- No new regression test file was detected.',
      '  Manual verification is recommended.',
    );
  }
  if (ver.unverified) {
    lines.push(
      '- No test suite was detected. Verification was skipped.',
      '  Manual testing is recommended before merging.',
    );
  }
  if (ver.details.length > 0) {
    lines.push('', '<details><summary>Verification Details</summary>', '', ...ver.details.map((d) => `- ${d}`), '', '</details>');
  }

  lines.push('', sig);
  return lines.join('\n');
}

export function buildPRBody(params: {
  issueNumber: number;
  result: AgentResult;
  fileLinks: string[];
  isDraft: boolean;
  branchName: string;
  botName?: string;
}): string {
  const { issueNumber, result, fileLinks, branchName, botName } = params;
  const sig = botSignature(botName ?? DEFAULT_BOT_NAME);

  const ver = result.verification;
  const verSection: string[] = [];

  if (ver) {
    if (ver.unverified) {
      verSection.push('⚠️ **Unverified**: No test suite detected. Manual testing recommended.');
    } else {
      const checks: string[] = [];
      checks.push(ver.preExistingTestsRegressed ? '❌' : '✅');
      checks.push('No pre-existing test regressions');
      if (ver.regressionTestCreated) {
        checks.push(ver.regressionTestPassedOnOriginal ? '✅' : '❌');
        checks.push('Regression test fails on original code');
        checks.push(ver.regressionTestPassedOnFix ? '✅' : '❌');
        checks.push('Regression test passes on fix');
      } else {
        checks.push('⚠️ No regression test detected');
      }
      verSection.push('| Check | Status |', '|---|---|');
      for (let i = 0; i < checks.length; i += 2) {
        verSection.push(`| ${checks[i]} ${checks[i + 1]} |`);
      }
    }
  }

  return [
    `## Summary`,
    '',
    result.summary,
    '',
    `Closes #${issueNumber}.`,
    '',
    `> **AI-generated fix** — This fix was generated by SYNTARO AI. See the quality report below for verification.`,
    '',
    `## Changes`,
    '',
    fileLinks.length > 0 ? fileLinks.map((f) => `- \`${f}\``).join('\n') : '_(file list not available)_',
    '',
    `## Verification`,
    '',
    verSection.length > 0 ? verSection.join('\n') + '\n' : '',
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
    `_🤖 Automated fix by ${botName ?? DEFAULT_BOT_NAME}_`,
  ].join('\n');
}
