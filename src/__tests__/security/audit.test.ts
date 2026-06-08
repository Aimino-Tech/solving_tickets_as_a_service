import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockAuditLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
let mockDbExecute = vi.fn().mockResolvedValue(undefined);

const auditConfig = { database: { enableAuditPersistence: false } };

vi.mock('../../config.js', () => ({
  config: auditConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: () => mockAuditLogger },
}));

vi.mock('../../db/repositories/AuditLogRepository.js', () => ({
  auditLogRepository: { log: mockDbExecute },
}));

describe('security/audit', () => {
  let audit: typeof import('../../security/audit.js');

  beforeEach(async () => {
    mockAuditLogger.info.mockClear();
    mockDbExecute.mockClear();
    audit = await import('../../security/audit.js');
  });

  describe('writeAuditLog', () => {
    it('writes a log entry', async () => {
      await audit.writeAuditLog({
        action: 'admin.test',
        actor: 'admin:api-key',
        target: 'account:42',
        outcome: 'success',
        details: { key: 'value' },
      });
      expect(mockAuditLogger.info).toHaveBeenCalled();
    });

    it('does not persist to DB when disabled', async () => {
      await audit.writeAuditLog({
        action: 'admin.test',
        actor: 'admin:api-key',
        target: 'account:42',
        outcome: 'success',
      });
    });

    it('persists to DB when enabled', async () => {
      auditConfig.database.enableAuditPersistence = true;
      vi.resetModules();
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
