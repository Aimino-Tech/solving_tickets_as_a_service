/**
 * Unit tests for dashboard API types — runtime structural verification.
 *
 * These TypeScript interfaces are compile-time only; at runtime we verify
 * that objects matching the interface shapes can be constructed correctly.
 *
 * Tests types from: dashboard/src/api/types.ts
 */

import { describe, expect, it } from 'vitest';
import type {
  User,
  Run,
  Repo,
  DashboardStats,
  AuditEntry,
  PaginatedResponse,
} from '../../../dashboard/src/api/types.js';

// ── User ────────────────────────────────────────────────────────────────────

describe('User', () => {
  it('can be constructed with required fields', () => {
    const user: User = {
      githubId: '12345',
      username: 'testuser',
    };

    expect(user.githubId).toBe('12345');
    expect(user.username).toBe('testuser');
  });

  it('accepts optional avatarUrl', () => {
    const user: User = {
      githubId: '12345',
      username: 'testuser',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
    };

    expect(user.avatarUrl).toBeDefined();
    expect(user.avatarUrl).toMatch(/^https:\/\/avatars\.githubusercontent\.com/);
  });

  it('works without avatarUrl', () => {
    const user: User = {
      githubId: '12345',
      username: 'testuser',
    };

    expect(user.avatarUrl).toBeUndefined();
  });

  it('has strictly-typed string fields', () => {
    const user: User = {
      githubId: 'abc',
      username: 'def',
    };

    expect(typeof user.githubId).toBe('string');
    expect(typeof user.username).toBe('string');
  });
});

// ── Run ─────────────────────────────────────────────────────────────────────

describe('Run', () => {
  it('can be constructed with all fields', () => {
    const run: Run = {
      id: 'run-001',
      repoOwner: 'my-org',
      repoName: 'frontend-app',
      issueNumber: 42,
      issueTitle: 'Fix broken login',
      status: 'success',
      modelUsed: 'aimino/agi-v1',
      costCents: 150,
      durationSeconds: 120,
      prUrl: 'https://github.com/my-org/frontend-app/pull/101',
      errorMessage: undefined,
      createdAt: '2025-05-01T10:00:00Z',
      updatedAt: '2025-05-01T10:02:00Z',
    };

    expect(run.id).toBe('run-001');
    expect(run.issueNumber).toBe(42);
    expect(run.status).toBe('success');
    expect(run.prUrl).toContain('github.com');
  });

  it('accepts all status values', () => {
    const statuses: Run['status'][] = ['queued', 'running', 'success', 'failed', 'cancelled'];

    for (const status of statuses) {
      const run: Run = {
        id: 'r-1',
        repoOwner: 'o',
        repoName: 'r',
        issueNumber: 1,
        issueTitle: 't',
        status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(run.status).toBe(status);
    }
  });

  it('accepts optional fields as undefined', () => {
    const run: Run = {
      id: 'r-1',
      repoOwner: 'o',
      repoName: 'r',
      issueNumber: 1,
      issueTitle: 't',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(run.modelUsed).toBeUndefined();
    expect(run.costCents).toBeUndefined();
    expect(run.durationSeconds).toBeUndefined();
    expect(run.prUrl).toBeUndefined();
    expect(run.errorMessage).toBeUndefined();
  });

  it('has correct field types', () => {
    const run: Run = {
      id: 'r-1',
      repoOwner: 'o',
      repoName: 'r',
      issueNumber: 42,
      issueTitle: 'Test issue',
      status: 'running',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T01:00:00Z',
    };

    expect(typeof run.id).toBe('string');
    expect(typeof run.issueNumber).toBe('number');
    expect(Number.isInteger(run.issueNumber)).toBe(true);
    expect(typeof run.createdAt).toBe('string');
  });
});

// ── Repo ────────────────────────────────────────────────────────────────────

describe('Repo', () => {
  it('can be constructed with all fields', () => {
    const repo: Repo = {
      id: 'repo-001',
      owner: 'my-org',
      repo: 'frontend-app',
      active: true,
      installationId: 123456,
      createdAt: '2025-05-01T00:00:00Z',
    };

    expect(repo.owner).toBe('my-org');
    expect(repo.repo).toBe('frontend-app');
    expect(repo.active).toBe(true);
    expect(repo.installationId).toBe(123456);
  });

  it('accepts optional installationId', () => {
    const repo: Repo = {
      id: 'repo-002',
      owner: 'my-org',
      repo: 'api-service',
      active: false,
      createdAt: '2025-05-02T00:00:00Z',
    };

    expect(repo.installationId).toBeUndefined();
  });

  it('accepts both active true and false', () => {
    const active: Repo = {
      id: '1', owner: 'o', repo: 'r', active: true, createdAt: '2025-01-01T00:00:00Z',
    };
    const inactive: Repo = {
      id: '2', owner: 'o', repo: 'r', active: false, createdAt: '2025-01-01T00:00:00Z',
    };

    expect(active.active).toBe(true);
    expect(inactive.active).toBe(false);
  });
});

// ── DashboardStats ──────────────────────────────────────────────────────────

describe('DashboardStats', () => {
  it('can be constructed with all fields', () => {
    const stats: DashboardStats = {
      totalRuns: 150,
      passRate: 0.85,
      avgDurationSeconds: 180,
      activeRepos: 5,
      runsByDay: [
        { date: '2025-05-01', count: 10, passed: 8 },
        { date: '2025-05-02', count: 12, passed: 10 },
      ],
      costByDay: [
        { date: '2025-05-01', costCents: 500 },
        { date: '2025-05-02', costCents: 600 },
      ],
      fixRateByWeek: [
        { week: '2025-04-28', rate: 0.82 },
        { week: '2025-05-05', rate: 0.88 },
      ],
    };

    expect(stats.totalRuns).toBe(150);
    expect(stats.passRate).toBeCloseTo(0.85);
    expect(stats.runsByDay).toHaveLength(2);
    expect(stats.costByDay).toHaveLength(2);
    expect(stats.fixRateByWeek).toHaveLength(2);
  });

  it('handles empty arrays', () => {
    const stats: DashboardStats = {
      totalRuns: 0,
      passRate: 0,
      avgDurationSeconds: 0,
      activeRepos: 0,
      runsByDay: [],
      costByDay: [],
      fixRateByWeek: [],
    };

    expect(stats.runsByDay).toEqual([]);
    expect(stats.costByDay).toEqual([]);
    expect(stats.fixRateByWeek).toEqual([]);
    expect(stats.totalRuns).toBe(0);
  });

  it('has numeric fields that are numbers', () => {
    const stats: DashboardStats = {
      totalRuns: 100,
      passRate: 0.75,
      avgDurationSeconds: 200,
      activeRepos: 3,
      runsByDay: [],
      costByDay: [],
      fixRateByWeek: [],
    };

    expect(typeof stats.totalRuns).toBe('number');
    expect(typeof stats.passRate).toBe('number');
    expect(typeof stats.avgDurationSeconds).toBe('number');
    expect(typeof stats.activeRepos).toBe('number');
  });
});

// ── AuditEntry ──────────────────────────────────────────────────────────────

describe('AuditEntry', () => {
  it('can be constructed with required fields', () => {
    const entry: AuditEntry = {
      id: 'audit-001',
      action: 'run_started',
      actor: 'alice',
      createdAt: '2025-05-01T10:00:00Z',
    };

    expect(entry.id).toBe('audit-001');
    expect(entry.action).toBe('run_started');
    expect(entry.actor).toBe('alice');
  });

  it('accepts optional target and details', () => {
    const entry: AuditEntry = {
      id: 'audit-002',
      action: 'run_completed',
      actor: 'system',
      target: 'Run #42',
      details: { repo: 'my-org/frontend-app', issue: 42 },
      createdAt: '2025-05-01T11:00:00Z',
    };

    expect(entry.target).toBe('Run #42');
    expect(entry.details).toEqual({ repo: 'my-org/frontend-app', issue: 42 });
  });
});

// ── PaginatedResponse ───────────────────────────────────────────────────────

describe('PaginatedResponse', () => {
  it('can be constructed with generic type', () => {
    const response: PaginatedResponse<{ name: string }> = {
      data: [{ name: 'item1' }, { name: 'item2' }],
      total: 2,
      page: 1,
      perPage: 20,
      totalPages: 1,
    };

    expect(response.data).toHaveLength(2);
    expect(response.total).toBe(2);
    expect(response.page).toBe(1);
    expect(response.perPage).toBe(20);
    expect(response.totalPages).toBe(1);
  });

  it('works with number arrays', () => {
    const response: PaginatedResponse<number> = {
      data: [1, 2, 3],
      total: 3,
      page: 1,
      perPage: 10,
      totalPages: 1,
    };

    expect(response.data).toEqual([1, 2, 3]);
  });

  it('handles empty data', () => {
    const response: PaginatedResponse<never> = {
      data: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    };

    expect(response.data).toEqual([]);
    expect(response.totalPages).toBe(0);
  });

  it('has correct numeric field types', () => {
    const response: PaginatedResponse<string> = {
      data: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    };

    expect(typeof response.total).toBe('number');
    expect(typeof response.page).toBe('number');
    expect(typeof response.perPage).toBe('number');
    expect(typeof response.totalPages).toBe('number');
    expect(Array.isArray(response.data)).toBe(true);
  });
});
