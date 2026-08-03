/**
 * SYNTARO Premium — Hosted Service Dashboard Backend
 *
 * Standalone Express server that serves:
 * - Dashboard API routes (/api/runs, /api/repos, /api/stats, etc.)
 * - GitHub OAuth auth routes (/api/auth/github, /api/auth/callback)
 * - Static dashboard build in production
 *
 * In development, run `npm run dev` in `dashboard/` for Vite HMR,
 * and this server on port 3001 for the API proxy.
 */

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { rootLogger } from '../../src/utils/logger.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = rootLogger.child({ module: 'premium-server' });

const PORT = Number(process.env.PREMIUM_PORT) || 3001;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';

const app = express();

// -- Middleware -----------------------------------------------------------
app.use(express.json());
app.use(cookieParser());

// -- Request logging ------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.info(
      { method: req.method, path: req.path, status: res.statusCode, latency: Date.now() - start },
      `${req.method} ${req.path} ${res.statusCode}`,
    );
  });
  next();
});

// -- CORS for dev mode ----------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', DASHBOARD_URL);
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

// -- API Routes -----------------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api', dashboardRouter);

// -- Health check ---------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'syntaro-premium',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// -- Serve static dashboard in production ---------------------------------
if (process.env.NODE_ENV === 'production') {
  const staticDir = path.resolve(__dirname, '../../dashboard/dist');
  app.use(express.static(staticDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// -- 404 handler ----------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// -- Global error handler -------------------------------------------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err: String(err) }, 'Unhandled error in premium server');
  res.status(500).json({ error: 'Internal server error' });
});

// -- Start server ---------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  log.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, `SYNTARO Premium server listening on :${PORT}`);
});

export default app;
