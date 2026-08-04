/**
 * Shields.io-compatible badge endpoint for run status.
 *
 * GET /badge/:id.svg — Returns an SVG badge showing the run's status.
 * GET /badge.svg?run=:id — Alternative query-param style.
 *
 * Compatible with shields.io endpoint format so users can embed badges
 * in READMEs: https://img.shields.io/endpoint?url=...
 *
 * @module routes/badge
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'badge' });

const router: Router = Router();

interface BadgeConfig {
  label: string;
  message: string;
  color: string;
}

function statusToBadge(status: string): BadgeConfig {
  switch (status) {
    case 'completed':
    case 'success':
      return { label: 'fix', message: 'passed', color: 'success' };
    case 'failed':
      return { label: 'fix', message: 'failed', color: 'critical' };
    case 'running':
      return { label: 'fix', message: 'running', color: 'blue' };
    case 'queued':
      return { label: 'fix', message: 'queued', color: 'yellow' };
    case 'cancelled':
      return { label: 'fix', message: 'cancelled', color: 'inactive' };
    default:
      return { label: 'fix', message: status, color: 'lightgrey' };
  }
}

function renderBadgeSvg(config: BadgeConfig): string {
  const { label, message, color } = config;

  const colorMap: Record<string, string> = {
    success: '#2ea44f',
    critical: '#d73a4a',
    blue: '#0969da',
    yellow: '#d4a72c',
    inactive: '#8b949e',
    lightgrey: '#9da0a2',
    green: '#2ea44f',
    red: '#d73a4a',
    orange: '#d96c24',
    purple: '#8250df',
  };

  const hexColor = colorMap[color] || color;
  const labelWidth = Math.max(label.length * 7 + 14, 30);
  const msgWidth = Math.max(message.length * 7 + 14, 24);
  const totalWidth = labelWidth + msgWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${msgWidth}" height="20" fill="${hexColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.floor(labelWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${Math.floor(labelWidth / 2)}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + Math.floor(msgWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${labelWidth + Math.floor(msgWidth / 2)}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

router.get('/:id.svg', async (req: Request, res: Response) => {
  try {
    const runId = req.params.id;
    const badge = await resolveBadge(runId);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    res.send(renderBadgeSvg(badge));
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Badge fetch failed');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(renderBadgeSvg({ label: 'fix', message: 'error', color: 'lightgrey' }));
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const runId = req.query.run as string;
    if (!runId) {
      res.status(400).json({ error: 'Missing run parameter' });
      return;
    }

    const badge = await resolveBadge(runId);
    const format = req.query.format as string;

    if (format === 'json' || req.headers.accept?.includes('application/json')) {
      res.json({
        schemaVersion: 1,
        label: badge.label,
        message: badge.message,
        color: badge.color,
      });
      return;
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    res.send(renderBadgeSvg(badge));
  } catch (err) {
    log.error({ err: String(err), runId: req.query.run }, 'Badge fetch failed');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(renderBadgeSvg({ label: 'fix', message: 'error', color: 'lightgrey' }));
  }
});

router.get('/syntaro-badge.json', (_req: Request, res: Response) => {
  res.json({
    schemaVersion: 1,
    label: 'SYNTARO',
    message: 'SYNTARO',
    color: '8250DF',
  });
});

async function resolveBadge(runId: string): Promise<BadgeConfig> {
  const { runsRepository } = await import('../db/repositories/index.js');
  const numericId = Number(runId);
  let status: string | undefined;

  if (Number.isFinite(numericId) && numericId > 0) {
    const run = await runsRepository.findById(numericId);
    if (run) {
      status = run.status;
    }
  }

  if (!status) {
    try {
      const { createStorage } = await import('../storage/index.js');
      const storage = await createStorage();
      if (storage) {
        const run = await storage.getRun(runId);
        if (run) {
          status = run.status;
        }
      }
    } catch {
      // non-fatal
    }
  }

  if (!status) {
    return { label: 'fix', message: 'not found', color: 'inactive' };
  }

  return statusToBadge(status);
}

export { router as badgeRouter };
