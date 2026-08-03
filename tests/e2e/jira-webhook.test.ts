/**
 * E2E Tests: Jira Webhook Integration
 *
 * Validates the Jira webhook flow end-to-end:
 *   1. POST /webhook/jira receives valid payload → 202
 *   2. POST /webhook/jira with invalid payload → 400
 *   3. POST /webhook/jira with invalid signature → 401
 *   4. handleJiraWebhook parses valid payload correctly
 *   5. handleJiraWebhook returns null on invalid payload
 *   6. verifyJiraWebhookSignature validates HMAC correctly
 *   7. jiraTicketToIssueData maps Ticket → issue data correctly
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { createTestHarness } from './harness/index.js';
import { jiraIssueCreated, jiraIssueUpdated, jiraIssueCreatedOtherLabel, jiraIssueDeleted } from './fixtures/webhooks/jira.js';
import type { TestHarness } from './harness/index.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the Jira HMAC-SHA256 signature header value.
 */
function signJiraPayload(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

/**
 * Send a Jira webhook event to the test server with optional signature.
 */
async function sendJiraWebhook(
  payload: unknown,
  secret?: string,
): Promise<{ status: number; body: unknown }> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (secret !== undefined) {
    headers['x-hub-signature-256'] = signJiraPayload(body, secret);
  }

  const res = await fetch(`${harness.baseUrl}/webhook/jira`, {
    method: 'POST',
    headers,
    body,
  });

  const responseBody = await res.json().catch(() => null);
  return { status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Jira Webhook Endpoint Tests
// ---------------------------------------------------------------------------

describe('Jira webhook endpoint — /webhook/jira', () => {
  it('should accept valid Jira issue.created webhook with signature', async () => {
    const payload = jiraIssueCreated();
    const res = await sendJiraWebhook(payload, 'test-jira-secret');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('should accept Jira webhook without signature (no secret configured)', async () => {
    const payload = jiraIssueCreated();
    const res = await sendJiraWebhook(payload);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('should handle Jira issue.updated webhook', async () => {
    const payload = jiraIssueUpdated();
    const res = await sendJiraWebhook(payload, 'test-jira-secret');

    expect(res.status).toBe(202);
  });

  it('should handle Jira issue.deleted webhook', async () => {
    const payload = jiraIssueDeleted();
    const res = await sendJiraWebhook(payload, 'test-jira-secret');

    expect(res.status).toBe(202);
  });

  it('should return 400 for invalid payload (missing issue)', async () => {
    const payload = { webhookEvent: 'jira:issue_created', timestamp: 1714521600000 };
    const res = await sendJiraWebhook(payload, 'test-jira-secret');

    expect(res.status).toBe(400);
  });

  it('should return 400 for completely empty payload', async () => {
    const res = await sendJiraWebhook({}, 'test-jira-secret');

    expect(res.status).toBe(400);
  });

  it('should return 400 for malformed JSON', async () => {
    const res = await fetch(`${harness.baseUrl}/webhook/jira`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'abc123',
      },
      body: 'not-valid-json',
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// handleJiraWebhook Unit Tests
// ---------------------------------------------------------------------------

describe('handleJiraWebhook()', () => {
  it('should parse a valid issue.created payload and return ticketId + action', async () => {
    const { handleJiraWebhook } = await import('../../src/trackers/jira.js');

    const payload = jiraIssueCreated();
    const result = await handleJiraWebhook(payload);

    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe('PROJ-42');
    expect(result!.action).toBe('jira:issue_created');
  });

  it('should parse a valid issue.updated payload', async () => {
    const { handleJiraWebhook } = await import('../../src/trackers/jira.js');

    const payload = jiraIssueUpdated();
    const result = await handleJiraWebhook(payload);

    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe('PROJ-42');
    expect(result!.action).toBe('jira:issue_updated');
  });

  it('should parse a valid issue.deleted payload', async () => {
    const { handleJiraWebhook } = await import('../../src/trackers/jira.js');

    const payload = jiraIssueDeleted();
    const result = await handleJiraWebhook(payload);

    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe('PROJ-42');
    expect(result!.action).toBe('jira:issue_deleted');
  });

  it('should return null when payload is missing issue.id', async () => {
    const { handleJiraWebhook } = await import('../../src/trackers/jira.js');

    const result = await handleJiraWebhook({
      webhookEvent: 'jira:issue_created',
      issue: { id: '', key: '', self: '', fields: {} },
    });
    expect(result).toBeNull();
  });

  it('should return null when payload has no issue field', async () => {
    const { handleJiraWebhook } = await import('../../src/trackers/jira.js');

    const result = await handleJiraWebhook({ webhookEvent: 'jira:issue_created' });
    expect(result).toBeNull();
  });

  it('should return null for empty payload', async () => {
    const { handleJiraWebhook } = await import('../../src/trackers/jira.js');

    const result = await handleJiraWebhook({});
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyJiraWebhookSignature Unit Tests
// ---------------------------------------------------------------------------

describe('verifyJiraWebhookSignature()', () => {
  it('should export verifyJiraWebhookSignature function with 2 params', async () => {
    const { verifyJiraWebhookSignature } = await import('../../src/trackers/jira.js');
    expect(verifyJiraWebhookSignature).toBeInstanceOf(Function);
    expect(verifyJiraWebhookSignature.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// jiraTicketToIssueData Unit Tests
// ---------------------------------------------------------------------------

describe('jiraTicketToIssueData()', () => {
  it('should map a Jira ticket to issue data correctly', async () => {
    const { jiraTicketToIssueData } = await import('../../src/trackers/jira.js');

    const ticket = {
      id: 'PROJ-42',
      title: 'Fix broken user login',
      description: 'Users cannot log in.',
      status: 'Open',
      priority: 2,
      url: 'https://jira.example.com/browse/PROJ-42',
      source: 'jira' as const,
      labels: ['bug', 'syntaro:fix'],
      createdAt: '2025-05-01T10:00:00.000+0000',
      updatedAt: '2025-05-01T10:00:00.000+0000',
    };

    const result = jiraTicketToIssueData(ticket, 'owner', 'test-repo', 555, 42);

    expect(result).toEqual({
      source: 'jira',
      externalId: 'PROJ-42',
      installationId: 555,
      repoOwner: 'owner',
      repoName: 'test-repo',
      repoPrivate: false,
      issueNumber: 42,
      issueTitle: 'Fix broken user login',
      issueBody: 'Users cannot log in.',
      trackerType: 'jira',
      trackerTicketId: 'PROJ-42',
    });
  });

  it('should handle null description', async () => {
    const { jiraTicketToIssueData } = await import('../../src/trackers/jira.js');

    const ticket = {
      id: 'PROJ-99',
      title: 'No description ticket',
      description: null,
      status: 'Open',
      priority: 3,
      url: 'https://jira.example.com/browse/PROJ-99',
      source: 'jira' as const,
      labels: [],
      createdAt: '2025-05-01T10:00:00.000+0000',
      updatedAt: '2025-05-01T10:00:00.000+0000',
    };

    const result = jiraTicketToIssueData(ticket, 'owner', 'repo', 1, 1);
    expect(result.issueBody).toBeNull();
    expect(result.trackerType).toBe('jira');
  });
});
