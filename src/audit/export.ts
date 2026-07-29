/**
 * Audit Export — Enhanced export functionality for audit logs.
 *
 * Provides export to CSV and JSON formats with date range and category
 * filtering. Includes GDPR data residency compliance annotations.
 *
 * This module provides the business logic; routes are mounted in server.ts.
 *
 * @module audit/export
 */

import { auditRepository, type AuditLogRow, type AuditLogFilter } from './repository.js';
import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';

const log = rootLogger.child({ module: 'audit-export' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = 'csv' | 'json';

export interface ExportOptions {
  /** Date range start (inclusive). */
  startDate?: Date;
  /** Date range end (exclusive). */
  endDate?: Date;
  /** Filter by specific action(s). */
  actions?: string[];
  /** Filter by actor type. */
  actorType?: string;
  /** Filter by resource type. */
  resourceType?: string;
  /** Export format. */
  format: ExportFormat;
  /** Maximum number of entries to export. Defaults to 10,000. */
  limit?: number;
}

export interface ExportResult {
  /** The exported content as a string (CSV text or JSON array string). */
  content: string;
  /** The MIME type for the response. */
  contentType: string;
  /** Suggested filename for download. */
  filename: string;
  /** Number of entries exported. */
  count: number;
  /** Compliance metadata for GDPR data residency. */
  compliance: {
    gdprCompliant: boolean;
    dataResidency: string;
    hoster: string;
    retentionDays: number;
    exportedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Helper: escape CSV field
// ---------------------------------------------------------------------------

function escapeCsvField(value: unknown): string {
  const str = value == null ? '' : String(value);
  // If the field contains a comma, newline, or double-quote, wrap it in double-quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// Helper: format a single row as CSV
// ---------------------------------------------------------------------------

function formatCsvRow(row: AuditLogRow): string {
  return [
    escapeCsvField(row.id),
    escapeCsvField(row.timestamp?.toISOString() ?? ''),
    escapeCsvField(row.actorType),
    escapeCsvField(row.actorId),
    escapeCsvField(row.action),
    escapeCsvField(row.resourceType),
    escapeCsvField(row.resourceId),
    escapeCsvField(row.details ? JSON.stringify(row.details) : ''),
    escapeCsvField(row.ipAddress),
    escapeCsvField(row.correlationId),
  ].join(',');
}

// ---------------------------------------------------------------------------
// Helper: format entries as CSV
// ---------------------------------------------------------------------------

function toCsv(rows: AuditLogRow[]): string {
  const header = 'id,timestamp,actorType,actorId,action,resourceType,resourceId,details,ipAddress,correlationId';
  const body = rows.map(formatCsvRow).join('\n');
  return `${header}\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Helper: format entries as JSON
// ---------------------------------------------------------------------------

function toJson(rows: AuditLogRow[]): string {
  return JSON.stringify(rows, null, 2);
}

// ---------------------------------------------------------------------------
// Build filter from export options
// ---------------------------------------------------------------------------

function buildFilter(options: ExportOptions): AuditLogFilter {
  const filter: AuditLogFilter = {};

  if (options.startDate) {
    filter.startDate = options.startDate;
  }
  if (options.endDate) {
    filter.endDate = options.endDate;
  }
  if (options.actorType) {
    filter.actorType = options.actorType as any;
  }
  if (options.resourceType) {
    filter.resourceType = options.resourceType;
  }
  if (options.limit) {
    filter.limit = Math.min(options.limit, 10_000); // cap at 10k
  }

  return filter;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export audit logs in the requested format with optional filtering.
 *
 * Returns the content, MIME type, suggested filename, entry count,
 * and GDPR compliance metadata.
 */
export async function exportAuditLogs(options: ExportOptions): Promise<ExportResult> {
  const { format } = options;

  // Build the filter from export options
  const filter = buildFilter(options);

  // If specific actions are requested, we'll filter post-query
  const { rows } = await auditRepository.query(filter);

  // Post-filter by actions if specified
  let filteredRows = rows;
  if (options.actions && options.actions.length > 0) {
    const actionSet = new Set(options.actions.map((a) => a.toLowerCase()));
    filteredRows = rows.filter((r) => actionSet.has(r.action.toLowerCase()));
  }

  // Determine content type and format the output
  let content: string;
  let contentType: string;
  let filename: string;

  if (format === 'csv') {
    content = toCsv(filteredRows);
    contentType = 'text/csv';
    filename = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    content = toJson(filteredRows);
    contentType = 'application/json';
    filename = `audit-export-${new Date().toISOString().slice(0, 10)}.json`;
  }

  log.info(
    {
      format,
      count: filteredRows.length,
      startDate: options.startDate?.toISOString(),
      endDate: options.endDate?.toISOString(),
    },
    'Audit export completed',
  );

  return {
    content,
    contentType,
    filename,
    count: filteredRows.length,
    compliance: {
      gdprCompliant: true,
      dataResidency: 'EU (Germany)',
      hoster: 'Hetzner (Nürnberg/Falkenstein)',
      retentionDays: config.dataPrivacy.retentionDays,
      exportedAt: new Date().toISOString(),
    },
  };
}

/**
 * Stream audit logs as a download response.
 * Sets the appropriate Content-Type, Content-Disposition, and compliance headers.
 */
export async function streamAuditExport(
  res: import('express').Response,
  options: ExportOptions,
): Promise<void> {
  try {
    const result = await exportAuditLogs(options);

    // Set GDPR compliance headers for DACH market
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-GDPR-Compliant', 'true');
    res.setHeader('X-Data-Residency', 'EU (Germany)');
    res.setHeader('X-Export-Count', String(result.count));

    res.send(result.content);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to stream audit export');
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
}

/**
 * Stream audit export as CSV with default filtering.
 * Convenience wrapper for the GET /api/admin/audit/export endpoint.
 */
export async function streamAuditExportCsv(
  res: import('express').Response,
  query: {
    startDate?: string;
    endDate?: string;
    action?: string;
    actorType?: string;
    resourceType?: string;
    limit?: string;
  },
): Promise<void> {
  const options: ExportOptions = {
    format: 'csv',
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    actions: query.action ? query.action.split(',') : undefined,
    actorType: query.actorType,
    resourceType: query.resourceType,
    limit: query.limit ? Math.min(Number(query.limit), 10_000) : 10_000,
  };

  await streamAuditExport(res, options);
}

/**
 * Stream audit export as JSON with default filtering.
 * Convenience wrapper for the JSON export endpoint.
 */
export async function streamAuditExportJson(
  res: import('express').Response,
  query: {
    startDate?: string;
    endDate?: string;
    action?: string;
    actorType?: string;
    resourceType?: string;
    limit?: string;
  },
): Promise<void> {
  const options: ExportOptions = {
    format: 'json',
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    actions: query.action ? query.action.split(',') : undefined,
    actorType: query.actorType,
    resourceType: query.resourceType,
    limit: query.limit ? Math.min(Number(query.limit), 10_000) : 10_000,
  };

  await streamAuditExport(res, options);
}
