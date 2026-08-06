import { isTableNotFoundError, queryWithRetry, validateSqlIdentifier } from '../connection.js';

export interface ServiceCatalogEntry {
  id: number;
  name: string;
  repos: string[];
  purpose: string | null;
  runbook: string | null;
  providers: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewServiceCatalogEntry {
  name: string;
  repos?: string[];
  purpose?: string | null;
  runbook?: string | null;
  providers?: string[];
}

function mapRow(row: Record<string, unknown>): ServiceCatalogEntry {
  return {
    id: Number(row.id),
    name: String(row.name),
    repos: Array.isArray(row.repos) ? row.repos.map(String) : [],
    purpose: row.purpose != null ? String(row.purpose) : null,
    runbook: row.runbook != null ? String(row.runbook) : null,
    providers: Array.isArray(row.providers) ? row.providers.map(String) : [],
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class IncidentServiceCatalogRepository {
  async list(): Promise<ServiceCatalogEntry[]> {
    try {
      const result = await queryWithRetry<Record<string, unknown>>(
        'SELECT * FROM incident_service_catalog ORDER BY name ASC',
        [],
      );
      return result.rows.map(mapRow);
    } catch (err) {
      if (isTableNotFoundError(err)) return [];
      throw err;
    }
  }

  async findById(id: number): Promise<ServiceCatalogEntry | undefined> {
    const result = await queryWithRetry<Record<string, unknown>>(
      'SELECT * FROM incident_service_catalog WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async findByName(name: string): Promise<ServiceCatalogEntry | undefined> {
    const result = await queryWithRetry<Record<string, unknown>>(
      'SELECT * FROM incident_service_catalog WHERE name = $1',
      [name],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async create(data: NewServiceCatalogEntry): Promise<ServiceCatalogEntry> {
    const result = await queryWithRetry<Record<string, unknown>>(
      `INSERT INTO incident_service_catalog (name, repos, purpose, runbook, providers)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.name, data.repos ?? [], data.purpose ?? null, data.runbook ?? null, data.providers ?? []],
    );
    return mapRow(result.rows[0]);
  }

  async update(id: number, data: Partial<NewServiceCatalogEntry>): Promise<ServiceCatalogEntry | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.repos !== undefined) {
      sets.push(`repos = $${idx++}`);
      values.push(data.repos);
    }
    if (data.purpose !== undefined) {
      sets.push(`purpose = $${idx++}`);
      values.push(data.purpose);
    }
    if (data.runbook !== undefined) {
      sets.push(`runbook = $${idx++}`);
      values.push(data.runbook);
    }
    if (data.providers !== undefined) {
      sets.push(`providers = $${idx++}`);
      values.push(data.providers);
    }
    sets.push(`updated_at = NOW()`);

    for (const clause of sets) {
      validateSqlIdentifier(clause.split('=')[0].trim());
    }

    values.push(id);
    const result = await queryWithRetry<Record<string, unknown>>(
      `UPDATE incident_service_catalog SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry<{ id: number }>(
      'DELETE FROM incident_service_catalog WHERE id = $1 RETURNING id',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export const incidentServiceCatalogRepository = new IncidentServiceCatalogRepository();
