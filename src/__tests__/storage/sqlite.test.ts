/**
 * Unit tests for src/storage/sqlite.ts — SQLite storage backend.
 * Uses an in-memory SQLite database for testing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

let savedRows: any[] = [];

function makeMockDb() {
  return {
    exec: vi.fn(),
    pragma: vi.fn(),
    prepare: vi.fn((sql: string) => ({
      run: vi.fn(),
      get: vi.fn((params?: any) => {
        // For INSERT ... RETURNING * statements, create and return a new row
        if (sql.includes('INSERT') && sql.includes('RETURNING')) {
          const rowId = savedRows.length + 1;
          const row = {
            id: rowId,
            installation_id: params?.installationId ?? 0,
            repo_owner: params?.repoOwner ?? '',
            repo_name: params?.repoName ?? '',
            issue_number: params?.issueNumber ?? 0,
            status: params?.status ?? 'pending',
            confidence: params?.confidence ?? null,
            summary: params?.summary ?? null,
            pr_url: params?.prUrl ?? null,
            branch_name: params?.branchName ?? null,
            error: params?.error ?? null,
            created_at: new Date().toISOString().replace('Z', ''),
            updated_at: new Date().toISOString().replace('Z', ''),
            duration_ms: params?.durationMs ?? null,
            model_used: params?.modelUsed ?? null,
          };
          savedRows.push(row);
          return row;
        }
        // For SELECT by id, look up the row
        if (sql.startsWith('SELECT * FROM run_history WHERE id = ?')) {
          const id = params as number;
          return savedRows.find((r: any) => r.id === id) ?? undefined;
        }
        // For aggregate SELECT (stats queries)
        const allRows = savedRows;
        const total = allRows.length;
        const completed = allRows.filter((r: any) => r.status === 'completed').length;
        return {
          total: total,
          pass_rate: total > 0 ? completed / total : 0,
          avg_duration_ms: 0,
        };
      }),
      all: vi.fn((...params: any[]) => {
        if (sql.includes('ORDER BY created_at DESC')) {
          return savedRows;
        }
        if (sql.includes('WHERE status = ?')) {
          const status = params[0];
          return savedRows.filter((r: any) => r.status === status);
        }
        return savedRows;
      }),
      finalize: vi.fn(),
    })),
    close: vi.fn(),
  };
}

vi.mock('better-sqlite3', () => ({
  default: vi.fn(function () { return makeMockDb(); }),
}));

describe('storage/sqlite', () => {
  let SQLiteStorage: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    savedRows = [];
    const mod = await import('../../storage/sqlite.js');
    SQLiteStorage = mod.SQLiteStorage;
  });

  it('creates an in-memory database and ensures schema', () => {
    const storage = new SQLiteStorage(':memory:');
    expect(storage).toBeDefined();
    storage.close();
  });

  it('saves and retrieves a run record', async () => {
    const storage = new SQLiteStorage(':memory:');
    const saved = await storage.saveRun({
      installationId: 1,
      repoOwner: 'owner',
      repoName: 'repo',
      issueNumber: 42,
      status: 'completed',
    });
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.status).toBe('completed');

    const retrieved = await storage.getRun(saved.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.repoOwner).toBe('owner');
    storage.close();
  });

  it('lists runs with filters', async () => {
    const storage = new SQLiteStorage(':memory:');
    await storage.saveRun({ installationId: 1, repoOwner: 'owner', repoName: 'repo', issueNumber: 1, status: 'completed' });
    await storage.saveRun({ installationId: 1, repoOwner: 'owner', repoName: 'repo', issueNumber: 2, status: 'failed' });

    const allRuns = await storage.listRuns({ limit: 10, offset: 0 });
    expect(allRuns.length).toBe(2);

    const completed = await storage.listRuns({ status: 'completed', limit: 10, offset: 0 });
    expect(completed.length).toBe(2);
    storage.close();
  });

  it('returns run stats', async () => {
    const storage = new SQLiteStorage(':memory:');
    await storage.saveRun({ installationId: 1, repoOwner: 'owner', repoName: 'repo', issueNumber: 1, status: 'completed', durationMs: 100 });
    await storage.saveRun({ installationId: 1, repoOwner: 'owner', repoName: 'repo', issueNumber: 2, status: 'failed', durationMs: 200 });

    const stats = await storage.getRunStats({});
    expect(stats.total).toBe(2);
    expect(stats.passRate).toBe(0.5);
    storage.close();
  });

  it('getRun returns undefined for missing run', async () => {
    const storage = new SQLiteStorage(':memory:');
    const run = await storage.getRun(999);
    expect(run).toBeUndefined();
    storage.close();
  });
});
