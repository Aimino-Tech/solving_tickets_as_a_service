/**
 * Audit logs types — append-only log of all security-relevant and system events.
 */

export interface AuditLog {
  id: number;
  accountId: number;
  timestamp: Date;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: unknown | null;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

export interface NewAuditLog {
  id?: number;
  accountId: number;
  timestamp?: Date;
  actorType?: string;
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: unknown | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}
