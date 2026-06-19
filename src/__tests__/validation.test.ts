/**
 * Unit tests for src/validation.ts — Zod webhook payload validation.
 *
 * Tests the Zod schemas (issueLabeledSchema, issueOpenedSchema,
 * marketplacePurchaseSchema, webhookSchemas) and the main
 * validateWebhookPayload() function.
 *
 * ── Coverage ─────────────────────────────────────────────────────────
 * ✅ issueLabeledSchema — valid payload passes
 * ✅ issueOpenedSchema — valid payload passes
 * ✅ marketplacePurchaseSchema — valid payload passes
 * ✅ validateWebhookPayload — dispatches to correct schema
 * ✅ Unknown events return success: true (no schema matched)
 * ✅ Missing required fields produce structured error messages
 * ✅ Invalid field types produce structured error messages
 * ✅ Schema registry exports all schemas
 * ─────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';
import {
  issueLabeledSchema,
  issueOpenedSchema,
  marketplacePurchaseSchema,
  webhookSchemas,
  validateWebhookPayload,
} from '../validation.js';

// ── issueLabeledSchema ───────────────────────────────────────────────

describe('issueLabeledSchema', () => {
  it('accepts a valid labeled issue payload', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix bug', body: 'Details about the bug' },
      label: { name: 'stas:fix' },
      action: 'labeled',
      sender: { login: 'testuser', id: 12345 },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts payload without label and sender (optional)', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix bug', body: 'Details' },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts payload with nullable label', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix bug', body: 'Details' },
      label: null,
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing installation', () => {
    const payload = {
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix bug', body: 'Details' },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing issue.number', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { title: 'Fix bug', body: 'Details' },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects payload with non-numeric issue.number', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 'not-a-number', title: 'Bug', body: 'Details' },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts payload with issue.html_url and labels', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: {
        number: 42,
        title: 'Fix',
        body: 'body',
        html_url: 'https://github.com/owner/repo/issues/42',
        labels: [{ name: 'bug' }],
      },
      label: { name: 'stas:fix' },
      sender: { login: 'user', id: 1 },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts nullable issue.body', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix', body: null },
    };

    const result = issueLabeledSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

// ── issueOpenedSchema ────────────────────────────────────────────────

describe('issueOpenedSchema', () => {
  it('accepts a valid opened issue payload (without label)', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 43, title: 'New feature', body: 'Description' },
      sender: { login: 'contributor', id: 67890 },
    };

    const result = issueOpenedSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing issue.title', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 43, body: 'Description' },
    };

    const result = issueOpenedSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('omits label field (not present in schema)', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 43, title: 'Feature', body: 'desc' },
    };

    const result = issueOpenedSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('label');
  });
});

// ── marketplacePurchaseSchema ────────────────────────────────────────

describe('marketplacePurchaseSchema', () => {
  it('accepts a valid marketplace purchase payload', () => {
    const payload = {
      action: 'purchased',
      effective_date: '2025-05-15T00:00:00Z',
      marketplace_purchase: {
        account: { id: 999, type: 'Organization' },
        plan: { name: 'Pro Plan' },
      },
      sender: { login: 'admin', id: 11111 },
    };

    const result = marketplacePurchaseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts payload without effective_date and account type (optional)', () => {
    const payload = {
      action: 'cancelled',
      marketplace_purchase: {
        account: { id: 999 },
        plan: { name: 'Free Plan' },
      },
    };

    const result = marketplacePurchaseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing marketplace_purchase', () => {
    const payload = {
      action: 'purchased',
    };

    const result = marketplacePurchaseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing plan name', () => {
    const payload = {
      action: 'purchased',
      marketplace_purchase: {
        account: { id: 999 },
        plan: {},
      },
    };

    const result = marketplacePurchaseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

// ── webhookSchemas registry ──────────────────────────────────────────

describe('webhookSchemas registry', () => {
  it('contains issueLabeledSchema for issues.labeled', () => {
    expect(webhookSchemas['issues.labeled']).toBe(issueLabeledSchema);
  });

  it('contains issueOpenedSchema for issues.opened', () => {
    expect(webhookSchemas['issues.opened']).toBe(issueOpenedSchema);
  });

  it('contains marketplacePurchaseSchema for marketplace_purchase', () => {
    expect(webhookSchemas['marketplace_purchase']).toBe(marketplacePurchaseSchema);
  });

  it('is frozen (cannot add new entries at runtime)', () => {
    expect(Object.isFrozen(webhookSchemas)).toBe(true);
  });
});

// ── validateWebhookPayload ───────────────────────────────────────────

describe('validateWebhookPayload', () => {
  it('returns success with data for a valid issues.labeled payload', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix bug', body: 'Details' },
      label: { name: 'stas:fix' },
    };

    const result = validateWebhookPayload('issues.labeled', payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('issue');
    }
  });

  it('returns success with data for a valid issues.opened payload', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 43, title: 'Feature', body: 'desc' },
    };

    const result = validateWebhookPayload('issues.opened', payload);
    expect(result.success).toBe(true);
  });

  it('returns success with data for a valid marketplace_purchase payload', () => {
    const payload = {
      action: 'purchased',
      marketplace_purchase: {
        account: { id: 999, type: 'Organization' },
        plan: { name: 'Pro Plan' },
      },
    };

    const result = validateWebhookPayload('marketplace_purchase', payload);
    expect(result.success).toBe(true);
  });

  it('returns success for unknown events (no schema matched)', () => {
    const payload = { some: 'data' };
    const result = validateWebhookPayload('unknown.event', payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ some: 'data' });
    }
  });

  it('returns success for empty payload on unknown event', () => {
    const result = validateWebhookPayload('issues.milestoned', {});
    expect(result.success).toBe(true);
  });

  it('returns structured errors when payload has missing required fields', () => {
    const payload = {
      // Missing installation
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix', body: 'body' },
    };

    const result = validateWebhookPayload('issues.labeled', payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      const allErrors = result.errors.join(' ');
      expect(allErrors).toContain('installation');
    }
  });

  it('returns structured errors when issue.number is missing', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { title: 'Fix', body: 'body' },
    };

    const result = validateWebhookPayload('issues.labeled', payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('issue.number'))).toBe(true);
    }
  });

  it('returns errors for invalid field types', () => {
    const payload = {
      installation: { id: 'not-a-number' },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix', body: 'body' },
    };

    const result = validateWebhookPayload('issues.labeled', payload);
    expect(result.success).toBe(false);
  });

  it('returns "Missing required field" for undefined fields', () => {
    const payload = {
      installation: { id: 555 },
      // Missing repository
      issue: { number: 42, title: 'Fix', body: 'body' },
    };

    const result = validateWebhookPayload('issues.labeled', payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('Missing required field'))).toBe(true);
    }
  });

  it('handles null payload gracefully', () => {
    const result = validateWebhookPayload('issues.labeled', null);
    expect(result.success).toBe(false);
  });

  it('handles undefined payload gracefully', () => {
    const result = validateWebhookPayload('issues.labeled', undefined);
    expect(result.success).toBe(false);
  });

  it('handles empty object payload for known events', () => {
    const result = validateWebhookPayload('issues.labeled', {});
    expect(result.success).toBe(false);
  });

  it('preserves parsed data on success', () => {
    const payload = {
      installation: { id: 555 },
      repository: { name: 'test-repo', owner: { login: 'owner' } },
      issue: { number: 42, title: 'Fix bug', body: 'Details' },
      action: 'labeled',
    };

    const result = validateWebhookPayload('issues.labeled', payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        installation: { id: 555 },
        issue: { number: 42 },
      });
    }
  });

  it('handles unexpected event name with success', () => {
    const result = validateWebhookPayload('ping', { zen: 'Speak like a human' });
    expect(result.success).toBe(true);
  });
});

// ── Export types ─────────────────────────────────────────────────────

describe('type exports', () => {
  it('exports ValidationResult type (structural check)', () => {
    // Just verify the function signatures are correct
    const successResult = validateWebhookPayload('ping', {});
    expect(typeof successResult.success).toBe('boolean');

    const errorResult = validateWebhookPayload('issues.labeled', {});
    expect(typeof errorResult.success).toBe('boolean');
    if (!errorResult.success) {
      expect(Array.isArray(errorResult.errors)).toBe(true);
    }
  });
});
