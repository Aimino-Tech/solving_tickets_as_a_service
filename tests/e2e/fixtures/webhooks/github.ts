/**
 * GitHub webhook test payloads for E2E tests.
 * Each function returns a fresh clone to prevent test pollution.
 */

import crypto from "node:crypto";

/**
 * Generate a mock x-hub-signature-256 for the given payload and secret.
 */
export function signPayload(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Minimal `issues.labeled` payload with the stas:fix label.
 * Based on the GitHub webhook payload shape used in src/webhooks/github.ts.
 */
export function sampleIssueLabeledPayload() {
  return {
    action: "labeled" as const,
    issue: {
      number: 42,
      title: "Fix broken user login",
      body: "Users are unable to log in when the password contains special characters.",
      state: "open",
      labels: [{ name: "stas:fix", color: "fc2929" }],
      created_at: "2025-05-01T10:00:00Z",
      updated_at: "2025-05-01T12:00:00Z",
      html_url: "https://github.com/owner/repo/issues/42",
      user: { login: "testuser", id: 12345 },
      assignee: null,
      milestone: null,
      locked: false,
      comments: 0,
      pull_request: undefined,
      closed_at: null,
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
      performed_via_github_app: null,
      reactions: { url: "", total_count: 0, "+1": 0, "-1": 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
      state_reason: null,
    },
    label: { name: "stas:fix", color: "fc2929", default: false, description: "Trigger STAS fix" },
    repository: {
      id: 100,
      name: "test-repo",
      full_name: "owner/test-repo",
      private: false,
      owner: { login: "owner", id: 999, type: "User" },
      html_url: "https://github.com/owner/test-repo",
      description: "A test repository",
      fork: false,
      default_branch: "main",
      language: "TypeScript",
      visibility: "public",
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
      starred_at: "",
    },
    installation: { id: 555, node_id: "MDx:Integration" },
    organization: { login: "my-org", id: 777 },
    sender: { login: "testuser", id: 12345 },
  };
}

/**
 * Payload with a non-target label (should NOT trigger enqueue).
 */
export function sampleNonTargetLabelPayload() {
  const payload = sampleIssueLabeledPayload();
  payload.label = { name: "bug", color: "d73a4a", default: true, description: "Something isn't working" };
  // Also update issue labels
  payload.issue.labels = [{ name: "bug", color: "d73a4a" }];
  return payload;
}

/**
 * Payload without an installation ID (should NOT trigger enqueue).
 */
export function sampleMissingInstallationPayload() {
  const payload = sampleIssueLabeledPayload() as Record<string, unknown>;
  delete payload.installation;
  return payload;
}

/**
 * Marketplace purchase payload (Pro Plan → pro billing plan).
 */
export function sampleMarketplacePurchasePayload() {
  return {
    action: "purchased",
    effective_date: "2025-05-15T00:00:00Z",
    marketplace_purchase: {
      account: { id: 999, type: "Organization", login: "my-org", organization_billing_email: "billing@my-org.com" },
      billing_cycle: "monthly",
      unit_count: 1,
      on_free_trial: false,
      free_trial_ends_on: null,
      next_billing_date: "2025-06-15T00:00:00Z",
      plan: {
        id: 1,
        name: "Pro Plan",
        description: "Pro plan for STAS",
        monthly_price_in_cents: 4900,
        yearly_price_in_cents: 49000,
        price_model: "flat",
        has_free_trial: false,
        unit_name: null,
        bullets: ["Up to 100 fixes/month", "Priority support"],
      },
    },
    repository: null,
    sender: { login: "admin", id: 11111 },
  };
}

/**
 * Issues.edited payload with the stas:fix label already present.
 */
export function sampleIssueEditedWithTargetPayload() {
  return {
    action: "edited",
    issue: {
      number: 42,
      title: "Fix broken user login (updated)",
      body: "Updated description with more details about the issue.",
      state: "open",
      labels: [{ name: "stas:fix", color: "fc2929" }],
      created_at: "2025-05-01T10:00:00Z",
      updated_at: "2025-05-01T13:00:00Z",
      html_url: "https://github.com/owner/repo/issues/42",
      user: { login: "testuser", id: 12345 },
      assignee: null,
      milestone: null,
      locked: false,
      comments: 1,
      pull_request: undefined,
      closed_at: null,
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
      performed_via_github_app: null,
      reactions: { url: "", total_count: 0, "+1": 0, "-1": 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
      state_reason: null,
    },
    changes: { body: { from: "Original body" } },
    repository: {
      id: 100,
      name: "test-repo",
      full_name: "owner/test-repo",
      private: false,
      owner: { login: "owner", id: 999, type: "User" },
      html_url: "https://github.com/owner/test-repo",
      description: "A test repository",
      fork: false,
      default_branch: "main",
      language: "TypeScript",
      visibility: "public",
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
      starred_at: "",
    },
    installation: { id: 555, node_id: "MDx:Integration" },
    organization: { login: "my-org", id: 777 },
    sender: { login: "testuser", id: 12345 },
  };
}
