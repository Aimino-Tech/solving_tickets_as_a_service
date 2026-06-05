/**
 * GitHub webhook payload fixtures for E2E testing.
 *
 * Each fixture returns a fresh clone so tests can safely mutate as needed.
 * Based on the live GitHub webhook payload shapes consumed by the
 * `src/webhooks/github.ts` handler.
 */

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/**
 * `issues.labeled` with the target `stas:fix` label — triggers a fix job.
 */
export function githubIssuesLabeledStasFix() {
  return {
    action: 'labeled',
    issue: {
      number: 42,
      title: 'Fix broken user login',
      body: 'Users are unable to log in when the password contains special characters.',
      state: 'open',
      labels: [{ name: 'stas:fix', color: 'fc2929', default: false, description: 'Trigger STAS fix' }],
      created_at: '2025-05-01T10:00:00Z',
      updated_at: '2025-05-01T12:00:00Z',
      html_url: 'https://github.com/owner/test-repo/issues/42',
      user: { login: 'testuser', id: 12345, type: 'User' },
      assignee: null,
      milestone: null,
      locked: false,
      comments: 0,
      pull_request: null,
      closed_at: null,
      author_association: 'CONTRIBUTOR',
      active_lock_reason: null,
      performed_via_github_app: null,
      reactions: { url: '', total_count: 0, '+1': 0, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
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
    sender: { login: 'testuser', id: 12345, type: 'User' },
  };
}

/**
 * `issues.labeled` with a non-target label — should NOT trigger.
 */
export function githubIssuesLabeledOther() {
  const payload = githubIssuesLabeledStasFix() as any;
  payload.label = { name: 'bug', color: 'd73a4a', default: true, description: 'Something is not working' };
  payload.issue.labels = [payload.label];
  return payload;
}

/**
 * `issues.opened` — does not trigger a fix job (we wait for label).
 */
export function githubIssuesOpened() {
  return {
    action: 'opened',
    issue: {
      number: 43,
      title: 'Add dark mode support',
      body: 'It would be great if the app supported a dark mode theme.',
      state: 'open',
      labels: [],
      created_at: '2025-05-02T08:00:00Z',
      updated_at: '2025-05-02T08:00:00Z',
      html_url: 'https://github.com/owner/repo/issues/43',
      user: { login: 'contributor', id: 67890, type: 'User' },
      assignee: null,
      milestone: null,
      locked: false,
      comments: 0,
      pull_request: null,
      closed_at: null,
      author_association: 'NONE',
      active_lock_reason: null,
      performed_via_github_app: null,
      reactions: { url: '', total_count: 0, '+1': 0, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
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
    sender: { login: 'contributor', id: 67890, type: 'User' },
  };
}

/**
 * `issues.edited` with `stas:fix` label present — should re-enqueue.
 */
export function githubIssuesEditedWithStasFix() {
  const payload = githubIssuesLabeledStasFix() as any;
  payload.action = 'edited';
  payload.issue.title = 'Fix broken user login (updated)';
  payload.issue.body = 'Updated description with more details.';
  payload.issue.updated_at = '2025-05-01T13:00:00Z';
  payload.changes = { body: { from: 'Original body' } };
  return payload;
}

/**
 * `issues.edited` WITHOUT the target label — should NOT trigger.
 */
export function githubIssuesEditedWithoutStasFix() {
  const payload = githubIssuesOpened() as any;
  payload.action = 'edited';
  payload.changes = { body: { from: 'Original' } };
  return payload;
}

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

/**
 * `marketplace_purchase` with a "purchased" action.
 */
export function githubMarketplacePurchased() {
  return {
    action: 'purchased',
    effective_date: '2025-05-15T00:00:00Z',
    marketplace_purchase: {
      account: { id: 999, type: 'Organization', login: 'my-org', organization_billing_email: 'billing@my-org.com' },
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
    sender: { login: 'admin', id: 11111, type: 'User' },
  };
}

/**
 * `marketplace_purchase` with a "cancelled" action.
 */
export function githubMarketplaceCancelled() {
  const payload = githubMarketplacePurchased() as any;
  payload.action = 'cancelled';
  payload.marketplace_purchase.plan.name = 'Free Plan';
  return payload;
}

// ---------------------------------------------------------------------------
// Ping
// ---------------------------------------------------------------------------

/**
 * `ping` event — used to verify webhook endpoint connectivity.
 */
export function githubPing() {
  return {
    action: 'ping',
    zen: 'Design for failure.',
    hook_id: 12345678,
    hook: {
      type: 'Repository',
      id: 12345678,
      name: 'web',
      active: true,
      events: ['issues', 'issue_comment', 'pull_request', 'marketplace_purchase'],
      config: {
        content_type: 'json',
        insecure_ssl: '0',
        url: 'https://example.com/webhook',
      },
      updated_at: '2025-05-01T00:00:00Z',
      created_at: '2025-05-01T00:00:00Z',
    },
    repository: {
      id: 100,
      name: 'test-repo',
      full_name: 'owner/test-repo',
      private: false,
      owner: { login: 'owner', id: 999, type: 'User' },
      html_url: 'https://github.com/owner/test-repo',
    },
    sender: { login: 'github', id: 1, type: 'User' },
  };
}
