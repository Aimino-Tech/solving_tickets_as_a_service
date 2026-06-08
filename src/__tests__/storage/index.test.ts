/**
 * Unit tests for src/storage/index.ts — Storage backend factory.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: { storage: { type: 'sqlite', sqlitePath: ':memory:' } },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../storage/sqlite.js', () => ({
  SQLiteStorage: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('../../storage/postgres/index.js', () => ({
  PostgresStorage: vi.fn(() => ({ close: vi.fn() })),
}));

describe('storage/index', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates SQLite storage when configured', async () => {
    const mod = await import('../../storage/index.js');
    const storage = await mod.createStorage();
    expect(storage).toBeDefined();
  });

  it('closes storage and resets instance', async () => {
    const mod = await import('../../storage/index.js');
    await mod.createStorage();
    await mod.closeStorage();
    // Call again should create new
    const storage = await mod.createStorage();
    expect(storage).toBeDefined();
  });

  it('throws for unknown storage type', async () => {
    vi.resetModules();
    vi.mock('../../config.js', () => ({ config: { storage: { type: 'unknown' } } }));
    vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
    const mod = await import('../../storage/index.js');
    await expect(mod.createStorage()).rejects.toThrow('Unknown storage type');
  });
});
