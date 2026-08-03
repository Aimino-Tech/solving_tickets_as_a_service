/**
 * Admin Actions Audit Trail API - query and export the admin audit log.
 *
 * Routes (mounted at /api/admin/audit):
 *   GET /api/admin/audit          - paginated, filterable query
 *   GET /api/admin/audit/export   - full export as JSON or CSV
 *
 * @module routes/admin_audit
 */

import { Router, type Request, type Response } from "express";
import { readFileSync, existsSync } from "fs";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "admin-audit-api" });
const DEFAULT_LOG_PATH = "/tmp/syntaro-admin-audit.jsonl";

function getLogPath(): string {
  return process.env.ADMIN_AUDIT_LOG_PATH || DEFAULT_LOG_PATH;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
}

function readAuditLog(): AuditEntry[] {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf-8");
  const entries: AuditEntry[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { entries.push(JSON.parse(t) as AuditEntry); } catch { /* skip malformed */ }
  }
  return entries;
}

function filterEntries(entries: AuditEntry[], f: { actor?: string; action?: string; resource?: string; startDate?: Date; endDate?: Date }): AuditEntry[] {
  return entries.filter((e) => {
    if (f.actor && e.actor !== f.actor) return false;
    if (f.action && !e.action.startsWith(f.action)) return false;
    if (f.resource && !e.resource.startsWith(f.resource)) return false;
    if (f.startDate && e.timestamp < f.startDate.toISOString()) return false;
    if (f.endDate && e.timestamp > f.endDate.toISOString()) return false;
    return true;
  });
}

const router: Router = Router();

router.get("/audit", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.abs(Number(req.query.limit) || 100), 1000);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const all = readAuditLog();
    const filtered = filterEntries(all, {
      actor: req.query.actor as string,
      action: req.query.action as string,
      resource: req.query.resource as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    });
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    res.json({ entries: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, "Failed to query admin audit trail");
    res.status(500).json({ error: "Failed to query admin audit trail" });
  }
});

router.get("/audit/export", async (req: Request, res: Response) => {
  try {
    const format = (req.query.format as string) || "json";
    const all = readAuditLog();
    const filtered = filterEntries(all, {
      actor: req.query.actor as string,
      action: req.query.action as string,
      resource: req.query.resource as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    });
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (format === "csv") {
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const header = "id,timestamp,actor,action,resource,details\n";
      const rows = filtered.map((e) => [esc(e.id), esc(e.timestamp), esc(e.actor), esc(e.action), esc(e.resource), esc(JSON.stringify(e.details ?? {}))].join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="admin-audit.csv"');
      res.send(header + rows);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", 'attachment; filename="admin-audit.json"');
      res.json(filtered);
    }
  } catch (err) {
    log.error({ err: String(err) }, "Failed to export admin audit trail");
    res.status(500).json({ error: "Failed to export admin audit trail" });
  }
});

export { router as adminAuditRouter };
