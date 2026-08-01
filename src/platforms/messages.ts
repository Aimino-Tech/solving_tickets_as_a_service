/**
 * Platform-agnostic message templates for issue comments and PR bodies.
 *
 * Extracted and generalised from `src/github/messages.ts` — no hardcoded
 * GitHub URLs; the platform client fills in platform-specific links.
 *
 * Every message type follows a consistent format so the bot's voice is
 * predictable across all interactions and platforms.
 */

import type { AgentResult, FixUnabledReason, QualityGateResult } from '../types/agent-types.js';
import { QualityGateReporter } from '../core/quality-gate-reporter.js';
import { config } from '../config.js';

const BOT_NAME = config.stas.botName;
export const BOT_SIGNATURE = `> — ${BOT_NAME} 🤖`;

/**
 * Render the "Powered by Syntaro" footer with a trackable source ref.
 *
 * Gated behind the `STAS_POWERED_BY_FOOTER` config toggle so white-label /
 * enterprise deployments can opt out. The `?ref=` query param (not a full
 * UTM string) attributes visits to a placement — e.g. `pr-footer` for PR
 * bodies, `pr-comment` for issue comments — and feeds PostHog link tracking.
 *
 * @param ref Placement source used in the tracking link (`?ref=<ref>`)
 * @returns Markdown footer, or an empty string when disabled
 */
export function poweredByFooter(ref: string): string {
  if (!config.stas.poweredByFooterEnabled) return '';
  return `---\n\n_Powered by [Syntaro](https://syntaro.io/?ref=${ref}) — AI code review & fix automation_`;
}

/**
 * High-confidence fix — PR is ready for review (non-draft).
 *
 * @param prUrl   Platform-specific URL to the PR/MR
 * @param prNumber  The PR/MR number
 * @param result    Agent result with summary and details
 */
export function highConfidenceIssueComment(prNumber: number, result: AgentResult): string {
  return [
    `### ✅ Fix Ready — PR #${prNumber}`,
    '',
    result.summary,
    '',
    `**Confidence**: High — tests pass and the fix looks clean.`,
    '',
    `| Detail | Value |`,
    `|---|---|`,
    `| PR | #${prNumber} |`,
    `| Branch | \`${result.branchName ?? 'auto-fix'}\` |`,
    result.diff
      ? `<details><summary>📋 Diff Preview</summary>\n\n\`\`\`diff\n${result.diff.slice(0, 5000)}\n\`\`\`\n</details>`
      : '',
    '',
    'Please review and merge at your convenience.',
    BOT_SIGNATURE,
    '',
    poweredByFooter('pr-comment'),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Medium-confidence fix — draft PR created, needs human review.
 */
export function draftIssueComment(prNumber: number, result: AgentResult): string {
  return [
    `### ✏️ Draft PR Ready — PR #${prNumber}`,
    '',
    result.summary,
    '',
    '**Confidence**: Medium — the fix compiles and basic tests pass, but manual review is recommended.',
    '',
    `| Detail | Value |`,
    `|---|---|`,
    `| PR | #${prNumber} |`,
    `| Branch | \`${result.branchName ?? 'auto-fix'}\` |`,
    result.errors?.length ? `\n**Notes**:\n${result.errors.map((e) => `- ${e}`).join('\n')}` : '',
    '',
    'Please review the draft, make any needed changes, and mark it ready for review.',
    BOT_SIGNATURE,
    '',
    poweredByFooter('pr-comment'),
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
 * Render a structured explanation of why an auto-fix was not possible.
 */
function renderNoFixReason(reason: FixUnabledReason): string {
  const lines: string[] = [
    `**What went wrong**: ${reason.category} — ${reason.detail}`,
    '',
    `**Suggested action**: ${reason.userSuggestion}`,
  ];

  if (reason.docsLink) {
    lines.push('', `**Documentation**: ${reason.docsLink}`);
  }

  return lines.join('\n');
}

/**
 * No fix possible — explains why and invites contributors.
 *
 * When `result.noFixReason` is provided as a structured FixUnabledReason,
 * it renders a detailed breakdown of what went wrong and suggested next steps.
 * Falls back to `result.summary` for backward compatibility.
 */
export function noFixComment(
  result: AgentResult,
  relevantPRs?: Array<{ url: string; title: string; state: string }>,
): string {
  const lines: string[] = [`### ❌ Could Not Fix`, ''];

  if (result.noFixReason) {
    lines.push(renderNoFixReason(result.noFixReason));
  } else {
    lines.push(result.summary);
  }

  lines.push('');

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
 * Unexpected result — the agent produced something unexpected.
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
 * Phase timeout — a pipeline phase exceeded its time limit.
 */
export function timeoutComment(phase: string, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return [
    `### ⏱️ Phase Timed Out — ${phase}`,
    "",
    `The **${phase}** phase exceeded its time limit of ${seconds}s.`,
    "",
    "This could indicate a performance issue or an unexpected state.",
    "The pipeline will move to the next phase or abort if this is a critical phase.",
    BOT_SIGNATURE,
  ].join("\n");
}

/**
 * Model retry — switching to a fallback model after a failure.
 */
export function retryComment(
  attempt: number,
  model: string,
  error: string,
): string {
  return [
    `### 🔄 Retrying — Attempt ${attempt}`,
    "",
    `The previous attempt failed with model \`${model}\`.`,
    "",
    `**Error**: \`${error.slice(0, 1000)}\``,
    "",
    "Retrying with next fallback model.",
    BOT_SIGNATURE,
  ].join("\n");
}

/**
 * Model fallback — a fallback model was selected.
 */
export function modelFallbackComment(
  model: string,
  previousError: string,
): string {
  return [
    `### 🔄 Fallback Model — ${model}`,
    "",
    `Switching to fallback model \`${model}\` after primary model failure.`,
    "",
    `**Previous error**: \`${previousError.slice(0, 1000)}\``,
    "",
    BOT_SIGNATURE,
  ].join("\n");
}

/**
 * Queue retry — a job is being retried after a failure.
 */
export function queueRetryComment(
  attempt: number,
  maxRetries: number,
  error: string,
): string {
  return [
    `### 🔄 Queue Retry — Attempt ${attempt}/${maxRetries}`,
    "",
    `The issue processing job failed and will be retried.`,
    "",
    `**Error**: \`${error.slice(0, 1000)}\``,
    "",
    BOT_SIGNATURE,
  ].join("\n");
}

/**
 * Dead letter — job has exhausted all retries.
 */
export function deadLetterComment(
  error: string,
): string {
  return [
    `### ❌ Max Retries Exceeded`,
    "",
    "The issue processing job has exhausted all retry attempts and has been moved to the dead-letter queue.",
    "",
    `**Final error**: \`${error.slice(0, 1000)}\``,
    "",
    "A human operator will need to investigate this issue manually.",
    BOT_SIGNATURE,
  ].join("\n");
}

/**
 * CI failure follow-up — a PR's CI checks failed.
 */
export function ciFailureComment(prNumber: number, failedChecks: string[]): string {
  return [
    `### ⚠️ CI Checks Failed — PR #${prNumber}`,
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
 * Pre-existing test regression — blocks PR creation.
 */
export function regressionBlockComment(result: AgentResult): string {
  const ver = result.verification;
  return [
    `### ❌ Regression Detected — PR Blocked`,
    "",
    result.summary,
    "",
    "Pre-existing tests that were passing **before** the fix are now **failing**.",
    "",
    ver?.details.length
      ? ver.details.map((d) => `- ${d}`).join("\n")
      : "",
    "",
    "The fix introduces regressions in previously passing tests. Please review the changes",
    "and ensure existing functionality is preserved.",
    "",
    "A branch with the attempted changes has been pushed for inspection.",
    BOT_SIGNATURE,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Quality gates failure — one or more OSS quality gates blocked the fix.
 * Posts detailed evidence for each failed gate.
 */
export function qualityGatesBlockComment(failedGates: QualityGateResult[], summary: string): string {
  const sections: string[] = [
    `### ❌ Quality Gates Blocked — PR Not Created`,
    '',
    summary,
    '',
    `The fix was rejected by **${failedGates.length} quality gate(s)**. Each gate uses an OSS tool to verify the agent's output.`,
    '',
  ];

  for (const gate of failedGates) {
    sections.push(
      `<details><summary>❌ Gate: ${gate.gate} (${gate.ossTool})</summary>`,
      '',
      '| Field | Value |',
      '|---|---|',
      `| Gate | \`${gate.gate}\` |`,
      `| OSS Tool | \`${gate.ossTool}\` |`,
      `| Command | \`${gate.command}\` |`,
      '',
    );

    if (gate.stdout) {
      sections.push(
        '**stdout:**',
        '```',
        gate.stdout.slice(0, 2000),
        '```',
        '',
      );
    }
    if (gate.stderr) {
      sections.push(
        '**stderr:**',
        '```',
        gate.stderr.slice(0, 2000),
        '```',
        '',
      );
    }
    if (gate.details.length > 0) {
      sections.push(
        '**Details:**',
        '',
        ...gate.details.map(d => `- ${d}`),
        '',
      );
    }

    sections.push('</details>', '');
  }

  sections.push(
    '**Retry with fix**: Address each failed gate above and re-label the issue with `stas:fix` to trigger a new attempt.',
    '',
    BOT_SIGNATURE,
  );

  return sections.join('\n');
}

/**
 * Verification warning — regression test validation had issues.
 */
export function verificationWarningComment(result: AgentResult): string {
  const ver = result.verification;
  if (!ver) return "";

  const lines: string[] = [
    `### ⚠️ Verification Warnings`,
    "",
  ];

  if (ver.regressionTestPassedOnOriginal === false) {
    lines.push(
      "- The regression test does **not fail** when run against the original code.",
      "  It may not properly validate the bug fix.",
    );
  }
  if (ver.regressionTestPassedOnFix === false) {
    lines.push(
      "- The regression test does **not pass** on the fixed code.",
      "  The test may need adjustment.",
    );
  }
  if (ver.regressionTestCreated === false) {
    lines.push(
      "- No new regression test file was detected.",
      "  Manual verification is recommended.",
    );
  }

  if (ver.unverified) {
    lines.push(
      "- No test suite was detected. Verification was skipped.",
      "  Manual testing is recommended before merging.",
    );
  }

  if (ver.details.length > 0) {
    lines.push(
      "",
      "<details><summary>Verification Details</summary>",
      "",
      ...ver.details.map((d) => `- ${d}`),
      "",
      "</details>",
    );
  }

  lines.push("", BOT_SIGNATURE);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fix stats — data-driven stats block for PR footers
// ---------------------------------------------------------------------------

/** Statistical data about the fix for display in the PR footer. */
export interface FixStats {
  timeToFixSeconds?: number;
  filesChanged?: number;
  testsPassed?: number;
  testsTotal?: number;
}

/**
 * Format the fix stats section for inclusion in a PR body.
 */
function formatFixStats(stats?: FixStats): string {
  if (!stats) return '';

  const rows: string[] = ['', '## Fix Stats', '', '| Metric | Value |', '|---|---|'];

  if (stats.timeToFixSeconds !== undefined) {
    const minutes = Math.round(stats.timeToFixSeconds / 60);
    const seconds = stats.timeToFixSeconds % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    rows.push(`| ⏱ Time to fix | ${timeStr} |`);
  }

  if (stats.filesChanged !== undefined) {
    rows.push(`| 📁 Files changed | ${stats.filesChanged} |`);
  }

  if (stats.testsPassed !== undefined && stats.testsTotal !== undefined) {
    rows.push(`| ✅ Tests passed | ${stats.testsPassed}/${stats.testsTotal} |`);
  } else if (stats.testsPassed !== undefined) {
    rows.push(`| ✅ Tests passed | ${stats.testsPassed} |`);
  }

  rows.push('');
  return rows.join('\n');
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
  runId?: string | number;
  /** Optional fix stats for the footer section. */
  fixStats?: FixStats;
}): string {
  const { issueNumber, result, fileLinks, branchName, runId, fixStats } = params;

  const ver = result.verification;
  const verSection: string[] = [];

  if (ver) {
    if (ver.unverified) {
      verSection.push("⚠️ **Unverified**: No test suite detected. Manual testing recommended.");
    } else {
      const checks: string[] = [];
      checks.push(ver.preExistingTestsRegressed ? "❌" : "✅");
      checks.push("No pre-existing test regressions");

      if (ver.regressionTestCreated) {
        checks.push(ver.regressionTestPassedOnOriginal ? "✅" : "❌");
        checks.push("Regression test fails on original code");

        checks.push(ver.regressionTestPassedOnFix ? "✅" : "❌");
        checks.push("Regression test passes on fix");
      } else {
        checks.push("⚠️ No regression test detected");
      }

      verSection.push(
        "| Check | Status |",
        "|---|---|",
      );
      for (let i = 0; i < checks.length; i += 2) {
        verSection.push(`| ${checks[i]} ${checks[i + 1]} |`);
      }
    }
  }

  // Quality gate report section
  const qualityGates = ver?.qualityGates;
  const qualitySection: string[] = [];
  if (qualityGates && qualityGates.length > 0) {
    const qr = new QualityGateReporter();
    qualitySection.push('', '## Quality Gates', '', qr.formatMarkdown(qualityGates), '');
  }

  // Fix stats section (data-driven)
  const statsSection = formatFixStats(fixStats);

  return [
    `## Summary`,
    '',
    result.summary,
    '',
    `Closes #${issueNumber}.`,
    '',
    `> **AI-generated fix** — This fix was generated by Syntaro AI. See the [quality report](#quality-gates) below for verification.`,
    '',
    `## Changes`,
    '',
    fileLinks.length > 0 ? fileLinks.map((f) => `- \`${f}\``).join('\n') : '_(file list not available)_',
    '',
    `## Verification`,
    "",
    verSection.length > 0 ? verSection.join("\n") + "\n" : "",
    result.testOutput
      ? `<details><summary>Test Output</summary>\n\n\`\`\`\n${result.testOutput.slice(0, 5000)}\n\`\`\`\n</details>`
      : 'Tests were run as part of the fix process.',
    ...qualitySection,
    ...(statsSection ? [statsSection] : []),
    '',
    `## Branch`,
    '',
    `\`${branchName}\``,
    '',
    '---',
    '',
    ...(runId
      ? [
          `**Run page**: [Syntaro run #${runId}](/runs/${runId})`,
          `**Badge**: ![](/badge/${runId}.svg)`,
          '',
        ]
      : []),
    `_🤖 Automated fix by ${BOT_NAME}_`,
    ...(poweredByFooter('pr-footer') ? ['', poweredByFooter('pr-footer')] : []),
  ].join('\n');
}

export function buildShareMessage(runUrl: string): string {
  return [
    `### 🎉 Fix Complete`,
    '',
    `This fix was automated by Syntaro — label an issue and get a pull request.`,
    '',
    'Share this result:',
    '',
    `- [Share on Twitter](https://twitter.com/intent/tweet?text=${encodeURIComponent('My GitHub issue was automatically fixed by Syntaro! 🚀')}&url=${encodeURIComponent(runUrl)})`,
    `- [Share on LinkedIn](https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(runUrl)})`,
    '',
    `[![Syntaro](https://img.shields.io/badge/Syntaro-Solving_Tickets_As_A_Service-8250DF)](https://stas.aimino.ai)`,
    `[Add Syntaro to your repo](https://github.com/apps/${config.github.appId}/installations/new)`,
    '',
    BOT_SIGNATURE,
  ].join('\n');
}
