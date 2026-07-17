/**
 * Dashboard API routes for the STAS premium hosted service.
 *
 * These routes provide the data backing for the React dashboard.
 * All routes (except /stats) require JWT authentication.
 *
 * GET    /api/runs       — List runs (paginated, filterable)
 * GET    /api/runs/:id   — Run detail
 * GET    /api/repos      — Connected repos
 * POST   /api/repos      — Connect a repo
 * DELETE /api/repos/:id  — Disconnect a repo
 * GET    /api/stats      — Aggregate dashboard statistics
 * GET    /api/audit      — Audit log entries (paginated)
 * GET    /api/settings   — Current bot settings
 * PUT    /api/settings   — Update bot settings
 */
declare const router: any;
export { router as dashboardRouter };
