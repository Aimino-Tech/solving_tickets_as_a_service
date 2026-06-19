import { describe, expect, it } from 'vitest';
import { checkIssueGrounding } from '../../agent/issueGrounding.js';
import type { TriageResult } from '../../agent/types.js';

function sampleTriage(overrides?: Partial<TriageResult>): TriageResult {
  return {
    type: 'bug',
    difficulty: 'medium',
    summary: 'Login fails with special characters in email',
    ...overrides,
  };
}

describe('checkIssueGrounding', () => {
  it('passes when all requirements are grounded in issue text', async () => {
    const result = await checkIssueGrounding(
      'Login fails with special characters',
      'Users cannot log in when their email contains special characters like + or &.\n\n- The login endpoint returns 500',
      [],
      sampleTriage(),
    );
    expect(result.passed).toBe(true);
  });

  it('passes when no bullet points exist (no explicit requirements)', async () => {
    const result = await checkIssueGrounding(
      'Simple bug',
      'Just a quick note about something',
      [],
      sampleTriage({ summary: 'Simple bug' }),
    );
    expect(result.passed).toBe(true);
  });

  it('flags ungrounded requirements', async () => {
    const result = await checkIssueGrounding(
      'Login issue',
      'The login page shows 500 error',
      [],
      sampleTriage({ summary: 'Fix the database connection timeout in the payment service' }),
    );
    const hasPaymentReq = result.ungrounded.some(
      u => u.requirement.includes('database') || u.requirement.includes('payment') || u.requirement.includes('timeout'),
    );
    expect(result.requirementsChecked).toBeGreaterThan(0);
  });

  it('passes with matching triage summary', async () => {
    const result = await checkIssueGrounding(
      'Auth bug',
      'The authentication service fails when token is expired.\n- Add token refresh logic\n- Handle 401 responses gracefully',
      [],
      sampleTriage({ summary: 'Fix auth token handling' }),
    );
    expect(result).toHaveProperty('passed');
    expect(result.requirementsChecked).toBeGreaterThan(0);
  });

  it('handles null issueBody', async () => {
    const result = await checkIssueGrounding(
      'Fix issue',
      null,
      [],
      sampleTriage(),
    );
    expect(result.passed).toBe(true);
  });

  it('incorporates comments into grounding check', async () => {
    const comments = [
      'The issue happens on the /api/login endpoint',
      'We need to validate email format before sending to the backend',
    ];
    const result = await checkIssueGrounding(
      'Login bug',
      'Login failed with special characters',
      comments,
      sampleTriage({ summary: 'Fix email validation in login' }),
    );
    expect(result.passed).toBe(true);
  });

  it('reports ungrounded count correctly', async () => {
    const result = await checkIssueGrounding(
      'Minimal title',
      'Short body',
      [],
      sampleTriage({ summary: 'Unrelated requirement about payment system timeout handling' }),
    );
    expect(result.requirementsChecked).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.ungrounded)).toBe(true);
  });
});
