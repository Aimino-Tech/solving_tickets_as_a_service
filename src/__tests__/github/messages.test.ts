/**
 * Unit tests for src/github/messages.ts
 *
 * Covers all 17 message templates plus edge cases:
 * 1. highConfidenceIssueComment
 * 2. draftIssueComment
 * 3. lowConfidenceComment
 * 4. noFixComment
 * 5. noResultComment
 * 6. investigationComment
 * 7. alreadyFixedComment
 * 8. errorComment
 * 9. featureSkipComment
 * 10. questionSkipComment
 * 11. ciFailureComment
 * 12. buildPRBody
 * 13. timeoutComment
 * 14. retryComment
 * 15. modelFallbackComment
 * 16. queueRetryComment
 * 17. deadLetterComment
 */

import { describe, expect, it, vi } from 'vitest';
import { sampleAgentResult } from '../fixtures.js';

// Mock config so messages can read BOT_NAME
vi.mock('../../config.js', () => ({
  config: {
    stas: { botName: 'STAS' },
  },
}));

import {
  alreadyFixedComment,
  buildPRBody,
  ciFailureComment,
  draftIssueComment,
  errorComment,
  featureSkipComment,
  highConfidenceIssueComment,
  investigationComment,
  lowConfidenceComment,
  noFixComment,
  noResultComment,
  questionSkipComment,
  regressionBlockComment,
  verificationWarningComment,
  timeoutComment,
  retryComment,
  modelFallbackComment,
  queueRetryComment,
  deadLetterComment,
} from "../../github/messages.js";

describe('github/messages', () => {
  // ── Shared test data ──────────────────────────────────────────────────

  /** Standard high-confidence result */
  const highResult = sampleAgentResult();

  /**
   * Build a result with errors inline (avoids Partial<> spread issues
   * with describe-scoped sampleAgentResult calls).
   */
  function resultWithErrors(errors: string[]): ReturnType<typeof sampleAgentResult> {
    return { ...sampleAgentResult(), errors };
  }

  function resultWithNoFix(noFixReason: string): ReturnType<typeof sampleAgentResult> {
    return { ...sampleAgentResult(), fixReady: false, noFixReason, alreadyFixed: true };
  }

  // ── 1. highConfidenceIssueComment ──────────────────────────────────────

  describe('highConfidenceIssueComment', () => {
    it('contains PR number and confidence indicator', () => {
      const msg = highConfidenceIssueComment(42, highResult);
      expect(msg).toContain('PR ##42');
      expect(msg).toContain('High');
    });

    it('includes the agent summary', () => {
      const msg = highConfidenceIssueComment(42, highResult);
      expect(msg).toContain(highResult.summary);
    });

    it('includes diff preview when diff is present', () => {
      const msg = highConfidenceIssueComment(42, highResult);
      expect(msg).toContain('Diff Preview');
      expect(msg).toContain(highResult.diff!.slice(0, 100));
    });

    it('omits diff preview when diff is missing', () => {
      const msg = highConfidenceIssueComment(42, {
        ...highResult,
        diff: undefined,
      });
      expect(msg).not.toContain('Diff Preview');
    });

    it('includes branch name', () => {
      const msg = highConfidenceIssueComment(42, highResult);
      expect(msg).toContain(highResult.branchName!);
    });

    it('includes bot signature', () => {
      const msg = highConfidenceIssueComment(42, highResult);
      expect(msg).toContain('STAS');
    });

    it('uses "auto-fix" as fallback branch name', () => {
      const msg = highConfidenceIssueComment(42, {
        ...highResult,
        branchName: undefined,
      });
      expect(msg).toContain('auto-fix');
    });

    it('returns a non-empty string', () => {
      const msg = highConfidenceIssueComment(42, highResult);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(100);
    });
  });

  // ── 2. draftIssueComment ──────────────────────────────────────────────

  describe('draftIssueComment', () => {
    it('contains draft language and medium confidence', () => {
      const msg = draftIssueComment(42, highResult);
      expect(msg).toContain('Draft PR');
      expect(msg).toContain('Medium');
    });

    it('includes errors block when present', () => {
      const msg = draftIssueComment(42, {
        ...highResult,
        errors: ['Warning: lint issue'],
      });
      expect(msg).toContain('Warning: lint issue');
      expect(msg).toContain('**Notes**');
    });

    it('omits errors block when empty array', () => {
      const msg = draftIssueComment(42, highResult);
      expect(msg).not.toContain('**Notes**');
    });

    it('includes bot signature', () => {
      const msg = draftIssueComment(42, highResult);
      expect(msg).toContain('STAS');
    });
  });

  // ── 3. lowConfidenceComment ───────────────────────────────────────────

  describe('lowConfidenceComment', () => {
    const errorResult = resultWithErrors(['Test failed: login.test.ts timeout after 5000ms']);

    it('includes test output when provided', () => {
      const msg = lowConfidenceComment(errorResult, 'PASS: 3/3 tests');
      expect(msg).toContain('PASS: 3/3 tests');
      expect(msg).toContain('Test Output');
    });

    it('includes errors list', () => {
      const msg = lowConfidenceComment(errorResult, '');
      expect(msg).toContain('login.test.ts timeout');
    });

    it('omits test output section when empty string', () => {
      const msg = lowConfidenceComment(highResult, '');
      expect(msg).not.toContain('Test Output');
    });

    it('truncates long test output to 10000 chars', () => {
      const longOutput = 'a'.repeat(15000);
      const msg = lowConfidenceComment(errorResult, longOutput);
      expect(msg).toContain('a'.repeat(10000));
      expect(msg).not.toContain('a'.repeat(15000));
    });

    it('shows Low confidence indicator', () => {
      const msg = lowConfidenceComment(errorResult, 'output');
      expect(msg).toContain('Low');
    });

    it('includes bot signature', () => {
      const msg = lowConfidenceComment(errorResult, 'output');
      expect(msg).toContain('STAS');
    });
  });

  // ── 4. noFixComment ──────────────────────────────────────────────────

  describe('noFixComment', () => {
    const nfResult = resultWithNoFix('Cannot reproduce the issue on latest main');

    it('includes "Could Not Fix" heading', () => {
      const msg = noFixComment(nfResult);
      expect(msg).toContain('Could Not Fix');
    });

    it('includes noFixReason text', () => {
      const msg = noFixComment(nfResult);
      expect(msg).toContain('Cannot reproduce the issue on latest main');
    });

    it('falls back to summary when noFixReason is missing', () => {
      const msg = noFixComment({ ...nfResult, noFixReason: undefined });
      expect(msg).toContain(nfResult.summary);
    });

    it('includes related PRs when provided', () => {
      const prs = [
        { url: 'https://github.com/pulls/1', title: 'Fix login', state: 'open' },
        {
          url: 'https://github.com/pulls/2',
          title: 'Refactor auth',
          state: 'merged',
        },
      ];
      const msg = noFixComment(nfResult, prs);
      expect(msg).toContain('Related pull requests');
      expect(msg).toContain('Fix login');
      expect(msg).toContain('Refactor auth');
      expect(msg).toContain('open');
      expect(msg).toContain('merged');
    });

    it('omits related PRs section when not provided', () => {
      const msg = noFixComment(nfResult);
      expect(msg).not.toContain('Related pull requests');
    });

    it('omits related PRs section when empty array', () => {
      const msg = noFixComment(nfResult, []);
      expect(msg).not.toContain('Related pull requests');
    });

    it('includes bot signature', () => {
      const msg = noFixComment(nfResult);
      expect(msg).toContain('STAS');
    });
  });

  // ── 5. noResultComment ────────────────────────────────────────────────

  describe('noResultComment', () => {
    it('returns a non-empty string', () => {
      const msg = noResultComment();
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    });

    it('contains "Unexpected Result" heading', () => {
      const msg = noResultComment();
      expect(msg).toContain('Unexpected Result');
    });

    it('suggests re-labeling the issue', () => {
      const msg = noResultComment();
      expect(msg).toContain('re-labeling');
    });

    it('includes bot signature', () => {
      const msg = noResultComment();
      expect(msg).toContain('STAS');
    });
  });

  // ── 6. investigationComment ───────────────────────────────────────────

  describe('investigationComment', () => {
    it('includes "Investigation Results" heading', () => {
      const msg = investigationComment('Found root cause in auth handler');
      expect(msg).toContain('Investigation Results');
    });

    it('includes the summary text', () => {
      const msg = investigationComment('Found root cause in auth handler');
      expect(msg).toContain('Found root cause in auth handler');
    });

    it('mentions "investigation-only"', () => {
      const msg = investigationComment('summary');
      expect(msg).toContain('investigation-only');
    });

    it('handles empty summary gracefully', () => {
      const msg = investigationComment('');
      expect(msg).toContain('Investigation Results');
      expect(msg).toContain('STAS');
    });

    it('includes bot signature', () => {
      const msg = investigationComment('summary');
      expect(msg).toContain('STAS');
    });
  });

  // ── 7. alreadyFixedComment ────────────────────────────────────────────

  describe('alreadyFixedComment', () => {
    const afResult = resultWithNoFix('Already resolved by another PR');

    it('includes "Already Fixed" heading', () => {
      const msg = alreadyFixedComment(afResult);
      expect(msg).toContain('Already Fixed');
    });

    it('includes the result summary', () => {
      const msg = alreadyFixedComment(afResult);
      expect(msg).toContain(afResult.summary);
    });

    it('mentions could not be reproduced', () => {
      const msg = alreadyFixedComment(afResult);
      expect(msg).toContain('could not be reproduced');
    });

    it('includes bot signature', () => {
      const msg = alreadyFixedComment(afResult);
      expect(msg).toContain('STAS');
    });
  });

  // ── 8. errorComment ───────────────────────────────────────────────────

  describe('errorComment', () => {
    it('includes the error message', () => {
      const msg = errorComment('Something went terribly wrong');
      expect(msg).toContain('Something went terribly wrong');
    });

    it('truncates long error messages to 5000 chars', () => {
      const longError = 'x'.repeat(6000);
      const msg = errorComment(longError);
      expect(msg).toContain('x'.repeat(5000));
      expect(msg).not.toContain('x'.repeat(6000));
    });

    it('shows "Error" heading', () => {
      const msg = errorComment('error');
      expect(msg).toContain('Error');
    });

    it('suggests checking bot logs', () => {
      const msg = errorComment('error');
      expect(msg).toContain('bot logs');
    });

    it('includes bot signature', () => {
      const msg = errorComment('error');
      expect(msg).toContain('STAS');
    });
  });

  // ── 9. featureSkipComment ─────────────────────────────────────────────

  describe('featureSkipComment', () => {
    it('contains "Feature Request Detected" heading', () => {
      const msg = featureSkipComment();
      expect(msg).toContain('Feature Request Detected');
    });

    it('mentions "bug fixes only"', () => {
      const msg = featureSkipComment();
      expect(msg).toContain('bug fixes only');
    });

    it('suggests using feature request template', () => {
      const msg = featureSkipComment();
      expect(msg).toContain('feature request');
    });

    it('includes bot signature', () => {
      const msg = featureSkipComment();
      expect(msg).toContain('STAS');
    });
  });

  // ── 10. questionSkipComment ───────────────────────────────────────────

  describe('questionSkipComment', () => {
    it('contains "Question Detected" heading', () => {
      const msg = questionSkipComment();
      expect(msg).toContain('Question Detected');
    });

    it('mentions "bug fixes only"', () => {
      const msg = questionSkipComment();
      expect(msg).toContain('bug fixes only');
    });

    it('suggests using Discussions', () => {
      const msg = questionSkipComment();
      expect(msg).toContain('Discussions');
    });

    it('includes bot signature', () => {
      const msg = questionSkipComment();
      expect(msg).toContain('STAS');
    });
  });

  // ── 11. ciFailureComment ──────────────────────────────────────────────

  describe('ciFailureComment', () => {
    it('includes all failed checks', () => {
      const checks = ['CI / Build (18.x)', 'CI / Lint', 'CI / Test (ubuntu)'];
      const msg = ciFailureComment(42, checks);
      for (const check of checks) {
        expect(msg).toContain(check);
      }
    });

    it('references PR number', () => {
      const msg = ciFailureComment(42, ['Build']);
      expect(msg).toContain('PR ##42');
    });

    it('handles single failed check', () => {
      const msg = ciFailureComment(1, ['Lint']);
      expect(msg).toContain('Lint');
      expect(msg).toContain('PR ##1');
    });

    it('handles empty checks array', () => {
      const msg = ciFailureComment(42, []);
      expect(msg).toContain('PR ##42');
    });

    it('includes bot signature', () => {
      const msg = ciFailureComment(42, ['Build']);
      expect(msg).toContain('STAS');
    });
  });

  // ── 12. regressionBlockComment ─────────────────────────────────────────

  describe("regressionBlockComment", () => {
    const regressionResult = {
      ...sampleAgentResult(),
      verification: {
        baseline: { passed: true, output: "PASS", command: "npm test", durationMs: 5000 },
        postFix: { passed: false, output: "FAIL", command: "npm test", durationMs: 6000 },
        regressionTestCreated: false,
        regressionTestPassedOnOriginal: null,
        regressionTestPassedOnFix: null,
        preExistingTestsRegressed: true,
        unverified: false,
        details: ["REGRESSION: Pre-existing tests that were passing now fail"],
      },
    };

    it('includes "Regression Detected" heading', () => {
      const msg = regressionBlockComment(regressionResult);
      expect(msg).toContain("Regression Detected");
      expect(msg).toContain("PR Blocked");
    });

    it("includes verification details", () => {
      const msg = regressionBlockComment(regressionResult);
      expect(msg).toContain("Pre-existing tests");
    });

    it("includes bot signature", () => {
      const msg = regressionBlockComment(regressionResult);
      expect(msg).toContain("STAS");
    });
  });

  // ── 13. verificationWarningComment ─────────────────────────────────────

  describe("verificationWarningComment", () => {
    it("returns empty string when no verification result exists", () => {
      const msg = verificationWarningComment({ ...sampleAgentResult(), verification: undefined });
      expect(msg).toBe("");
    });

    it("warns when regression test does not fail on original", () => {
      const result = {
        ...sampleAgentResult(),
        verification: {
          baseline: { passed: true, output: "PASS", command: "npm test", durationMs: 5000 },
          postFix: { passed: true, output: "PASS", command: "npm test", durationMs: 5200 },
          regressionTestCreated: true,
          regressionTestPassedOnOriginal: false,
          regressionTestPassedOnFix: true,
          preExistingTestsRegressed: false,
          unverified: false,
          details: [],
        },
      };
      const msg = verificationWarningComment(result);
      expect(msg).toContain("Verification Warnings");
      expect(msg).toContain("does **not fail**");
    });

    it("warns when regression test does not pass on fix", () => {
      const result = {
        ...sampleAgentResult(),
        verification: {
          baseline: { passed: true, output: "PASS", command: "npm test", durationMs: 5000 },
          postFix: { passed: true, output: "PASS", command: "npm test", durationMs: 5200 },
          regressionTestCreated: true,
          regressionTestPassedOnOriginal: true,
          regressionTestPassedOnFix: false,
          preExistingTestsRegressed: false,
          unverified: false,
          details: [],
        },
      };
      const msg = verificationWarningComment(result);
      expect(msg).toContain("does **not pass**");
    });

    it("warns when no new regression test detected", () => {
      const result = {
        ...sampleAgentResult(),
        verification: {
          baseline: { passed: true, output: "PASS", command: "npm test", durationMs: 5000 },
          postFix: { passed: true, output: "PASS", command: "npm test", durationMs: 5200 },
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: false,
          unverified: false,
          details: [],
        },
      };
      const msg = verificationWarningComment(result);
      expect(msg).toContain("No new regression test file was detected");
    });

    it("warns when unverified", () => {
      const result = {
        ...sampleAgentResult(),
        verification: {
          baseline: null,
          postFix: null,
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: false,
          unverified: true,
          details: ["No test suite configured"],
        },
      };
      const msg = verificationWarningComment(result);
      expect(msg).toContain("No test suite");
    });

    it("includes details block when present", () => {
      const result = {
        ...sampleAgentResult(),
        verification: {
          baseline: null,
          postFix: null,
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: false,
          unverified: true,
          details: ["No test suite configured", "Skipping verification"],
        },
      };
      const msg = verificationWarningComment(result);
      expect(msg).toContain("Skipping verification");
      expect(msg).toContain("Verification Details");
    });
  });

  // ── 14. buildPRBody ───────────────────────────────────────────────────

  describe('buildPRBody', () => {
    const prBodyParams = {
      issueNumber: 42,
      result: highResult,
      fileLinks: ['src/login.ts', 'src/utils/validation.ts'],
      isDraft: false,
      branchName: 'stas/fix-42',
    };

    it('includes "Summary" section and "Closes #N"', () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain('Summary');
      expect(body).toContain('Closes #42');
    });

    it('includes "Changes" section with file links', () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain('Changes');
      expect(body).toContain('src/login.ts');
      expect(body).toContain('src/utils/validation.ts');
    });

    it('includes "Verification" section with test output', () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain('Verification');
      expect(body).toContain('Test Output');
      expect(body).toContain(highResult.testOutput!);
    });

    it('includes "Branch" section', () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain('Branch');
      expect(body).toContain('stas/fix-42');
    });

    it("includes verification status table when verification exists", () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain("Check");
      expect(body).toContain("Status");
      expect(body).toContain("No pre-existing test regressions");
      expect(body).toContain("Regression test fails on original code");
      expect(body).toContain("Regression test passes on fix");
    });

    it("shows unverified message when no test suite detected", () => {
      const unverifiedResult = {
        ...sampleAgentResult(),
        verification: {
          baseline: null,
          postFix: null,
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: false,
          unverified: true,
          details: ["No test suite configured"],
        },
      };
      const body = buildPRBody({ ...prBodyParams, result: unverifiedResult });
      expect(body).toContain("Unverified");
      expect(body).toContain("No test suite detected");
    });

    it("handles empty fileLinks array", () => {
      const body = buildPRBody({ ...prBodyParams, fileLinks: [] });
      expect(body).toContain('file list not available');
    });

    it('handles missing testOutput', () => {
      const body = buildPRBody({
        ...prBodyParams,
        result: { ...highResult, testOutput: undefined },
      });
      expect(body).not.toContain('Test Output');
      expect(body).toContain('Tests were run as part of the fix process');
    });

    it('truncates long test output to 5000 chars in Verification', () => {
      const longOutput = 'y'.repeat(8000);
      const body = buildPRBody({
        ...prBodyParams,
        result: { ...highResult, testOutput: longOutput },
      });
      expect(body).toContain('y'.repeat(5000));
      expect(body).not.toContain('y'.repeat(8000));
    });

    it('includes bot attribution', () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain('STAS');
    });

    it('includes the agent summary in the body', () => {
      const body = buildPRBody(prBodyParams);
      expect(body).toContain(highResult.summary);
    });
  });

  // ── 13. timeoutComment ─────────────────────────────────────────────────

  describe("timeoutComment", () => {
    it("mentions the phase name", () => {
      const msg = timeoutComment("6-opencode-agent", 600_000);
      expect(msg).toContain("6-opencode-agent");
    });

    it("includes the timeout duration in seconds", () => {
      const msg = timeoutComment("1-triage", 30_000);
      expect(msg).toContain("30s");
    });

    it("includes bot signature", () => {
      const msg = timeoutComment("3-boot-sandbox", 300_000);
      expect(msg).toContain("STAS");
    });
  });

  // ── 14. retryComment ───────────────────────────────────────────────────

  describe("retryComment", () => {
    it("includes attempt number and model name", () => {
      const msg = retryComment(2, "claude-haiku", "Request timed out");
      expect(msg).toContain("Attempt 2");
      expect(msg).toContain("claude-haiku");
    });

    it("includes the error message", () => {
      const msg = retryComment(1, "gpt-4o", "HTTP 500 Internal Server Error");
      expect(msg).toContain("HTTP 500");
    });

    it("truncates long error messages", () => {
      const longError = "x".repeat(2000);
      const msg = retryComment(1, "model", longError);
      expect(msg).toContain("x".repeat(1000));
      expect(msg).not.toContain("x".repeat(2000));
    });

    it("includes bot signature", () => {
      const msg = retryComment(1, "model", "error");
      expect(msg).toContain("STAS");
    });
  });

  // ── 15. modelFallbackComment ───────────────────────────────────────────

  describe("modelFallbackComment", () => {
    it("mentions the fallback model", () => {
      const msg = modelFallbackComment("gpt-4o", "Primary model failed");
      expect(msg).toContain("gpt-4o");
    });

    it("includes the previous error", () => {
      const msg = modelFallbackComment("claude-haiku", "Rate limit exceeded");
      expect(msg).toContain("Rate limit exceeded");
    });

    it("includes bot signature", () => {
      const msg = modelFallbackComment("model", "error");
      expect(msg).toContain("STAS");
    });
  });

  // ── 16. queueRetryComment ──────────────────────────────────────────────

  describe("queueRetryComment", () => {
    it("shows attempt and max retries", () => {
      const msg = queueRetryComment(2, 4, "Redis connection lost");
      expect(msg).toContain("2/4");
    });

    it("includes the error message", () => {
      const msg = queueRetryComment(1, 3, "BullMQ job timeout");
      expect(msg).toContain("BullMQ job timeout");
    });

    it("includes bot signature", () => {
      const msg = queueRetryComment(1, 4, "error");
      expect(msg).toContain("STAS");
    });
  });

  // ── 17. deadLetterComment ──────────────────────────────────────────────

  describe("deadLetterComment", () => {
    it("mentions max retries exceeded", () => {
      const msg = deadLetterComment("All retries exhausted");
      expect(msg).toContain("Max Retries Exceeded");
    });

    it("includes the final error", () => {
      const msg = deadLetterComment("Unhandled exception: TypeError");
      expect(msg).toContain("TypeError");
    });

    it("truncates long error messages", () => {
      const longError = "y".repeat(2000);
      const msg = deadLetterComment(longError);
      expect(msg).toContain("y".repeat(1000));
      expect(msg).not.toContain("y".repeat(2000));
    });

    it("includes bot signature", () => {
      const msg = deadLetterComment("error");
      expect(msg).toContain("STAS");
    });
  });
});
