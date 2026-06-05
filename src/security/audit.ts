import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'security-audit' });

export interface AuditEntry {
  action: string;
  actor: string;
  resource: string;
  details?: Record<string, unknown>;
  ip?: string;
  success: boolean;
}

export class SecurityAudit {
  private static instance: SecurityAudit;

  static getInstance(): SecurityAudit {
    if (!SecurityAudit.instance) {
      SecurityAudit.instance = new SecurityAudit();
    }
    return SecurityAudit.instance;
  }

  async log(entry: AuditEntry): Promise<void> {
    log.info(
      {
        auditAction: entry.action,
        auditActor: entry.actor,
        auditResource: entry.resource,
        auditDetails: entry.details,
        auditIp: entry.ip,
        auditSuccess: entry.success,
      },
      `[AUDIT] ${entry.action} on ${entry.resource} by ${entry.actor} — ${entry.success ? 'OK' : 'FAIL'}`,
    );
  }

  async adminAction(actor: string, action: string, details?: Record<string, unknown>): Promise<void> {
    await this.log({
      action,
      actor,
      resource: 'admin',
      details,
      success: true,
    });
  }
}
