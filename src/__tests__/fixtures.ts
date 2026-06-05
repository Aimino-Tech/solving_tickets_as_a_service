/**
 * Test fixtures — reusable sample data for STAS tests.
 *
 * Every fixture returns a fresh copy so tests can safely mutate as needed.
 */

import type { IssueJobData } from "../utils/types.js";
import type { AgentResult, VerificationResult } from "../agent/types.js";

// ── Webhook Payloads ───────────────────────────────────────────────────────

/**
 * Complete `issues.labeled` webhook payload for a "stas:fix" label event.
 * Based on the GitHub webhook payload shape consumed by the webhooks handler.
 */
export function sampleIssueLabeledPayload() {
  return {
    action: 'labeled' as const,
    issue: {
      number: 42,
      title: 'Fix broken user login',
      body: 'Users are unable to log in when the password contains special characters.',
      state: 'open',
      labels: [{ name: 'stas:fix', color: 'fc2929' }],
      created_at: '2025-05-01T10:00:00Z',
      updated_at: '2025-05-01T12:00:00Z',
      html_url: 'https://github.com/owner/repo/issues/42',
      user: { login: 'testuser', id: 12345 },
      assignee: null,
      milestone: null,
      locked: false,
      comments: 0,
      pull_request: undefined,
      closed_at: null,
      author_association: 'CONTRIBUTOR',
      active_lock_reason: null,
      performed_via_github_app: null,
      reactions: {
        url: '',
        total_count: 0,
        '+1': 0,
        '-1': 0,
        laugh: 0,
        hooray: 0,
        confused: 0,
        heart: 0,
        rocket: 0,
        eyes: 0,
      },
      state_reason: null,
    },
    label: { name: 'stas:fix', color: 'fc2929', default: false, description: 'Trigger STAS fix' },
    repository: {
      id: 100,
      name: 'test-repo',
      full_name: 'owner/test-repo',
      private: false,
      owner: { login: 'owner', id: 999, type: 'User' },
      html_url: 'https://github.com/owner/test-repo',
      description: 'A test repository',
      fork: false,
      default_branch: 'main',
      language: 'TypeScript',
      visibility: 'public',
      topics: [],
      has_issues: true,
      has_projects: false,
      has_wiki: false,
      archived: false,
      disabled: false,
      open_issues_count: 5,
      allow_forking: true,
      is_template: false,
      web_commit_signoff_required: false,
      starred_at: '',
    },
    installation: { id: 555, node_id: 'MDx:Integration' },
    organization: { login: 'my-org', id: 777 },
    sender: { login: 'testuser', id: 12345 },
  };
}

/**
 * Sample `issues.opened` webhook payload.
 */
export function sampleIssueOpenedPayload() {
  return {
    action: 'opened' as const,
    issue: {
      number: 43,
      title: 'Add dark mode support',
      body: 'It would be great if the app supported a dark mode theme.',
      state: 'open',
      labels: [],
      created_at: '2025-05-02T08:00:00Z',
      updated_at: '2025-05-02T08:00:00Z',
      html_url: 'https://github.com/owner/repo/issues/43',
      user: { login: 'contributor', id: 67890 },
      assignee: null,
      milestone: null,
      locked: false,
      comments: 0,
      pull_request: undefined,
      closed_at: null,
      author_association: 'NONE',
      active_lock_reason: null,
      performed_via_github_app: null,
      reactions: {
        url: '',
        total_count: 0,
        '+1': 0,
        '-1': 0,
        laugh: 0,
        hooray: 0,
        confused: 0,
        heart: 0,
        rocket: 0,
        eyes: 0,
      },
      state_reason: null,
    },
    repository: {
      id: 101,
      name: 'test-repo',
      full_name: 'owner/test-repo',
      private: true,
      owner: { login: 'owner', id: 999, type: 'User' },
      html_url: 'https://github.com/owner/test-repo',
      description: 'A test repository',
      fork: false,
      default_branch: 'main',
    },
    installation: { id: 555, node_id: 'MDx:Integration' },
    sender: { login: 'contributor', id: 67890 },
  };
}

/**
 * Sample `marketplace_purchase` webhook payload for billing changes.
 */
export function sampleMarketplacePayload() {
  return {
    action: 'purchased',
    effective_date: '2025-05-15T00:00:00Z',
    marketplace_purchase: {
      account: {
        id: 999,
        type: 'Organization',
        login: 'my-org',
        organization_billing_email: 'billing@my-org.com',
      },
      billing_cycle: 'monthly',
      unit_count: 1,
      on_free_trial: false,
      free_trial_ends_on: null,
      next_billing_date: '2025-06-15T00:00:00Z',
      plan: {
        id: 1,
        name: 'Pro Plan',
        description: 'Pro plan for STAS',
        monthly_price_in_cents: 4900,
        yearly_price_in_cents: 49000,
        price_model: 'flat',
        has_free_trial: false,
        unit_name: null,
        bullets: ['Up to 100 fixes/month', 'Priority support'],
      },
    },
    repository: null,
    sender: { login: 'admin', id: 11111 },
  };
}

// ── Job Data ───────────────────────────────────────────────────────────────

/**
 * Sample IssueJobData for queue tests.
 */
export function sampleJobData(overrides?: Partial<IssueJobData>): IssueJobData {
  return {
    installationId: 555,
    repoOwner: 'owner',
    repoName: 'test-repo',
    repoPrivate: false,
    issueNumber: 42,
    issueTitle: 'Fix broken user login',
    issueBody: 'Users are unable to log in when the password contains special characters.',
    ...overrides,
  };
}

// ── Agent Results ──────────────────────────────────────────────────────────

/**
 * Sample successful verification result.
 */
export function sampleVerificationResult(
  overrides?: Partial<VerificationResult>,
): VerificationResult {
  return {
    baseline: {
      passed: true,
      output: "PASS: 42 tests passed",
      command: "npm test",
      durationMs: 5000,
    },
    postFix: {
      passed: true,
      output: "PASS: 43 tests passed",
      command: "npm test",
      durationMs: 5200,
    },
    regressionTestCreated: true,
    regressionTestPassedOnOriginal: true,
    regressionTestPassedOnFix: true,
    preExistingTestsRegressed: false,
    unverified: false,
    details: [
      "Post-fix tests: passed (5200ms)",
      "No pre-existing test regressions detected",
      "New test file(s) detected: tests/login.regression.test.ts",
      "Regression test tests/login.regression.test.ts: fails on original, passes on fix",
    ],
    ...overrides,
  };
}

/**
 * Sample AgentResult with a high-confidence fix_ready result.
 */
export function sampleAgentResult(_overrides?: Partial<AgentResult>): AgentResult {
  return {
    summary: 'Fixed input sanitization in login handler. Added special character escaping.',
    confidence: 'high',
    fixReady: true,
    prUrl: 'https://github.com/owner/test-repo/pull/42',
    branchName: 'stas/fix-42-mock',
    diff: 'diff --git a/src/login.ts b/src/login.ts\nindex abc..def 100644\n--- a/src/login.ts\n+++ b/src/login.ts\n@@ -10,3 +10,5 @@\n+  // Sanitize input\n+  const sanitized = escapeSpecialChars(input);',
    testOutput:
      'PASS tests/login.test.ts (42ms)\n  ✓ handles special characters in password\n  ✓ rejects empty password\n\nTests: 2 passed, 2 total',
    errors: [],
    verification: sampleVerificationResult(),
  };
}

/**
 * Sample AgentResult for a failed fix attempt (no fix possible).
 */
export function sampleNoFixAgentResult(overrides?: Partial<AgentResult>): AgentResult {
  return {
    summary: 'Could not reproduce the issue. The login handler already handles special characters.',
    confidence: 'low',
    fixReady: false,
    noFixReason: 'Issue could not be reproduced on latest main branch.',
    alreadyFixed: true,
    errors: [],
    ...overrides,
  };
}
