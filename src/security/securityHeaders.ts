// @ts-nocheck
/**
 * Security Headers and Content Security Policy configuration.
 *
 * Provides environment-aware CSP directives and additional security headers
 * using helmet. Supports two modes:
 *   - **API-only mode**: Restrictive CSP (no scripts, no inline styles)
 *   - **Dashboard mode**: Allow scripts/styles from self origin
 *
 * Adds the following headers:
 *   - Content-Security-Policy (with violation reporting)
 *   - Cross-Origin-Embedder-Policy: require-corp
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - Origin-Agent-Cluster: ?1
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Strict-Transport-Security (production only)
 *   - X-Content-Type-Options: nosniff
 *   - X-DNS-Prefetch-Control: off
 *   - X-Download-Options: noopen
 *   - X-Frame-Options: DENY
 *   - X-Permitted-Cross-Domain-Policies: none
 *   - X-XSS-Protection: 0
 *   - Permissions-Policy (camera, microphone, geolocation disabled)
 *
 * @module security/securityHeaders
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import type { HelmetOptions } from 'helmet';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'security-headers' });

// ---------------------------------------------------------------------------
// Dashboard build detection
// ---------------------------------------------------------------------------

/**
 * Check whether the dashboard static build directory exists.
 * This determines whether CSP should be in dashboard mode (permissive)
 * or API-only mode (restrictive).
 */
function dashboardBuildExists(): boolean {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    // From src/security/, go up 2 levels to project root, then into dashboard/dist
    const dashboardPath = resolve(currentDir, '../../dashboard/dist');
    return existsSync(dashboardPath);
  } catch {
    return false;
  }
}

// Cache the result — it won't change during the lifetime of the process
let hasDashboardBuild: boolean | null = null;

function getHasDashboardBuild(): boolean {
  if (hasDashboardBuild === null) {
    hasDashboardBuild = dashboardBuildExists();
  }
  return hasDashboardBuild;
}

// ---------------------------------------------------------------------------
// Helmet configuration builder
// ---------------------------------------------------------------------------

/**
 * Build helmet configuration based on environment and detected dashboard mode.
 *
 * @returns HelmetOptions object suitable for passing to `helmet()`
 */
export function buildHelmetConfig(): HelmetOptions {
  const isProduction = config.nodeEnv === 'production';
  const isDashboardMode = getHasDashboardBuild();
  const cspReportUri = config.security.cspReportUri;

  // ── CSP Directives ───────────────────────────────────────────────────
  //
  // Base directives that apply in all modes:
  //   - base-uri: 'none'         — prevent <base> tag injection
  //   - form-action: 'none'      — prevent form submissions
  //   - frame-ancestors: 'none'  — prevent framing (clickjacking)
  //   - object-src: 'none'       — prevent <object>/<embed> attacks
  //
  // Environment-specific:
  //   - upgrade-insecure-requests — only in production (HTTPS only)
  //   - report-uri                — CSP violation reporting endpoint
  //
  // Mode-specific:
  //   Dashboard mode: allow scripts, styles, images from 'self'
  //   API-only mode:  default-src 'none' (no resources at all)

  const directives: Record<string, (string | boolean)[]> = {
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    reportUri: [cspReportUri],
  };

  // Production-only: upgrade insecure requests (HTTP → HTTPS)
  if (isProduction) {
    directives.upgradeInsecureRequests = [];
  }

  if (isDashboardMode) {
    // Dashboard / SPA mode — resources served from same origin
    directives.defaultSrc = ["'self'"];
    directives.scriptSrc = ["'self'"];
    // React / Tailwind commonly inject inline styles. 'unsafe-inline' is
    // required for the SPA to render properly without a nonce system.
    directives.styleSrc = ["'self'", "'unsafe-inline'"];
    directives.imgSrc = ["'self'", "data:"];
    directives.fontSrc = ["'self'"];
    directives.connectSrc = ["'self'"];
    directives.manifestSrc = ["'self'"];
  } else {
    // API-only mode — no browser-rendered content expected
    directives.defaultSrc = ["'none'"];
    directives.scriptSrc = ["'none'"];
    directives.styleSrc = ["'none'"];
    directives.imgSrc = ["'none'"];
    directives.fontSrc = ["'none'"];
    directives.connectSrc = ["'none'"];
    directives.mediaSrc = ["'none'"];
    directives.frameSrc = ["'none'"];
  }

  // Clean up undefined / empty array entries that helmet might warn about
  for (const key of Object.keys(directives)) {
    const val = directives[key];
    if (val === undefined || (Array.isArray(val) && val.length === 0 && key !== 'upgradeInsecureRequests')) {
      if (key !== 'upgradeInsecureRequests') {
        delete directives[key];
      }
    }
  }

  // ── Permissions Policy — disable all sensitive features ──────────────
  const permissionsPolicies: Record<string, string[]> = {
    camera: [],
    microphone: [],
    geolocation: [],
    displayCapture: [],
    fullscreen: [],
    'clipboard-read': [],
    'clipboard-write': [],
    payment: [],
    usb: [],
    serial: [],
    bluetooth: [],
    midi: [],
    magnetometer: [],
    gyroscope: [],
    accelerometer: [],
    'ambient-light-sensor': [],
    'screen-wake-lock': [],
    'window-placement': [],
    'local-fonts': [],
    'idle-detection': [],
    'window-management': [],
  };

  // ── Assemble helmet config ───────────────────────────────────────────
  const helmetConfig: HelmetOptions = {
    // Content Security Policy
    contentSecurityPolicy: {
      directives,
      reportOnly: false,
    },

    // Cross-Origin policies (defense against Spectre/Meltdown)
    crossOriginEmbedderPolicy: { policy: 'require-corp' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    originAgentCluster: true,

    // Referrer policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // HTTP Strict Transport Security (production only to avoid dev issues)
    ...(isProduction
      ? {
          strictTransportSecurity: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          } as const,
        }
      : {}),

    // Permissions Policy
    permissionsPolicy: {
      policies: permissionsPolicies,
    },

    // Standard helmet headers
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xXSSProtection: true,
  };

  return helmetConfig;
}

// ---------------------------------------------------------------------------
// CSP violation report handler
// ---------------------------------------------------------------------------

/**
 * Express handler for CSP violation reports (POST).
 *
 * Browsers POST a JSON report to this endpoint when a CSP directive is
 * violated. The report is logged at WARN level for monitoring.
 *
 * Per the CSP spec, this endpoint should respond 204 No Content.
 *
 * @example
 *   app.post('/api/v1/csp-violation-report', handleCspViolationReport);
 */
export function handleCspViolationReport(req: Request, res: Response): void {
  const report = req.body;

  // Include diagnostic context for alerting
  const context: Record<string, unknown> = {
    'user-agent': req.headers['user-agent'],
    'source-ip': req.ip,
    requestId: (req as { requestId?: string }).requestId,
  };

  // The body might be a JSON object with a "csp-report" key (v2 format)
  // or the full report body. Normalize for logging.
  if (report && typeof report === 'object') {
    const cspReport = report['csp-report'] || report;
    context.cspReport = cspReport;

    // Extract key fields for structured alerting
    if (cspReport['blocked-uri']) context.blockedUri = cspReport['blocked-uri'];
    if (cspReport['violated-directive']) context.violatedDirective = cspReport['violated-directive'];
    if (cspReport['effective-directive']) context.effectiveDirective = cspReport['effective-directive'];
    if (cspReport['source-file']) context.sourceFile = cspReport['source-file'];
  } else {
    context.rawReport = report;
  }

  log.warn(context, 'CSP violation reported');

  // Respond with 204 No Content (CSP spec requirement)
  res.status(204).send();
}
