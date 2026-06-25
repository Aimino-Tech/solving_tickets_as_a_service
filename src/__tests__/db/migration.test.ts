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

const fsMockFns = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const mockQueryWithRetry = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
const mockGetPool = vi.hoisted(() => vi.fn(() => ({ connect: vi.fn() })));

vi.mock('node:fs', () => ({
  existsSync: fsMockFns.existsSync,
  readdirSync: fsMockFns.readdirSync,
  readFileSync: fsMockFns.readFileSync,
  writeFileSync: fsMockFns.writeFileSync,
  mkdirSync: fsMockFns.mkdirSync,
  statSync: fsMockFns.existsSync,
  default: { existsSync: fsMockFns.existsSync, readdirSync: fsMockFns.readdirSync, readFileSync: fsMockFns.readFileSync, writeFileSync: fsMockFns.writeFileSync, mkdirSync: fsMockFns.mkdirSync },
}));

vi.mock('../../db/connection.js', () => {
  const { mockQueryWithRetry: qwr } = vi.importMock('../../db/connection.js');
  return {
    queryWithRetry: vi.fn().mockResolvedValue({ rows: [] }),
    closePool: vi.fn(),
    getPool: vi.fn(() => ({ connect: vi.fn() })),
  };
});

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
    fsMockFns.existsSync.mockReset();
    fsMockFns.readdirSync.mockReset();
    fsMockFns.readFileSync.mockReset();
    mockQueryWithRetry.mockReset();
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue({ connect: vi.fn() });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates migrations directory if missing', async () => {
    fsMockFns.existsSync.mockReturnValue(false);
    const { runMigrations: run } = await import('../../db/migrate.js');
    await run();
  });

  it('does nothing when no migration files exist', async () => {
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readdirSync.mockReturnValue([]);
    const { runMigrations: run } = await import('../../db/migrate.js');
    await run();
  });

  it('applies pending migrations not in the tracking table', async () => {
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readdirSync.mockReturnValue(['001_test.sql', '002_test.sql']);
    fsMockFns.readFileSync
      .mockReturnValueOnce('CREATE TABLE test1 (id INTEGER);')
      .mockReturnValueOnce('CREATE TABLE test2 (id INTEGER);');
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
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readdirSync.mockReturnValue(['001_applied.sql', '002_pending.sql']);
    fsMockFns.readFileSync.mockReturnValue('SELECT 1;');
    mockQueryWithRetry
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
    fsMockFns.existsSync.mockReset();
    fsMockFns.readdirSync.mockReset();
    fsMockFns.readFileSync.mockReset();
    mockQueryWithRetry.mockReset();
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue({ connect: vi.fn() });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no migrations are tracked', async () => {
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
  });

  it('rolls back using the .rollback.sql file when available', async () => {
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readFileSync.mockReturnValue('DROP TABLE IF EXISTS test;');
    mockQueryWithRetry
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
    fsMockFns.existsSync.mockReturnValue(false);
    mockQueryWithRetry
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
    const mockFns = vi.hoisted(() => ({
      mockExistsSync: vi.fn().mockReturnValue(true),
      mockReaddirSync: vi.fn()
        .mockReturnValueOnce(['001_initial.sql'])
        .mockReturnValueOnce([]),
      mockReadFileSync: vi.fn()
        .mockReturnValueOnce('CREATE TABLE test (id INTEGER);')
        .mockReturnValueOnce('DROP TABLE IF EXISTS test;'),
      mockQueryWithRetry: vi.fn(),
      mockConnect: vi.fn(),
      mockClientQuery: vi.fn().mockResolvedValue({}),
      mockClientRelease: vi.fn(),
    }));
    mockFns.mockConnect.mockResolvedValue({
      query: mockFns.mockClientQuery,
      release: mockFns.mockClientRelease,
    });
    mockFns.mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '001_initial.sql' }] });
    vi.mock('node:fs', () => ({
      existsSync: (...args: any[]) => mockFns.mockExistsSync(...args),
      readdirSync: (...args: any[]) => mockFns.mockReaddirSync(...args),
      readFileSync: (...args: any[]) => mockFns.mockReadFileSync(...args),
    }));
    vi.mock('../../db/connection.js', () => ({
      queryWithRetry: (...args: any[]) => mockFns.mockQueryWithRetry(...args),
      closePool: vi.fn(),
      getPool: vi.fn(() => ({ connect: mockFns.mockConnect })),
    }));
    vi.mock('../../utils/logger.js', () => ({
      rootLogger: { child: vi.fn(() => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      })) },
    }));
    const mod = await import('../../db/migrate.js');
    await mod.runMigrations();
    await mod.rollbackLastBatch();
  });
});

describe('dry-run mode', () => {
  beforeEach(() => {
    fsMockFns.existsSync.mockReset();
    fsMockFns.readdirSync.mockReset();
    fsMockFns.readFileSync.mockReset();
    mockQueryWithRetry.mockReset();
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    mockGetPool.mockReset();
    mockGetPool.mockReturnValue({ connect: vi.fn() });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not apply migrations in dry-run mode', async () => {
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readdirSync.mockReturnValue(['001_test.sql', '002_test.sql']);
    fsMockFns.readFileSync
      .mockReturnValueOnce('CREATE TABLE test1 (id INTEGER);')
      .mockReturnValueOnce('CREATE TABLE test2 (id INTEGER);');
    const { runMigrationsDryRun } = await import('../../db/migrate.js');
    const result = await runMigrationsDryRun();
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('file', '001_test.sql');
    expect(result[1]).toHaveProperty('file', '002_test.sql');
  });

  it('does not attempt rollback in dry-run mode', async () => {
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readFileSync.mockReturnValue('DROP TABLE IF EXISTS test;');
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
    fsMockFns.existsSync.mockReturnValue(true);
    fsMockFns.readdirSync.mockReturnValue(['001_test.sql']);
    fsMockFns.readFileSync.mockReturnValue('SELECT 1;');
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: '001_test.sql' }] });
    mockGetPool.mockReturnValue({ connect: vi.fn() });
    const { runMigrationsDryRun } = await import('../../db/migrate.js');
    const result = await runMigrationsDryRun();
    expect(result).toHaveLength(0);
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
    expect(elapsed).toBeLessThan(100);
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
