/**
 * Unit tests for src/storage/sqlite.ts — SQLite storage backend.
 * Uses an in-memory SQLite database for testing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('storage/sqlite', () => {
  let SQLiteStorage: any;

  beforeEach(async () => {
    vi.clearAllMocks();
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
    expect(completed.length).toBe(1);
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
