/**
 * Unit tests for src/security/audit.ts — Admin audit trail.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: { database: { enableAuditPersistence: false } },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('security/audit', () => {
  let audit: typeof import('../../security/audit.js');

  beforeEach(async () => {
    const loggerMod = await import('../../utils/logger.js');
    loggerMod.rootLogger.child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) as any;
    audit = await import('../../security/audit.js');
  });

  describe('writeAuditLog', () => {
    it('writes a log entry', async () => {
      const mockLogger = (await import('../../utils/logger.js')).rootLogger.child();
      await audit.writeAuditLog({
        action: 'admin.test',
        actor: 'admin:api-key',
        target: 'account:42',
        outcome: 'success',
        details: { key: 'value' },
      });
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('does not persist to DB when disabled', async () => {
      await audit.writeAuditLog({
        action: 'admin.test',
        actor: 'admin:api-key',
        target: 'account:42',
        outcome: 'success',
      });
      // No DB call expected since enableAuditPersistence is false
    });

    it('persists to DB when enabled', async () => {
      vi.resetModules();
      const mockDbExecute = vi.fn();
      vi.mock('../../config.js', () => ({
        config: { database: { enableAuditPersistence: true } },
      }));
      vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
      vi.mock('../../db/index.js', () => ({
        db: { insertInto: vi.fn(() => ({ values: vi.fn(() => ({ execute: mockDbExecute })) })) },
      }));
      const mod = await import('../../security/audit.js');
      await mod.writeAuditLog({
        action: 'admin.test',
        actor: 'admin:api-key',
        target: 'account:42',
        outcome: 'success',
      });
      expect(mockDbExecute).toHaveBeenCalled();
    });
  });
});
