import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  queryWithRetry: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  rootLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('express', () => {
  const Router = vi.fn(() => ({
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }));
  return {
    default: { Router },
    Router,
    type: {
      Request: class {},
      Response: class {
        status = vi.fn().mockReturnThis();
        json = vi.fn().mockReturnThis();
      },
    },
  };
});

import { queryWithRetry } from '../../../src/db/connection.js';
import {
  resolveAccountId,
  listRuns,
  getRun,
  listRepos,
  createRepo,
  deleteRepo,
  getStats,
  listAuditLogs,
  getSettings,
} from '../services/dashboardService.js';

const mockQuery = queryWithRetry as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAccountId', () => {
  it('returns account id when github user id exists', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 42 }] });
    const result = await resolveAccountId('12345');
    expect(result).toBe(42);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT id FROM accounts WHERE github_user_id = $1',
      [12345],
    );
  });

  it('returns undefined when account not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await resolveAccountId('99999');
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-numeric github user id', async () => {
    const result = await resolveAccountId('not-a-number');
    expect(result).toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('listRuns', () => {
  const accountId = 1;
  const dbRow = {
    id: 10,
    account_id: 1,
    repo_id: 5,
    issue_number: 101,
    status: 'completed',
    confidence: 'high',
    summary: 'Fix login bug',
    pr_url: 'https://github.com/owner/repo/pull/1',
    branch_name: 'fix-login',
    error: null,
    duration_ms: 120000,
    model_used: 'aimino/agi-v1',
    created_at: '2026-06-25T10:00:00.000Z',
    repo_owner: 'my-org',
    repo_name: 'frontend-app',
  };

  it('returns paginated runs without filters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [dbRow] });

    const result = await listRuns(accountId, 1, 20);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].repoOwner).toBe('my-org');
    expect(result.data[0].repoName).toBe('frontend-app');
    expect(result.data[0].status).toBe('completed');
    expect(result.data[0].durationSeconds).toBe(120);
    expect(result.totalPages).toBe(1);
  });

  it('filters by status', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [dbRow] });

    await listRuns(accountId, 1, 20, 'completed');
    const countCall = mockQuery.mock.calls[0];
    expect(countCall[0]).toContain('r.status = $2');
    expect(countCall[1]).toContain('completed');
  });

  it('filters by repo search', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [dbRow] });

    await listRuns(accountId, 1, 20, undefined, 'frontend');
    const countCall = mockQuery.mock.calls[0];
    expect(countCall[0]).toContain('ILIKE');
  });

  it('returns empty array when no runs exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await listRuns(accountId, 1, 20);
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

describe('getRun', () => {
  it('returns run when found', async () => {
    const dbRow = {
      id: 10,
      account_id: 1,
      repo_id: 5,
      issue_number: 101,
      status: 'completed',
      confidence: 'high',
      summary: 'Fix login bug',
      pr_url: 'https://github.com/owner/repo/pull/1',
      branch_name: 'fix-login',
      error: null,
      duration_ms: 120000,
      model_used: 'aimino/agi-v1',
      created_at: '2026-06-25T10:00:00.000Z',
      repo_owner: 'my-org',
      repo_name: 'frontend-app',
    };
    mockQuery.mockResolvedValue({ rows: [dbRow] });

    const result = await getRun(1, 10);
    expect(result).toBeDefined();
    expect(result!.id).toBe(10);
    expect(result!.repoOwner).toBe('my-org');
  });

  it('returns undefined when run not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await getRun(1, 999);
    expect(result).toBeUndefined();
  });
});

describe('listRepos', () => {
  it('returns repos for account', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: 1, owner: 'my-org', name: 'frontend-app', installation_id: 123, account_id: 1, enabled_at: '2026-06-01T00:00:00.000Z' },
      ],
    });
    const result = await listRepos(1);
    expect(result).toHaveLength(1);
    expect(result[0].owner).toBe('my-org');
    expect(result[0].repo).toBe('frontend-app');
    expect(result[0].active).toBe(true);
  });

  it('returns empty array when no repos', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await listRepos(1);
    expect(result).toHaveLength(0);
  });
});

describe('createRepo', () => {
  it('inserts and returns created repo', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, owner: 'my-org', name: 'api-service', installation_id: 456, account_id: 1, enabled_at: '2026-06-25T10:00:00.000Z' }],
    });
    const result = await createRepo(1, 'my-org', 'api-service', 456);
    expect(result.owner).toBe('my-org');
    expect(result.repo).toBe('api-service');
    expect(result.installationId).toBe(456);
  });

  it('handles null installationId', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 2, owner: 'my-org', name: 'test-repo', installation_id: 0, account_id: 1, enabled_at: '2026-06-25T10:00:00.000Z' }],
    });
    const result = await createRepo(1, 'my-org', 'test-repo', null);
    expect(result.owner).toBe('my-org');
  });
});

describe('deleteRepo', () => {
  it('returns true when repo was deleted', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const result = await deleteRepo(1, 5);
    expect(result).toBe(true);
  });

  it('returns false when repo not found', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });
    const result = await deleteRepo(1, 999);
    expect(result).toBe(false);
  });
});

describe('getStats', () => {
  const accountId = 1;

  beforeEach(() => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ total: 100, completed: 80, avg_duration_ms: 120000, active_repos: 5 }],
      })
      .mockResolvedValueOnce({
        rows: [
          { date: '2026-06-12', count: 5, passed: 4 },
          { date: '2026-06-13', count: 8, passed: 7 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { date: '2026-06-12', cost_cents: 500 },
          { date: '2026-06-13', cost_cents: 750 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { week: '2026-05-01', rate: 0.8 },
          { week: '2026-05-08', rate: 0.85 },
        ],
      });
  });

  it('returns aggregated stats from db queries', async () => {
    const result = await getStats(accountId);
    expect(result.totalRuns).toBe(100);
    expect(result.passRate).toBe(0.8);
    expect(result.avgDurationSeconds).toBe(120);
    expect(result.activeRepos).toBe(5);
    expect(result.runsByDay).toHaveLength(2);
    expect(result.costByDay).toHaveLength(2);
    expect(result.fixRateByWeek).toHaveLength(2);
  });

  it('returns zero values when no data exists', async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ total: 0, completed: 0, avg_duration_ms: null, active_repos: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getStats(accountId);
    expect(result.totalRuns).toBe(0);
    expect(result.passRate).toBe(0);
    expect(result.avgDurationSeconds).toBe(0);
    expect(result.activeRepos).toBe(0);
    expect(result.runsByDay).toHaveLength(0);
    expect(result.costByDay).toHaveLength(0);
    expect(result.fixRateByWeek).toHaveLength(0);
  });
});

describe('listAuditLogs', () => {
  const accountId = 1;

  it('returns paginated audit entries', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, timestamp: '2026-06-25T10:00:00.000Z', action: 'run_started', actor_type: 'user', actor_id: '1', resource_type: 'run', resource_id: '10', details_jsonb: null, ip_address: null, user_agent: null, correlation_id: null, actor: 'alice', target: null },
          { id: 2, timestamp: '2026-06-24T10:00:00.000Z', action: 'run_completed', actor_type: 'system', actor_id: null, resource_type: null, resource_id: null, details_jsonb: { repo: 'my-org/frontend-app' }, ip_address: null, user_agent: null, correlation_id: null, actor: null, target: 'run:10' },
        ],
      });

    const result = await listAuditLogs(accountId, 1, 30);
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].action).toBe('run_started');
    expect(result.data[0].actor).toBe('alice');
    expect(result.data[1].details).toEqual({ repo: 'my-org/frontend-app' });
  });

  it('returns empty data when no entries', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await listAuditLogs(accountId, 1, 30);
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('getSettings', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns settings from env vars', () => {
    process.env.SYNTARO_LABEL = 'syntaro:fix';
    process.env.OPENCODE_MODEL = 'aimino/agi-v1';
    process.env.SYNTARO_MAX_CONCURRENT = '10';
    process.env.SANDBOX_POOL_SIZE = '20';
    process.env.SYNTARO_AUDIT_LOG = 'true';

    const result = getSettings();
    expect(result.label).toBe('syntaro:fix');
    expect(result.model).toBe('aimino/agi-v1');
    expect(result.maxConcurrent).toBe(10);
    expect(result.sandboxPoolSize).toBe(20);
    expect(result.auditLogEnabled).toBe(true);
  });

  it('uses defaults when env vars are not set', () => {
    process.env = {};

    const result = getSettings();
    expect(result.label).toBe('syntaro:fix');
    expect(result.model).toBe('aimino/agi-v1');
    expect(result.maxConcurrent).toBe(3);
    expect(result.sandboxPoolSize).toBe(10);
    expect(result.auditLogEnabled).toBe(false);
  });
});
