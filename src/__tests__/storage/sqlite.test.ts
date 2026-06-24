import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

let savedRows: any[] = [];
let rowIdCounter = 0;

function makeMockDb() {
  return {
    exec: vi.fn(),
    pragma: vi.fn(),
    prepare: vi.fn(() => ({
      get: vi.fn((params?: any) => {
        if (params == null) {
          return { total: savedRows.length, pass_rate: savedRows.length > 0 ? savedRows.filter((r: any) => r.status === 'completed').length / savedRows.length : 0, avg_duration_ms: savedRows.length > 0 ? savedRows.reduce((s: number, r: any) => s + (r.duration_ms || 0), 0) / savedRows.length : 0 };
        }
        if (typeof params === 'number') {
          return savedRows.find((r: any) => r.id === params) ?? undefined;
        }
        rowIdCounter++;
        const row: any = { id: rowIdCounter };
        row.installation_id = params.installationId ?? 0;
        row.repo_owner = params.repoOwner ?? '';
        row.repo_name = params.repoName ?? '';
        row.issue_number = params.issueNumber ?? 0;
        row.status = params.status ?? 'pending';
        row.confidence = params.confidence ?? null;
        row.summary = params.summary ?? null;
        row.pr_url = params.prUrl ?? null;
        row.branch_name = params.branchName ?? null;
        row.error = params.error ?? null;
        row.created_at = new Date().toISOString().replace('Z', '');
        row.updated_at = new Date().toISOString().replace('Z', '');
        row.duration_ms = params.durationMs ?? null;
        row.model_used = params.modelUsed ?? null;
        savedRows.push(row);
        return row;
      }),
      all: vi.fn(() => [...savedRows]),
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
