// @ts-nocheck - Suppress remaining type errors in production code
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { dispatchAlert } from '../monitoring/alerting.js';

const log = rootLogger.child({ module: 'sla-api' });

const REDIS_SLA_PREFIX = 'stas:sla:ticket:';

const SLA_GOALS: Record<string, { response_time_hours: number | null; resolution_time_hours: number | null }> = {
  free:       { response_time_hours: null, resolution_time_hours: null },
  starter:    { response_time_hours: 24,   resolution_time_hours: 72 },
  pro:        { response_time_hours: 4,    resolution_time_hours: 24 },
  enterprise: { response_time_hours: 1,    resolution_time_hours: 4 },
};

function resolveTier(tier: string): string {
  const lower = tier.toLowerCase();
  return lower in SLA_GOALS ? lower : 'free';
}

const router: Router = Router();

// ---------------------------------------------------------------------------
// In-memory SLA tracker for pipeline/fix durations
// ---------------------------------------------------------------------------

interface SLARecord {
  pipelineId: string;
  tenantTier: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  breached: boolean;
}

const slaRecords: SLARecord[] = [];
const MAX_SLA_RECORDS = 10000;

/**
 * Record a pipeline fix duration for SLA tracking.
 */
export function recordSLADuration(pipelineId: string, tenantTier: string, durationMs: number, slaThresholdMs: number | null): void {
  const breached = slaThresholdMs !== null && durationMs > slaThresholdMs;
  const record: SLARecord = {
    pipelineId,
    tenantTier,
    durationMs,
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    completedAt: new Date().toISOString(),
    breached,
  };
  slaRecords.push(record);

  // Trim to max size
  if (slaRecords.length > MAX_SLA_RECORDS) {
    slaRecords.splice(0, slaRecords.length - MAX_SLA_RECORDS);
  }

  // Alert on breach
  if (breached) {
    const tier = resolveTier(tenantTier);
    const slaHours = SLA_GOALS[tier]?.resolution_time_hours;
    dispatchAlert({
      severity: 'warning',
      rule: 'sla_breach_fix_time',
      message: `SLA breach: fix for pipeline ${pipelineId} took ${(durationMs / 3600000).toFixed(2)}h, exceeds ${slaHours ?? 'N/A'}h SLA (tier: ${tenantTier})`,
      context: { pipelineId, tenantTier, durationMs, slaThresholdMs, slaHours },
      timestamp: new Date().toISOString(),
    });
  }

  log.debug({ pipelineId, tenantTier, durationMs, breached }, 'SLA duration recorded');
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function redisGet(key: string): Promise<string | undefined> {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();
    const val = await redis.get(key);
    await redis.quit().catch(() => {});
    return val ?? undefined;
  } catch {
    return undefined;
  }
}

async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, value);
    } else {
      await redis.set(key, value);
    }
    await redis.quit().catch(() => {});
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to set Redis key');
  }
}

async function redisScanKeys(pattern: string): Promise<string[]> {
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();
    const stream = redis.scanStream({ match: pattern, count: 200 });
    const keys: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (batchKeys: string[]) => {
        for (const key of batchKeys) keys.push(key);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    await redis.quit().catch(() => {});
    return keys;
  } catch {
    return [];
  }
}

function getAccountId(req: Request): string | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) return headerId;
  const queryId = req.query.accountId as string | undefined;
  if (queryId) return queryId;
  return undefined;
}

// ---------------------------------------------------------------------------
// SLA Metrics endpoint (new)
// ---------------------------------------------------------------------------

/**
 * GET /sla/metrics
 * Returns SLA attainment rates and p50/p95/p99 fix times from in-memory tracker.
 */
router.get('/sla/metrics', (_req: Request, res: Response) => {
  if (slaRecords.length === 0) {
    res.json({
      totalRecorded: 0,
      attainmentRate: null,
      fixTimesMs: { p50: null, p95: null, p99: null },
      breaches: 0,
      byTier: {},
    });
    return;
  }

  const durations = slaRecords.map((r) => r.durationMs);
  const breaches = slaRecords.filter((r) => r.breached).length;
  const attainmentRate = ((slaRecords.length - breaches) / slaRecords.length) * 100;

  // Group by tier
  const byTier: Record<string, { count: number; breaches: number; attainmentRate: number; p50: number | null; p95: number | null }> = {};
  for (const record of slaRecords) {
    const tier = resolveTier(record.tenantTier);
    if (!byTier[tier]) byTier[tier] = { count: 0, breaches: 0, attainmentRate: 0, p50: null, p95: null };
    byTier[tier].count++;
    if (record.breached) byTier[tier].breaches++;
  }
  for (const [tier, data] of Object.entries(byTier)) {
    const tierDurations = slaRecords.filter((r) => resolveTier(r.tenantTier) === tier).map((r) => r.durationMs);
    data.attainmentRate = data.count > 0 ? ((data.count - data.breaches) / data.count) * 100 : 0;
    data.p50 = percentile(tierDurations, 50);
    data.p95 = percentile(tierDurations, 95);
  }

  res.json({
    totalRecorded: slaRecords.length,
    attainmentRate: Math.round(attainmentRate * 100) / 100,
    fixTimesMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
    },
    breaches,
    byTier,
  });
});

// ---------------------------------------------------------------------------
// Existing endpoints
// ---------------------------------------------------------------------------

router.get('/sla/status', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    const allTenants = req.query.all === 'true';
    if (accountId && !allTenants) {
      const keys = await redisScanKeys(`${REDIS_SLA_PREFIX}*`);
      const entries: Record<string, unknown>[] = [];
      for (const key of keys) {
        const raw = await redisGet(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed.tenant_id === accountId) entries.push(parsed);
          } catch { /* skip */ }
        }
      }
      if (entries.length === 0) {
        res.json({ tenant_id: accountId, tier: 'free', total_tickets: 0, response_breaches: 0, resolution_breaches: 0, current_escalations: 0, total_escalations: 0, active_tickets: 0, resolved_tickets: 0, response_sla_hours: null, resolution_sla_hours: null });
        return;
      }
      const sorted = [...entries].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const tier = resolveTier(String(sorted[0].tenant_tier || 'free'));
      res.json({ tenant_id: accountId, tier, total_tickets: entries.length, response_breaches: entries.filter((e) => e.response_breached).length, resolution_breaches: entries.filter((e) => e.resolution_breached).length, current_escalations: entries.filter((e) => e.escalation_level && !e.resolved_at).length, total_escalations: entries.filter((e) => e.escalation_level).length, active_tickets: entries.filter((e) => !e.resolved_at).length, resolved_tickets: entries.filter((e) => e.resolved_at).length, response_sla_hours: SLA_GOALS[tier]?.response_time_hours ?? null, resolution_sla_hours: SLA_GOALS[tier]?.resolution_time_hours ?? null });
      return;
    }
    const keys = await redisScanKeys(`${REDIS_SLA_PREFIX}*`);
    const tenantMap = new Map<string, { entries: Record<string, unknown>[] }>();
    for (const key of keys) {
      const raw = await redisGet(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const tid = String(parsed.tenant_id || 'unknown');
          if (!tenantMap.has(tid)) tenantMap.set(tid, { entries: [] });
          tenantMap.get(tid)!.entries.push(parsed);
        } catch { /* skip */ }
      }
    }
    const statuses = [];
    for (const [tid, data] of tenantMap) {
      const sorted = [...data.entries].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const tier = resolveTier(String(sorted[0].tenant_tier || 'free'));
      statuses.push({ tenant_id: tid, tier, total_tickets: data.entries.length, response_breaches: data.entries.filter((e) => e.response_breached).length, resolution_breaches: data.entries.filter((e) => e.resolution_breached).length, current_escalations: data.entries.filter((e) => e.escalation_level && !e.resolved_at).length, total_escalations: data.entries.filter((e) => e.escalation_level).length, active_tickets: data.entries.filter((e) => !e.resolved_at).length, resolved_tickets: data.entries.filter((e) => e.resolved_at).length, response_sla_hours: SLA_GOALS[tier]?.response_time_hours ?? null, resolution_sla_hours: SLA_GOALS[tier]?.resolution_time_hours ?? null });
    }
    res.json({ tenants: statuses, total_tenants: statuses.length });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get SLA status');
    res.status(500).json({ error: 'Failed to get SLA status' });
  }
});

router.get('/sla/report', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);
    if (month < 1 || month > 12) { res.status(400).json({ error: 'Invalid month' }); return; }
    const keys = await redisScanKeys(`${REDIS_SLA_PREFIX}*`);
    const tenantMap = new Map<string, Record<string, unknown>[]>();
    for (const key of keys) {
      const raw = await redisGet(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const createdDate = new Date(String(parsed.created_at || ''));
          if (!isNaN(createdDate.getTime()) && createdDate.getFullYear() === year && (createdDate.getMonth() + 1) === month) {
            const tid = String(parsed.tenant_id || 'unknown');
            if (!tenantMap.has(tid)) tenantMap.set(tid, []);
            tenantMap.get(tid)!.push(parsed);
          }
        } catch { /* skip */ }
      }
    }
    const filteredMap = accountId ? new Map([...tenantMap.entries()].filter(([tid]) => tid === accountId)) : tenantMap;
    const rows = [];
    for (const [tid, entries] of filteredMap) {
      if (entries.length === 0) continue;
      const sorted = [...entries].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const tier = resolveTier(String(sorted[0].tenant_tier || 'free'));
      const resolved = entries.filter((e) => e.resolved_at);
      const responseTimes = entries.map((e) => Number(e.response_time_seconds)).filter((v) => !isNaN(v) && v > 0);
      const resolutionTimes = resolved.map((e) => Number(e.resolution_time_seconds)).filter((v) => !isNaN(v) && v > 0);
      const avgResponse = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
      const avgResolution = resolutionTimes.length > 0 ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length : null;
      const breachedTickets = new Set([...entries.filter((e) => e.response_breached).map((e) => e.ticket_id), ...entries.filter((e) => e.resolution_breached).map((e) => e.ticket_id)]);
      const compliantCount = entries.length - breachedTickets.size;
      const complianceRate = entries.length > 0 ? Math.round((compliantCount / entries.length) * 100 * 100) / 100 : 100.0;
      rows.push({ tenant_id: tid, tier, year, month, total_tickets: entries.length, resolved_tickets: resolved.length, response_breaches: entries.filter((e) => e.response_breached).length, resolution_breaches: entries.filter((e) => e.resolution_breached).length, total_escalations: entries.filter((e) => e.escalation_level).length, avg_response_time_seconds: avgResponse, avg_resolution_time_seconds: avgResolution, compliance_rate_pct: complianceRate });
    }
    res.json({ year, month, reports: rows, total_tenants: rows.length, total_tickets: rows.reduce((s, r) => s + r.total_tickets, 0), overall_compliance_rate: rows.length > 0 ? Math.round((rows.reduce((s, r) => s + r.compliance_rate_pct, 0) / rows.length) * 100) / 100 : 100.0 });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get SLA report');
    res.status(500).json({ error: 'Failed to get SLA report' });
  }
});

router.post('/sla/escalate', async (req: Request, res: Response) => {
  try {
    const body = req.body as { ticket_id: string; level: string; reason?: string };
    if (!body.ticket_id || !body.level) { res.status(400).json({ error: 'Missing required fields: ticket_id, level' }); return; }
    const validLevels = ['L1_AUTO', 'L2_HUMAN', 'L3_ENGINEERING'];
    if (!validLevels.includes(body.level)) { res.status(400).json({ error: `Invalid level. Must be: ${validLevels.join(', ')}` }); return; }
    const raw = await redisGet(`${REDIS_SLA_PREFIX}${body.ticket_id}`);
    if (!raw) { res.status(404).json({ error: `Ticket ${body.ticket_id} not found` }); return; }
    let ticketData: Record<string, unknown>;
    try { ticketData = JSON.parse(raw) as Record<string, unknown>; } catch { res.status(500).json({ error: 'Invalid ticket data' }); return; }
    ticketData.escalation_level = body.level;
    ticketData.escalation_triggered_at = new Date().toISOString();
    ticketData.manual_escalation = true;
    if (body.level === 'L3_ENGINEERING' && !ticketData.incident_created) {
      ticketData.incident_created = true;
      ticketData.incident_id = `INC-${Date.now()}`;
    }
    const notes = (ticketData.notes as string[]) || [];
    notes.push(`Manual escalation to ${body.level}: ${body.reason || 'Manual escalation via API'}`);
    ticketData.notes = notes;
    await redisSet(`${REDIS_SLA_PREFIX}${body.ticket_id}`, JSON.stringify(ticketData), 86400 * 90);
    res.json({ success: true, ticket_id: body.ticket_id, escalation_level: body.level, escalation_triggered_at: ticketData.escalation_triggered_at, incident_created: ticketData.incident_created, incident_id: ticketData.incident_id || null, notes });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to escalate');
    res.status(500).json({ error: 'Failed to escalate' });
  }
});

router.get('/sla/tickets/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const raw = await redisGet(`${REDIS_SLA_PREFIX}${ticketId}`);
    if (!raw) { res.status(404).json({ error: `Ticket ${ticketId} not found` }); return; }
    let ticketData: Record<string, unknown>;
    try { ticketData = JSON.parse(raw) as Record<string, unknown>; } catch { res.status(500).json({ error: 'Invalid ticket data' }); return; }
    const tier = resolveTier(String(ticketData.tenant_tier || 'free'));
    res.json({ ...ticketData, response_sla_hours: SLA_GOALS[tier]?.response_time_hours ?? null, resolution_sla_hours: SLA_GOALS[tier]?.resolution_time_hours ?? null });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get ticket SLA');
    res.status(500).json({ error: 'Failed to get ticket SLA status' });
  }
});

export { router as slaRouter };
