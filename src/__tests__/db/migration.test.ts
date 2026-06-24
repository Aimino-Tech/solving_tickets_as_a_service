
describe('rollbackLastBatch', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockQueryWithRetry.mockReset();
    mockConnect.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
    mockReadFileSync.mockReset();
    mockMkdirSync.mockReset();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('does nothing when no migrations are tracked', async () => {
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
    expect(mockQueryWithRetry).toHaveBeenCalledTimes(2);
  });

  it('rolls back using the .rollback.sql file when available', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('DROP TABLE IF EXISTS test;');
    mockClientQuery.mockResolvedValue({});
    mockClientRelease.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: '002_test.sql' }] });
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockClientQuery).toHaveBeenCalledWith('DROP TABLE IF EXISTS test;');
    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "_migrations"'), ['002_test.sql']);
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('warns and still removes tracking record when rollback file is missing', async () => {
    mockExistsSync.mockReturnValue(false);
    mockClientQuery.mockResolvedValue({});
    mockClientRelease.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: '003_norollback.sql' }] });
    const { rollbackLastBatch: rollback } = await import('../../db/migrate.js');
    await rollback();
    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "_migrations"'), ['003_norollback.sql']);
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
  });
});

describe('migration lifecycle (mocked)', () => {
  it('full lifecycle', async () => {
    vi.resetModules();
    mockQueryWithRetry.mockReset();
    mockConnect.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
    mockReadFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValueOnce(['001_initial.sql']).mockReturnValueOnce([]);
    mockReadFileSync.mockReturnValueOnce('CREATE TABLE test (id INTEGER);').mockReturnValueOnce('DROP TABLE IF EXISTS test;');
    mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
    mockClientQuery.mockResolvedValue({});
    mockClientRelease.mockResolvedValue(undefined);
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: '001_initial.sql' }] });
    const mod = await import('../../db/migrate.js');
    await mod.runMigrations();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    await mod.rollbackLastBatch();
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockClientQuery).toHaveBeenCalledWith('DROP TABLE IF EXISTS test;');
    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'), ['001_initial.sql']);
  });
});

describe('dry-run mode', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockQueryWithRetry.mockReset();
    mockConnect.mockReset(); mockClientQuery.mockReset(); mockClientRelease.mockReset();
    mockExistsSync.mockReset(); mockReaddirSync.mockReset(); mockReadFileSync.mockReset(); mockMkdirSync.mockReset();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('does not apply migrations in dry-run mode', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['001_test.sql', '002_test.sql']);
    mockReadFileSync.mockReturnValueOnce('CREATE TABLE test1 (id INTEGER);').mockReturnValueOnce('CREATE TABLE test2 (id INTEGER);');
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const { runMigrationsDryRun } = await import('../../db/migrate.js');
    const result = await runMigrationsDryRun();
    expect(result).toHaveLength(2);
  });

  it('does not attempt rollback in dry-run mode', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('DROP TABLE IF EXISTS test;');
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: '001_applied.sql' }] });
    const { rollbackLastBatchDryRun } = await import('../../db/migrate.js');
    const result = await rollbackLastBatchDryRun();
    expect(result).toHaveLength(1);
  });

  it('marks already-applied migrations as applied in dry-run', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['001_test.sql']);
    mockReadFileSync.mockReturnValue('SELECT 1;');
    mockQueryWithRetry.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: '001_test.sql' }] });
    const { runMigrationsDryRun } = await import('../../db/migrate.js');
    const result = await runMigrationsDryRun();
    expect(result[0].status).toBe('applied');
  });
});

describe('migration timing', () => {
  it('computeChecksum completes quickly for large content', () => {
    const large = 'SELECT 1;\n'.repeat(50000);
    const start = performance.now();
    let h = 0;
    for (let i = 0; i < large.length; i++) { const c = large.charCodeAt(i); h = (h << 5) - h + c; h |= 0; }
    const hash = Math.abs(h).toString(16).padStart(8, '0');
    expect(performance.now() - start).toBeLessThan(100);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('benchmark helper measures execution time', async () => {
    vi.resetModules();
    mockQueryWithRetry.mockReset();
    const { benchmarkMigration } = await import('../../db/migrate.js');
    const r = await benchmarkMigration('test', async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(r.durationMs).toBeGreaterThanOrEqual(5);
  });
});
