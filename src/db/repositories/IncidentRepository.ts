/**
 * Incidents repository (AIM-4631) — incidents, timeline, per-repo links,
 * and the service catalog.
 */

import { queryWithRetry } from '../connection.js';
import type {
  Incident,
  NewIncident,
  IncidentTimelineEntry,
  NewIncidentTimelineEntry,
  IncidentRepo,
  NewIncidentRepo,
  ServiceCatalogEntry,
  NewServiceCatalogEntry,
} from '../types/index.js';

const INCIDENT_COLUMNS = `id, title, severity, status, source, confidence, summary,
  alert_id, run_id, auto_fixed, policy_decision, resolved_at, created_at, updated_at`;

function mapIncident(row: Record<string, unknown>): Incident {
  return {
    id: Number(row.id),
    title: String(row.title),
    severity: String(row.severity),
    status: String(row.status),
    source: String(row.source),
    confidence: row.confidence ? String(row.confidence) : null,
    summary: row.summary ? String(row.summary) : null,
    alertId: row.alert_id ? String(row.alert_id) : null,
    runId: row.run_id ? String(row.run_id) : null,
    autoFixed: Boolean(row.auto_fixed),
    policyDecision: row.policy_decision ? String(row.policy_decision) : null,
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapTimeline(row: Record<string, unknown>): IncidentTimelineEntry {
  return {
    id: Number(row.id),
    incidentId: Number(row.incident_id),
    event: String(row.event),
    detail: row.detail ? String(row.detail) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

function mapIncidentRepo(row: Record<string, unknown>): IncidentRepo {
  return {
    id: Number(row.id),
    incidentId: Number(row.incident_id),
    repoOwner: String(row.repo_owner),
    repoName: String(row.repo_name),
    status: String(row.status),
    prUrl: row.pr_url ? String(row.pr_url) : null,
    branchName: row.branch_name ? String(row.branch_name) : null,
    runId: row.run_id ? String(row.run_id) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapService(row: Record<string, unknown>): ServiceCatalogEntry {
  return {
    id: Number(row.id),
    name: String(row.name),
    purpose: row.purpose ? String(row.purpose) : null,
    repos: Array.isArray(row.repos) ? (row.repos as Array<{ owner: string; repo: string }>) : [],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export class IncidentRepository {
  async list(filters?: {
    severity?: string;
    status?: string;
    source?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: Incident[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replaceAll('?', `$${paramIdx++}`));
    };

    if (filters?.severity) add(`severity = ?`, filters.severity);
    if (filters?.status) add(`status = ?`, filters.status);
    if (filters?.source) add(`source = ?`, filters.source);
    if (filters?.from) add(`created_at >= ?`, filters.from);
    if (filters?.to) add(`created_at <= ?`, filters.to);

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM incidents ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await queryWithRetry<Record<string, unknown>>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return { rows: result.rows.map(mapIncident), total };
  }

  async getById(id: number): Promise<Incident | null> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapIncident(result.rows[0]) : null;
  }

  async create(data: NewIncident): Promise<Incident> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `INSERT INTO incidents (title, severity, status, source, confidence, summary, alert_id, run_id, auto_fixed, policy_decision, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${INCIDENT_COLUMNS}`,
      [
        data.title,
        data.severity ?? 'SEV3',
        data.status ?? 'open',
        data.source ?? 'monitoring',
        data.confidence ?? null,
        data.summary ?? null,
        data.alertId ?? null,
        data.runId ?? null,
        data.autoFixed ?? false,
        data.policyDecision ?? null,
        data.resolvedAt ?? null,
      ],
    );
    return mapIncident(result.rows[0]);
  }

  async updateStatus(
    id: number,
    status: string,
    extra?: { resolvedAt?: Date | null },
  ): Promise<Incident | null> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `UPDATE incidents
       SET status = $2, resolved_at = COALESCE($3, resolved_at), updated_at = NOW()
       WHERE id = $1
       RETURNING ${INCIDENT_COLUMNS}`,
      [id, status, extra?.resolvedAt ?? null],
    );
    return result.rows[0] ? mapIncident(result.rows[0]) : null;
  }

  async addTimeline(data: NewIncidentTimelineEntry): Promise<IncidentTimelineEntry> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `INSERT INTO incident_timeline (incident_id, event, detail)
       VALUES ($1, $2, $3)
       RETURNING id, incident_id, event, detail, created_at`,
      [data.incidentId, data.event, data.detail ?? null],
    );
    return mapTimeline(result.rows[0]);
  }

  async getTimeline(incidentId: number): Promise<IncidentTimelineEntry[]> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `SELECT id, incident_id, event, detail, created_at
       FROM incident_timeline
       WHERE incident_id = $1
       ORDER BY created_at ASC`,
      [incidentId],
    );
    return result.rows.map(mapTimeline);
  }

  async addRepo(data: NewIncidentRepo): Promise<IncidentRepo> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `INSERT INTO incident_repos (incident_id, repo_owner, repo_name, status, pr_url, branch_name, run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, incident_id, repo_owner, repo_name, status, pr_url, branch_name, run_id, created_at, updated_at`,
      [
        data.incidentId,
        data.repoOwner,
        data.repoName,
        data.status ?? 'pending',
        data.prUrl ?? null,
        data.branchName ?? null,
        data.runId ?? null,
      ],
    );
    return mapIncidentRepo(result.rows[0]);
  }

  async updateRepoStatus(
    repoId: number,
    status: string,
    extra?: { prUrl?: string | null; branchName?: string | null; runId?: string | null },
  ): Promise<IncidentRepo | null> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `UPDATE incident_repos
       SET status = $2,
           pr_url = COALESCE($3, pr_url),
           branch_name = COALESCE($4, branch_name),
           run_id = COALESCE($5, run_id),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, incident_id, repo_owner, repo_name, status, pr_url, branch_name, run_id, created_at, updated_at`,
      [repoId, status, extra?.prUrl ?? null, extra?.branchName ?? null, extra?.runId ?? null],
    );
    return result.rows[0] ? mapIncidentRepo(result.rows[0]) : null;
  }

  async getRepos(incidentId: number): Promise<IncidentRepo[]> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `SELECT id, incident_id, repo_owner, repo_name, status, pr_url, branch_name, run_id, created_at, updated_at
       FROM incident_repos
       WHERE incident_id = $1
       ORDER BY id ASC`,
      [incidentId],
    );
    return result.rows.map(mapIncidentRepo);
  }

  async getStats(): Promise<{
    total: number;
    open: number;
    investigating: number;
    fixing: number;
    resolved: number;
    mttrMs: number | null;
    bySeverity: Array<{ severity: string; count: number }>;
  }> {
    const totalResult = await queryWithRetry<{ total: number }>(`SELECT COUNT(*) as total FROM incidents`);
    const total = Number(totalResult.rows[0]?.total ?? 0);

    const byStatusResult = await queryWithRetry<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM incidents GROUP BY status`,
    );
    const byStatus: Record<string, number> = {};
    for (const row of byStatusResult.rows) byStatus[row.status] = Number(row.count);

    const mttrResult = await queryWithRetry<{ avg_ms: number | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) * 1000) as avg_ms
       FROM incidents WHERE resolved_at IS NOT NULL`,
    );

    const bySeverityResult = await queryWithRetry<{ severity: string; count: number }>(
      `SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity ORDER BY severity`,
    );

    return {
      total,
      open: byStatus.open ?? 0,
      investigating: byStatus.investigating ?? 0,
      fixing: byStatus.fixing ?? 0,
      resolved: byStatus.resolved ?? 0,
      mttrMs: mttrResult.rows[0]?.avg_ms ? Number(mttrResult.rows[0].avg_ms) : null,
      bySeverity: bySeverityResult.rows.map((r) => ({ severity: r.severity, count: Number(r.count) })),
    };
  }
}

export class ServiceCatalogRepository {
  async list(): Promise<ServiceCatalogEntry[]> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `SELECT id, name, purpose, repos, created_at, updated_at
       FROM service_catalog ORDER BY name ASC`,
    );
    return result.rows.map(mapService);
  }

  async create(data: NewServiceCatalogEntry): Promise<ServiceCatalogEntry> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `INSERT INTO service_catalog (name, purpose, repos)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, name, purpose, repos, created_at, updated_at`,
      [data.name, data.purpose ?? null, JSON.stringify(data.repos ?? [])],
    );
    return mapService(result.rows[0]);
  }

  async update(
    id: number,
    data: Partial<Pick<NewServiceCatalogEntry, 'purpose' | 'repos'>>,
  ): Promise<ServiceCatalogEntry | null> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `UPDATE service_catalog
       SET purpose = COALESCE($2, purpose),
           repos = CASE WHEN $3::text IS NULL THEN repos ELSE $3::jsonb END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, purpose, repos, created_at, updated_at`,
      [id, data.purpose ?? null, data.repos !== undefined ? JSON.stringify(data.repos) : null],
    );
    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async remove(id: number): Promise<void> {
    await queryWithRetry(`DELETE FROM service_catalog WHERE id = $1`, [id]);
  }
}

export const incidentRepository = new IncidentRepository();
export const serviceCatalogRepository = new ServiceCatalogRepository();
