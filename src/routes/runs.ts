/**
 * Public Run Page API — shareable run detail endpoint.
 *
 * Provides unauthenticated access to a single run's metadata so the
 * dashboard can render shareable detail pages and social previews.
 *
 * GET /:id — Returns JSON (or HTML if requested with Accept: text/html).
 *
 * Mounted at /api/runs in server.ts — supports the dashboard SPA's
 * existing /api/runs/:id calls AND public sharing links.
 *
 * @module routes/runs
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'runs-public' });

const router: Router = Router();

interface PublicRunResponse {
  id: string | number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  status: string;
  confidence: string | null;
  summary: string | null;
  prUrl: string | null;
  branchName: string | null;
  diff: string | null;
  testOutput: string | null;
  error: string | null;
  durationMs: number | null;
  modelUsed: string | null;
  createdAt: string;
}

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const runId = req.params.id;

    const { runsRepository } = await import('../db/repositories/index.js');
    const numericId = Number(runId);
    let run: unknown;

    if (Number.isFinite(numericId) && numericId > 0) {
      run = await runsRepository.findById(numericId);
    }

    if (!run) {
      try {
        const { createStorage } = await import('../storage/index.js');
        const storage = await createStorage();
        if (storage) {
          run = await storage.getRun(runId);
        }
      } catch {
        // Storage not available
      }
    }

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const raw = run as Record<string, unknown>;
    const data: PublicRunResponse = {
      id: raw.id ?? raw.runId ?? runId,
      repoOwner: String(raw.repoOwner ?? raw.repo_owner ?? ''),
      repoName: String(raw.repoName ?? raw.repo_name ?? ''),
      issueNumber: Number(raw.issueNumber ?? raw.issue_number ?? 0),
      issueTitle: String(raw.issueTitle ?? raw.issue_title ?? ''),
      status: String(raw.status ?? 'unknown'),
      confidence: raw.confidence ? String(raw.confidence) : null,
      summary: raw.summary ? String(raw.summary) : null,
      prUrl: raw.prUrl ?? raw.pr_url ? String(raw.prUrl ?? raw.pr_url) : null,
      branchName: raw.branchName ?? raw.branch_name ? String(raw.branchName ?? raw.branch_name) : null,
      diff: raw.diff ? String(raw.diff) : null,
      testOutput: raw.testOutput ?? raw.test_output ? String(raw.testOutput ?? raw.test_output) : null,
      error: raw.error ? String(raw.error) : null,
      durationMs: raw.durationMs ?? raw.duration_ms ? Number(raw.durationMs ?? raw.duration_ms) : null,
      modelUsed: raw.modelUsed ?? raw.model_used ? String(raw.modelUsed ?? raw.model_used) : null,
      createdAt: raw.createdAt ? String(raw.createdAt) : raw.created_at ? String(raw.created_at) : new Date().toISOString(),
    };

    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderRunPage(data));
      return;
    }

    res.json(data);
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to fetch run');
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

function renderRunPage(run: PublicRunResponse): string {
  const statusColor = (s: string): string => {
    switch (s) {
      case 'completed': case 'success': return 'oklch(0.68 0.22 145)';
      case 'failed': return 'oklch(0.59 0.22 25)';
      case 'running': return 'oklch(0.64 0.22 230)';
      case 'queued': return 'oklch(0.7 0.05 260)';
      default: return 'oklch(0.7 0.05 260)';
    }
  };

  const statusEmoji = (s: string): string => {
    switch (s) {
      case 'completed': case 'success': return '\u2705';
      case 'failed': return '\u274C';
      case 'running': return '\uD83D\uDD04';
      case 'queued': return '\u23F3';
      default: return '\u2753';
    }
  };

  const confidenceLabel = run.confidence ?? 'unknown';
  const confidenceColor = (c: string): string => {
    switch (c) {
      case 'high': return 'oklch(0.68 0.22 145)';
      case 'medium': return 'oklch(0.75 0.22 85)';
      case 'low': return 'oklch(0.59 0.22 25)';
      default: return 'oklch(0.7 0.05 260)';
    }
  };

  const durationStr = run.durationMs
    ? run.durationMs >= 60_000
      ? `${(run.durationMs / 60_000).toFixed(1)}m`
      : `${Math.round(run.durationMs / 1000)}s`
    : '\u2014';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Run ${run.id} — ${escapeHtml(run.repoOwner)}/${escapeHtml(run.repoName)} | STAS</title>
  <meta name="description" content="STAS automated fix run for ${escapeHtml(run.repoOwner)}/${escapeHtml(run.repoName)}#${run.issueNumber}: ${escapeHtml(run.issueTitle)}" />
  <meta property="og:title" content="Run ${run.id} — ${escapeHtml(run.repoOwner)}/${escapeHtml(run.repoName)}" />
  <meta property="og:description" content="${run.status === 'completed' || run.status === 'success' ? '✅ Fix completed' : run.status === 'failed' ? '❌ Fix failed' : '🔄 Fix in progress'} — ${escapeHtml(run.issueTitle)}" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: oklch(0.97 0.01 260); color: oklch(0.2 0.04 260); line-height: 1.6; }
    .container { max-width: 740px; margin: 0 auto; padding: 2rem 1rem; }
    .card { background: oklch(1 0 0); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.25rem; box-shadow: 0 1px 3px oklch(0 0 0 / 0.08); }
    .status-badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; background: ${statusColor(run.status)}20; color: ${statusColor(run.status)}; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .header h1 { font-size: 1.35rem; font-weight: 700; line-height: 1.3; }
    .header .meta { font-size: 0.85rem; color: oklch(0.5 0.03 260); margin-top: 0.25rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: oklch(0.5 0.03 260); margin-bottom: 0.25rem; }
    .value { font-size: 1rem; font-weight: 600; }
    .confidence-tag { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: ${confidenceColor(run.confidence ?? 'unknown')}20; color: ${confidenceColor(run.confidence ?? 'unknown')}; }
    .btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.25rem; border-radius: 8px; font-size: 0.9rem; font-weight: 600; text-decoration: none; cursor: pointer; border: none; transition: all 0.15s; }
    .btn-primary { background: oklch(0.55 0.22 260); color: oklch(1 0 0); }
    .btn-primary:hover { background: oklch(0.5 0.22 260); transform: translateY(-1px); }
    .btn-outline { background: transparent; color: oklch(0.55 0.22 260); border: 1.5px solid oklch(0.55 0.22 260); }
    .btn-outline:hover { background: oklch(0.55 0.22 260 / 0.08); }
    .btn-group { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.5rem; }
    .cta-section { text-align: center; padding: 2rem 1.5rem; }
    .cta-section h2 { font-size: 1.2rem; margin-bottom: 0.5rem; }
    .cta-section p { font-size: 0.9rem; color: oklch(0.5 0.03 260); margin-bottom: 1rem; }
    .error-box { background: oklch(0.95 0.04 25); border: 1px solid oklch(0.8 0.1 25); border-radius: 8px; padding: 1rem; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div>
          <h1>${escapeHtml(run.repoOwner)}/${escapeHtml(run.repoName)}</h1>
          <div class="meta">Issue #${run.issueNumber} &mdash; ${escapeHtml(run.issueTitle)}</div>
        </div>
        <span class="status-badge">${statusEmoji(run.status)} ${escapeHtml(run.status)}</span>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <div class="label">Confidence</div>
        <div class="value"><span class="confidence-tag">${escapeHtml(confidenceLabel)}</span></div>
      </div>
      <div class="card">
        <div class="label">Duration</div>
        <div class="value">${durationStr}</div>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <div class="label">Model</div>
        <div class="value">${escapeHtml(run.modelUsed ?? '\u2014')}</div>
      </div>
      <div class="card">
        <div class="label">Created</div>
        <div class="value">${new Date(run.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>
    ${run.summary ? `<div class="card"><div class="label">Summary</div><p style="margin-top:0.3rem">${escapeHtml(run.summary)}</p></div>` : ''}
    ${run.diff ? `<div class="card"><div class="label">Diff</div><pre style="margin-top:0.3rem;font-family:'SF Mono','Fira Code',monospace;font-size:0.8rem;background:oklch(0.15 0.02 260);color:oklch(0.85 0.02 260);padding:1rem;border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(run.diff.slice(0, 5000))}</pre></div>` : ''}
    ${run.testOutput ? `<div class="card"><div class="label">Test Output</div><pre style="margin-top:0.3rem;font-family:'SF Mono','Fira Code',monospace;font-size:0.8rem;background:oklch(0.15 0.02 260);color:oklch(0.85 0.02 260);padding:1rem;border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(run.testOutput.slice(0, 5000))}</pre></div>` : ''}
    ${run.error ? `<div class="card"><div class="label">Error</div><div class="error-box">${escapeHtml(run.error)}</div></div>` : ''}
    ${run.prUrl ? `<div class="card"><div class="label">Pull Request</div><a href="${escapeHtml(run.prUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="margin-top:0.5rem">View Pull Request \u2197</a></div>` : ''}
    <div class="card cta-section">
      <h2>Automated bug fixing, powered by AI</h2>
      <p>Label a GitHub issue with <code>stas:fix</code> and STAS investigates, fixes, and opens a PR.</p>
      <div class="btn-group" style="justify-content:center">
        <a href="https://github.com/tamnguyen08/solving_tickets_as_a_service" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Get STAS for your repo</a>
        <span style="display:inline-flex;align-items:center;gap:0.25rem;font-size:0.8rem;color:oklch(0.5 0.03 260)">\u2B50 162K+ OpenCode</span>
      </div>
    </div>
    <p style="text-align:center;font-size:0.75rem;color:oklch(0.6 0.02 260);margin-top:1rem">
      <a href="https://github.com/tamnguyen08/solving_tickets_as_a_service" style="color:oklch(0.55 0.22 260);text-decoration:none">STAS</a>
      &mdash; Solving Tickets As A Service
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export { router as runsRouter };
