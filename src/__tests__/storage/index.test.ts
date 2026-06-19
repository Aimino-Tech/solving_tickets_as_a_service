/**
 * Unit tests for src/storage/index.ts — Storage backend factory.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorageConfig = { storage: { type: 'sqlite' as string, sqlitePath: ':memory:' as string } };

vi.mock('../../config.js', () => ({
  config: mockStorageConfig,
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
  beforeEach(() => {
    mockStorageConfig.storage.type = 'sqlite';
  });

  it('creates SQLite storage when configured', async () => {
    const mod = await import('../../storage/index.js');
    const storage = await mod.createStorage();
    expect(storage).toBeDefined();
  });

  it('closes storage and resets instance', async () => {
    const mod = await import('../../storage/index.js');
    await mod.createStorage();
    await mod.closeStorage();
    const storage = await mod.createStorage();
    expect(storage).toBeDefined();
  });

  it('throws for unknown storage type', async () => {
    mockStorageConfig.storage.type = 'unknown';
    vi.resetModules();
    const mod = await import('../../storage/index.js');
    await expect(mod.createStorage()).rejects.toThrow('Unknown storage type');
  });
});
