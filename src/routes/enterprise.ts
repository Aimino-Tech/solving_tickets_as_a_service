/**
 * Enterprise API routes — plan info, feature flags, contact form,
 * compliance artifacts, and SLA tiers.
 *
 * Mounted at /api/v1/enterprise.
 *
 * Routes:
 *   GET    /api/v1/enterprise/plan       — Enterprise plan definition
 *   GET    /api/v1/enterprise/features   — Enterprise feature flags
 *   GET    /api/v1/enterprise/compliance — Compliance artifacts list
 *   GET    /api/v1/enterprise/sla        — SLA tier definitions
 *   POST   /api/v1/enterprise/contact    — Contact sales form
 *   GET    /api/v1/enterprise/status     — Enterprise status for tenant
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'enterprise-api' });
const router: Router = Router();


const ENTERPRISE_FEATURES = [
  { key: 'sso_saml', label: 'SSO / SAML', description: 'Single sign-on via SAML 2.0 with any identity provider', category: 'security' },
  { key: 'dedicated_support', label: 'Dedicated Support', description: 'Slack and email with 15-minute response SLA', category: 'support' },
  { key: 'compliance_artifacts', label: 'Compliance Artifacts', description: 'SOC 2, HIPAA BAA, PCI DSS, ISO 27001, DPA', category: 'compliance' },
  { key: 'custom_sla', label: 'Custom SLA', description: 'Custom SLAs with uptime guarantees up to 99.99%', category: 'support' },
  { key: 'audit_log_export', label: 'Audit Log Export', description: 'Export audit logs to SIEM via webhook or S3', category: 'security' },
  { key: 'priority_queue', label: 'Priority Queue', description: 'Fixes dispatched ahead of all lower-tier tenants', category: 'performance' },
  { key: 'private_sandbox', label: 'Private Sandbox', description: 'Dedicated sandbox with no colocation', category: 'security' },
  { key: 'unlimited_fixes', label: 'Unlimited Fixes', description: 'No per-month fix limits', category: 'billing' },
  { key: 'custom_webhooks', label: 'Custom Webhooks', description: 'Custom webhook endpoints with retry and auth', category: 'integration' },
  { key: 'dedicated_model', label: 'Dedicated AI Model', description: 'Dedicated AGI instance with custom fine-tuning', category: 'ai' },
];

const SLA_TIERS = [
  { level: 'Platinum', responseTimeMinutes: 15, resolutionTimeHours: 2, supportHours: '24/7' },
  { level: 'Gold', responseTimeMinutes: 30, resolutionTimeHours: 4, supportHours: '24/7' },
  { level: 'Silver', responseTimeMinutes: 60, resolutionTimeHours: 8, supportHours: 'Business hours' },
];

const ENTERPRISE_PLAN = {
  id: 'enterprise', name: 'Enterprise',
  description: 'For organizations at scale — unlimited fixes, SSO/SAML, dedicated support',
  basePriceCents: 250_000,
  stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise',
  monthlyFixLimit: -1, concurrentFixes: 50,
  features: ENTERPRISE_FEATURES, slaTiers: SLA_TIERS,
  complianceArtifacts: [
    'SOC 2 Type II Report', 'HIPAA Business Associate Agreement',
    'PCI DSS Attestation of Compliance', 'ISO 27001 Certificate', 'Data Processing Agreement',
  ],
};

// GET /enterprise/plan
router.get('/plan', (_req: Request, res: Response) => { res.json({ plan: ENTERPRISE_PLAN }); });

// GET /enterprise/features
router.get('/features', (_req: Request, res: Response) => { res.json({ features: ENTERPRISE_FEATURES }); });

// GET /enterprise/sla
router.get('/sla', (_req: Request, res: Response) => { res.json({ slaTiers: SLA_TIERS }); });

// GET /enterprise/compliance — requires auth
router.get('/compliance', (req: Request, res: Response) => {
  if (!req.headers['x-account-id'] && !req.headers.authorization) {
    res.status(401).json({ error: 'Authentication required' }); return;
  }
  res.json({
    artifacts: [
      { id: 'soc2-2026', name: 'SOC 2 Type II Report', type: 'soc2', version: '2026-06', available: true, validUntil: '2027-06-30' },
      { id: 'hipaa-baa-2026', name: 'HIPAA Business Associate Agreement', type: 'hipaa', version: '2026-06', available: true, validUntil: '2027-06-30' },
      { id: 'pci-dss-2026', name: 'PCI DSS Attestation', type: 'pci', version: '2026-06', available: true, validUntil: '2027-06-30' },
      { id: 'iso27001-2026', name: 'ISO 27001 Certificate', type: 'iso27001', version: '2026-06', available: true, validUntil: '2027-06-30' },
      { id: 'dpa-2026', name: 'Data Processing Agreement', type: 'dpa', version: '2026-06', available: true, validUntil: null },
    ],
  });
});

// POST /enterprise/contact
router.post('/contact', async (req: Request, res: Response) => {
  try {
    const { name, email, company, teamSize, message } = req.body as {
      name: string; email: string; company: string; teamSize?: string; message: string;
    };

    if (!name || !email || !company || !message) {
      res.status(400).json({ error: 'Missing required fields: name, email, company, message' });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Invalid email' }); return;
    }

    log.info({ name, email, company, teamSize }, 'Enterprise contact form submission');

    if (process.env.ENTERPRISE_SLACK_WEBHOOK) {
      fetch(process.env.ENTERPRISE_SLACK_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*Enterprise Lead*\nName: ${name}\nEmail: ${email}\nCompany: ${company}\nTeam: ${teamSize || 'N/A'}\nMessage: ${message}`,
        }),
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: 'Thank you. Our enterprise team will reach out within 24 hours.',
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to process enterprise contact');
    res.status(500).json({ error: 'Failed to process contact form' });
  }
});

// GET /enterprise/status
router.get('/status', (req: Request, res: Response) => {
  const tenantId = req.query.tenant as string || req.headers['x-saml-tenant'] as string;
  if (!tenantId) { res.json({ enterprise: false, saml: false, features: [] }); return; }

  const isEnterprise = process.env[`TENANT_${tenantId.toUpperCase().replace(/-/g, '_')}_TIER`] === 'enterprise';
  res.json({
    tenantId, enterprise: isEnterprise, saml: isEnterprise,
    features: isEnterprise ? ENTERPRISE_FEATURES.map((f) => f.key) : [],
  });
});

export { router as enterpriseRouter };
