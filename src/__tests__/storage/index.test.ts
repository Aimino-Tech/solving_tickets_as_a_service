/**
 * Unit tests for src/storage/index.ts — Storage backend factory.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../storage/postgres/index.js', () => ({
  PostgresStorage: vi.fn(function () { return { close: vi.fn() }; }),
}));

describe('storage/index', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates Postgres storage', async () => {
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
});
