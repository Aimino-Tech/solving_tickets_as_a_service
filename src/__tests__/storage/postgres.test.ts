/**
 * Unit tests for src/storage/postgres/index.ts — Postgres storage backend.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery, closePool: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('storage/postgres', () => {
  let PostgresStorage: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../storage/postgres/index.js');
    PostgresStorage = mod.PostgresStorage;
  });

  it('creates a storage instance', () => {
    const storage = new PostgresStorage();
    expect(storage).toBeDefined();
  });

  it('saves a run record', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, installation_id: 1, repo_owner: 'owner', repo_name: 'repo', issue_number: 42, status: 'completed' }],
    });

    const storage = new PostgresStorage();
    const saved = await storage.saveRun({
      installationId: 1,
      repoOwner: 'owner',
      repoName: 'repo',
      issueNumber: 42,
      status: 'completed',
    });
    expect(saved.id).toBe(1);
    expect(saved.status).toBe('completed');
  });

  it('gets a run by ID', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, installation_id: 1, repo_owner: 'owner', repo_name: 'repo', issue_number: 42, status: 'completed' }],
    });

    const storage = new PostgresStorage();
    const run = await storage.getRun(1);
    expect(run).toBeDefined();
    expect(run!.repoOwner).toBe('owner');
  });

  it('returns undefined for missing run', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const storage = new PostgresStorage();
    const run = await storage.getRun(999);
    expect(run).toBeUndefined();
  });

  it('lists runs', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: 1, installation_id: 1, repo_owner: 'owner', repo_name: 'repo', issue_number: 1, status: 'completed' },
        { id: 2, installation_id: 1, repo_owner: 'owner', repo_name: 'repo', issue_number: 2, status: 'failed' },
      ],
    });

    const storage = new PostgresStorage();
    const runs = await storage.listRuns({ limit: 10, offset: 0 });
    expect(runs.length).toBe(2);
  });

  it('gets run stats', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ total: 10, pass_rate: 0.8, avg_duration_ms: 150 }],
    });

    const storage = new PostgresStorage();
    const stats = await storage.getRunStats({});
    expect(stats.total).toBe(10);
    expect(stats.passRate).toBe(0.8);
  });

  it('closes the pool', async () => {
    vi.mock('../../db/connection.js', () => ({
      queryWithRetry: mockQuery,
      closePool: vi.fn(),
    }));
    const mod = await import('../../storage/postgres/index.js');
    const storage = new mod.PostgresStorage();
    await storage.close();
    const { closePool } = await import('../../db/connection.js');
    expect(closePool).toHaveBeenCalled();
  });
});
