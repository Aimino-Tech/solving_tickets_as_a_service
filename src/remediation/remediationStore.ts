import { rootLogger } from '../utils/logger.js';
const log = rootLogger.child({ module: 'remediation-store' });
export interface RemediationAuditEntry { id?: string; action: string; alertId: string; reason: string; status: 'success' | 'failure' | 'error' | 'skipped' | 'evaluate_error'; detail: string; metadata?: Record<string, unknown>; createdAt?: Date; }
export interface RemediationStoreStats { totalEntries: number; byAction: Record<string, number>; byStatus: Record<string, number>; }
export class RemediationStore {
  private entries: RemediationAuditEntry[] = []; private idCounter = 0;
  async record(entry: RemediationAuditEntry): Promise<string> {
    const id = entry.id ?? 'rem-' + Date.now() + '-' + (++this.idCounter);
    this.entries.push({ ...entry, id, createdAt: entry.createdAt ?? new Date() });
    log.debug({ id, action: entry.action, status: entry.status }, 'audit recorded'); return id;
  }
  async list(opts?: { action?: string; status?: string; alertId?: string; limit?: number; offset?: number; since?: Date }): Promise<RemediationAuditEntry[]> {
    let f = this.entries; if (opts?.action) f = f.filter((e:any) => e.action === opts.action); if (opts?.status) f = f.filter((e:any) => e.status === opts.status); if (opts?.alertId) f = f.filter((e:any) => e.alertId === opts.alertId); if (opts?.since) f = f.filter((e:any) => (e.createdAt ?? new Date()) >= opts.since!);
    f = f.sort((a:any,b:any) => (b.createdAt?.getTime()??0) - (a.createdAt?.getTime()??0)); const off = opts?.offset ?? 0; return f.slice(off, off + (opts?.limit ?? 50));
  }
  async get(id: string): Promise<RemediationAuditEntry | null> { return this.entries.find((e:any) => e.id === id) ?? null; }
  async stats(): Promise<RemediationStoreStats> {
    const byAction: Record<string,number>={}, byStatus: Record<string,number>={};
    for (const e of this.entries) { byAction[e.action] = (byAction[e.action]??0)+1; byStatus[e.status] = (byStatus[e.status]??0)+1; }
    return { totalEntries: this.entries.length, byAction, byStatus };
  }
  async prune(olderThanMs: number): Promise<number> {
    const cut = Date.now() - olderThanMs; const before = this.entries.length;
    this.entries = this.entries.filter((e:any) => (e.createdAt?.getTime()??0) >= cut); return before - this.entries.length;
  }
  get size(): number { return this.entries.length; }
}
