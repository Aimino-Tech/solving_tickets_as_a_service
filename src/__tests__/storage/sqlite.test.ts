/**
 * Unit tests for src/storage/sqlite.ts — SQLite storage backend.
 * Uses an in-memory SQLite database for testing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

let savedRows: any[] = [];
let rowIdCounter = 0;

function makeMockDb() {
  return {
    exec: vi.fn(),
    pragma: vi.fn(),
    prepare: vi.fn((sql: string) => {
      const trimmed = sql.trim();
      const isInsert = trimmed.startsWith('INSERT');
      const isSelectById = trimmed.includes('WHERE id =');
      const isAggregate = trimmed.includes('COUNT(*)');
      return {
        run: vi.fn((params?: any) => {
          if (isInsert) {
            rowIdCounter++;
            const row: Record<string, any> = { id: rowIdCounter };
            if (params?.installationId) row.installation_id = params.installationId;
            if (params?.repoOwner) row.repo_owner = params.repoOwner;
            if (params?.repoName) row.repo_name = params.repoName;
            if (params?.issueNumber) row.issue_number = params.issueNumber;
            if (params?.status) row.status = params.status;
            if (params?.durationMs) row.duration_ms = params.durationMs;
            savedRows.push(row);
            return { lastInsertRowid: rowIdCounter, changes: 1 };
          }
          return { changes: 0 };
        }),
        get: vi.fn((params?: any) => {
          if (isAggregate) {
            const totalRows = savedRows.length;
            const completedRows = savedRows.filter((r: any) => r.status === 'completed').length;
            return {
              total: totalRows,
              pass_rate: totalRows > 0 ? completedRows / totalRows : 0,
              avg_duration_ms: 0,
            };
          }
          if (isSelectById && params) {
            const id = params;
            return savedRows.find((r: any) => r.id === id) ?? undefined;
          }
          if (isInsert && params) {
            rowIdCounter++;
            const row: Record<string, any> = { id: rowIdCounter };
            if (params.installationId) row.installation_id = params.installationId;
            if (params.repoOwner) row.repo_owner = params.repoOwner;
            if (params.repoName) row.repo_name = params.repoName;
            if (params.issueNumber) row.issue_number = params.issueNumber;
            if (params.status) row.status = params.status;
            if (params.durationMs) row.duration_ms = params.durationMs;
            savedRows.push(row);
            return row;
          }
          if (params?.installationId) {
            return {
              id: 1,
              installation_id: params.installationId,
              repo_owner: params.repoOwner ?? '',
              repo_name: params.repoName ?? '',
              issue_number: params.issueNumber ?? 0,
              status: params.status ?? 'pending',
              created_at: new Date().toISOString().replace('Z', ''),
              updated_at: new Date().toISOString().replace('Z', ''),
            };
          }
          return undefined;
        }),
        all: vi.fn(() => savedRows),
        finalize: vi.fn(),
      };
    }),
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
