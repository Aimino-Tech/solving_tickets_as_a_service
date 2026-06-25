/**
 * Unit tests for type definitions — runtime structural verification.
 *
 * TypeScript interfaces are compile-time only; at runtime we verify that
 * objects matching the interface shapes can be constructed correctly.
 *
 * Covers:
 *   - src/utils/types.ts  → IssueJobData, BillingPlan, AgentResult
 *   - src/agent/types.ts  → TestResult (referenced in the task requirements)
 */

import { describe, expect, it } from 'vitest';
import type { AgentResult as AgentAgentResult, TestResult } from '../../agent/types.js';
import type { BillingPlan, IssueJobData, AgentResult as UtilsAgentResult } from '../../utils/types.js';

// ── IssueJobData ────────────────────────────────────────────────────────────

describe('IssueJobData', () => {
  it('can be constructed with all required fields', () => {
    const job: IssueJobData = {
      installationId: 555,
      repoOwner: 'owner',
      repoName: 'test-repo',
      repoPrivate: false,
      issueNumber: 42,
      issueTitle: 'Fix broken login',
      issueBody: 'Users cannot log in with special characters.',
    };

    expect(job.installationId).toBe(555);
    expect(job.repoOwner).toBe('owner');
    expect(job.repoName).toBe('test-repo');
    expect(job.repoPrivate).toBe(false);
    expect(job.issueNumber).toBe(42);
    expect(job.issueTitle).toBe('Fix broken login');
    expect(job.issueBody).toBe('Users cannot log in with special characters.');
  });

  it('accepts null for issueBody', () => {
    const job: IssueJobData = {
      installationId: 1,
      repoOwner: 'o',
      repoName: 'r',
      repoPrivate: true,
      issueNumber: 1,
      issueTitle: 't',
      issueBody: null,
    };

    expect(job.issueBody).toBeNull();
  });

  it('accepts numeric fields as numbers', () => {
    const job: IssueJobData = {
      installationId: 999,
      repoOwner: 'a',
      repoName: 'b',
      repoPrivate: false,
      issueNumber: 100,
      issueTitle: 't',
      issueBody: 'body',
    };

    expect(typeof job.installationId).toBe('number');
    expect(typeof job.issueNumber).toBe('number');
    expect(Number.isInteger(job.installationId)).toBe(true);
    expect(Number.isInteger(job.issueNumber)).toBe(true);
  });

  it('accepts boolean for repoPrivate', () => {
    const publicJob: IssueJobData = {
      installationId: 1,
      repoOwner: 'o',
      repoName: 'r',
      repoPrivate: false,
      issueNumber: 1,
      issueTitle: 't',
      issueBody: null,
    };
    const privateJob: IssueJobData = {
      installationId: 2,
      repoOwner: 'o',
      repoName: 'r',
      repoPrivate: true,
      issueNumber: 2,
      issueTitle: 't',
      issueBody: null,
    };

    expect(publicJob.repoPrivate).toBe(false);
    expect(privateJob.repoPrivate).toBe(true);
  });
});

// ── BillingPlan ─────────────────────────────────────────────────────────────

describe('BillingPlan', () => {
  it("can be constructed with 'free' plan", () => {
    const plan: BillingPlan = {
      plan: 'free',
      accountId: 123,
      effectiveAt: '2025-01-01T00:00:00Z',
    };

    expect(plan.plan).toBe('free');
    expect(plan.accountId).toBe(123);
    expect(plan.effectiveAt).toBe('2025-01-01T00:00:00Z');
  });

  it("can be constructed with 'pro', 'team', and 'enterprise' plans", () => {
    const pro: BillingPlan = {
      plan: 'pro',
      accountId: 456,
      effectiveAt: '2025-06-01T00:00:00Z',
    };
    const team: BillingPlan = {
      plan: 'team',
      accountId: 789,
      effectiveAt: '2025-06-15T00:00:00Z',
    };
    const enterprise: BillingPlan = {
      plan: 'enterprise',
      accountId: 101,
      effectiveAt: '2025-06-15T00:00:00Z',
    };

    expect(pro.plan).toBe('pro');
    expect(team.plan).toBe('team');
    expect(enterprise.plan).toBe('enterprise');
  });

  it('stores effectiveAt as an ISO date string', () => {
    const plan: BillingPlan = {
      plan: 'free',
      accountId: 1,
      effectiveAt: '2025-05-15T00:00:00Z',
    };
    const parsed = new Date(plan.effectiveAt);
    expect(parsed.toISOString()).toBe('2025-05-15T00:00:00.000Z');
    expect(plan.effectiveAt.endsWith('Z')).toBe(true);
  });
});

// ── AgentResult (utils/types.ts) ────────────────────────────────────────────

describe('AgentResult (utils/types.ts)', () => {
  it('can be constructed with only required fields', () => {
    const result: UtilsAgentResult = {
      summary: 'Fixed the login handler.',
      confidence: 'high',
      fixReady: true,
    };

    expect(result.summary).toBe('Fixed the login handler.');
    expect(result.confidence).toBe('high');
    expect(result.fixReady).toBe(true);
  });

  it('accepts all confidence levels', () => {
    const high: UtilsAgentResult = {
      summary: 's',
      confidence: 'high',
      fixReady: true,
    };
    const medium: UtilsAgentResult = {
      summary: 's',
      confidence: 'medium',
      fixReady: true,
    };
    const low: UtilsAgentResult = {
      summary: 's',
      confidence: 'low',
      fixReady: false,
    };

    expect(high.confidence).toBe('high');
    expect(medium.confidence).toBe('medium');
    expect(low.confidence).toBe('low');
  });

  it('accepts optional fields', () => {
    const result: UtilsAgentResult = {
      summary: 'Investigation complete.',
      confidence: 'low',
      fixReady: false,
      prUrl: 'https://github.com/owner/repo/pull/42',
      branchName: 'fix/login',
      diff: 'diff --git a/src/login.ts b/src/login.ts',
      testOutput: 'PASS 2 tests',
      errors: ['ESLint warning: unused variable'],
      relevantPRs: [{ url: 'https://github.com/owner/repo/pull/41', title: 'Fix', state: 'open' }],
      noFixReason: 'Cannot reproduce the issue.',
      alreadyFixed: true,
      investigationOnly: false,
    };

    expect(result.prUrl).toBeDefined();
    expect(result.branchName).toBe('fix/login');
    expect(result.diff).toContain('diff --git');
    expect(result.errors).toHaveLength(1);
    expect(result.relevantPRs).toHaveLength(1);
    expect(result.relevantPRs![0].url).toBe('https://github.com/owner/repo/pull/41');
    expect(result.noFixReason).toBe('Cannot reproduce the issue.');
    expect(result.alreadyFixed).toBe(true);
    expect(result.investigationOnly).toBe(false);
  });

  it('accepts empty errors array', () => {
    const result: UtilsAgentResult = {
      summary: 's',
      confidence: 'medium',
      fixReady: true,
      errors: [],
    };

    expect(result.errors).toEqual([]);
  });
});

// ── AgentResult (agent/types.ts) ───────────────────────────────────────────

describe('AgentResult (agent/types.ts)', () => {
  // This mirrors the utils/types.ts AgentResult (same shape at runtime).
  it('has the same shape as utils/types.ts AgentResult', () => {
    const result: AgentAgentResult = {
      summary: 'Fixed bug',
      confidence: 'high',
      fixReady: true,
      prUrl: 'https://github.com/o/r/p/1',
      diff: 'diff --git a/src/index.ts b/src/index.ts',
      testOutput: 'PASS',
      errors: [],
      alreadyFixed: false,
    };

    // Both AgentResult types share the same fields
    expect(result.summary).toBe('Fixed bug');
    expect(result.confidence).toBe('high');
    expect(result.fixReady).toBe(true);
    expect(result.prUrl).toContain('github.com');
    expect(result.errors).toEqual([]);
  });
});

// ── TestResult (agent/types.ts) ─────────────────────────────────────────────

describe('TestResult', () => {
  it('can be constructed with all fields', () => {
    const tr: TestResult = {
      passed: true,
      output: 'PASS tests/login.test.ts (42ms)',
      command: 'npm test -- --run',
      durationMs: 4200,
    };

    expect(tr.passed).toBe(true);
    expect(tr.output).toContain('PASS');
    expect(tr.command).toBe('npm test -- --run');
    expect(tr.durationMs).toBe(4200);
  });

  it('accepts failed test results', () => {
    const tr: TestResult = {
      passed: false,
      output: 'FAIL tests/login.test.ts\n  AssertionError: expected 2 to be 3',
      command: 'npm test -- --run',
      durationMs: 1500,
    };

    expect(tr.passed).toBe(false);
    expect(tr.output).toContain('FAIL');
    expect(tr.durationMs).toBeGreaterThan(0);
  });

  it('has strictly-typed numeric fields', () => {
    const tr: TestResult = {
      passed: true,
      output: '',
      command: 'echo ok',
      durationMs: 0,
    };

    expect(typeof tr.durationMs).toBe('number');
    expect(typeof tr.passed).toBe('boolean');
    expect(typeof tr.output).toBe('string');
    expect(typeof tr.command).toBe('string');
  });
});
