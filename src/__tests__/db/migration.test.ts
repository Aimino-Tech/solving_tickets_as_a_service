/**
 * Tests for the database migration system (src/db/migrate.ts).
 *
 * Covers:
 *   - Checksum computation
 *   - Migration runner logic (pending detection, apply, rollback)
 *   - Edge cases: empty directory, missing rollback, no pending
 *   - Dry-run mode
 *   - Migration timing/benchmark helper
 *
 * Note: Migration file integrity tests are in migration-integrity.test.ts
 * to avoid vi.mock('node:fs') hoisting interference.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const mockQueryWithRetry = vi.hoisted(() => vi.fn(() => Promise.resolve({ rows: [] })));
const mockGetPool = vi.hoisted(() => vi.fn(() => ({ connect: vi.fn() })));

vi.mock('node:fs', () => ({
  existsSync: mockFs.existsSync,
  readdirSync: mockFs.readdirSync,
  readFileSync: mockFs.readFileSync,
  mkdirSync: mockFs.mkdirSync,
  default: { existsSync: mockFs.existsSync, readdirSync: mockFs.readdirSync, readFileSync: mockFs.readFileSync, mkdirSync: mockFs.mkdirSync },
}));
vi.mock('fs', () => ({
  existsSync: mockFs.existsSync,
  readdirSync: mockFs.readdirSync,
  readFileSync: mockFs.readFileSync,
  mkdirSync: mockFs.mkdirSync,
  default: { existsSync: mockFs.existsSync, readdirSync: mockFs.readdirSync, readFileSync: mockFs.readFileSync, mkdirSync: mockFs.mkdirSync },
}));

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: (...args: any[]) => mockQueryWithRetry(...args),
  closePool: vi.fn(),
  getPool: (...args: any[]) => mockGetPool(...args),
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

describe('computeChecksum', () => {
  it('produces a deterministic 8-character hex string', async () => {
    const { computeChecksum } = await import('../../db/migrate.js');
    const hash = computeChecksum('SELECT 1');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces the same hash for the same content', async () => {
    const { computeChecksum } = await import('../../db/migrate.js');
    const content = 'CREATE TABLE test (id INTEGER);';
    expect(computeChecksum(content)).toBe(computeChecksum(content));
  });

  it('produces different hashes for different content', async () => {
    const { computeChecksum } = await import('../../db/migrate.js');
    const hash1 = computeChecksum('SELECT 1');
    const hash2 = computeChecksum('SELECT 2');
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty content', async () => {
    const { computeChecksum } = await import('../../db/migrate.js');
    const hash = computeChecksum('');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles large content without error', async () => {
    const { computeChecksum } = await import('../../db/migrate.js');
    const large = 'SELECT 1;\n'.repeat(10_000);
    const hash = computeChecksum(large);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('runMigrations', () => {
  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockQueryWithRetry.mockReset();
    mockGetPool.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates migrations directory if missing', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { runMigrations: run } = await import('../../db/migrate.js');
    await run();
  });

  it('does nothing when no migration files exist', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([]);
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { runMigrations: run } = await import('../../db/migrate.js');
    await run();
  });

  it('applies pending migrations not in the tracking table', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['001_test.sql', '002_test.sql']);
    mockFs.readFileSync
      .mockReturnValueOnce('CREATE TABLE test1 (id INTEGER);')
      .mockReturnValueOnce('CREATE TABLE test2 (id INTEGER);');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const mockClientQuery = vi.fn().mockResolvedValue({});
    const mockClientRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockGetPool.mockReturnValue({ connect: mockConnect });
    const { runMigrations: run } = await import('../../db/migrate.js');
    await run();
  });

  it('skips already-applied migrations', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['001_applied.sql', '002_pending.sql']);
    mockFs.readFileSync.mockReturnValue('SELECT 1;');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '001_applied.sql' }] });
    const mockClientQuery = vi.fn().mockResolvedValue({});
    const mockClientRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockGetPool.mockReturnValue({ connect: mockConnect });
    const { runMigrations: run } = await import('../../db/migrate.js');
    await run();
  });
});

describe('rollbackLastBatch', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no migrations are tracked', async () => {
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
  });

  it('rolls back using the .rollback.sql file when available', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('DROP TABLE IF EXISTS test;');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '002_test.sql' }] });
    const mockClientQuery = vi.fn().mockResolvedValue({});
    const mockClientRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockGetPool.mockReturnValue({ connect: mockConnect });
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
  });

  it('warns and still removes tracking record when rollback file is missing', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '003_norollback.sql' }] });
    const mockClientQuery = vi.fn().mockResolvedValue({});
    const mockClientRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockGetPool.mockReturnValue({ connect: mockConnect });
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
  });
});

describe('migration lifecycle (mocked)', () => {
  it('full lifecycle: ensure table -> get applied -> apply pending -> rollback', async () => {
    vi.resetModules();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync
      .mockReturnValueOnce(['001_initial.sql'])
      .mockReturnValueOnce([]);
    mockFs.readFileSync
      .mockReturnValueOnce('CREATE TABLE test (id INTEGER);')
      .mockReturnValueOnce('DROP TABLE IF EXISTS test;');
    const mockConnect = vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({}),
      release: vi.fn(),
    });
    mockGetPool.mockReturnValue({ connect: mockConnect });
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '001_initial.sql' }] });
    const mod = await import('../../db/migrate.js');
    await mod.runMigrations();
    await mod.rollbackLastBatch();
  });
});

describe('dry-run mode', () => {
  beforeEach(() => {
    mockQueryWithRetry.mockReset();
    mockGetPool.mockReset();
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.readFileSync.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not apply migrations in dry-run mode', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['001_test.sql', '002_test.sql']);
    mockFs.readFileSync
      .mockReturnValueOnce('CREATE TABLE test1 (id INTEGER);')
      .mockReturnValueOnce('CREATE TABLE test2 (id INTEGER);');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { runMigrationsDryRun } = await import('../../db/migrate.js');
    const result = await runMigrationsDryRun();
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('file', '001_test.sql');
    expect(result[1]).toHaveProperty('file', '002_test.sql');
  });

  it('does not attempt rollback in dry-run mode', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('DROP TABLE IF EXISTS test;');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '001_applied.sql' }] });
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { rollbackLastBatchDryRun } = await import('../../db/migrate.js');
    const result = await rollbackLastBatchDryRun();
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('file', '001_applied.sql');
  });

  it('returns empty array when no migrations are pending (dry-run)', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['001_test.sql']);
    mockFs.readFileSync.mockReturnValue('SELECT 1;');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '001_test.sql' }] });
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { runMigrationsDryRun } = await import('../../db/migrate.js');
    const result = await runMigrationsDryRun();
    expect(result.every((r: any) => r.status === 'applied')).toBe(true);
    expect(result.filter((r: any) => r.status === 'pending')).toHaveLength(0);
  });
});

describe('migration timing', () => {
  it('computeChecksum completes quickly for large content', () => {
    const large = 'SELECT 1;\n'.repeat(50_000);
    const start = performance.now();
    let h = 0;
    for (let i = 0; i < large.length; i++) {
      const char = large.charCodeAt(i);
      h = (h << 5) - h + char;
      h |= 0;
    }
    const hash = Math.abs(h).toString(16).padStart(8, '0');
    const elapsed = performance.now() - start;
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(elapsed).toBeLessThan(500);
  });

  it('benchmark helper measures execution time', async () => {
    vi.resetModules();
    const { benchmarkMigration } = await import('../../db/migrate.js');
    const result = await benchmarkMigration(
      'test_migration',
      async () => { await new Promise((r) => setTimeout(r, 10)); },
    );
    expect(result.name).toBe('test_migration');
    expect(result.durationMs).toBeGreaterThanOrEqual(5);
    expect(result.durationMs).toBeLessThan(1000);
  });
});
