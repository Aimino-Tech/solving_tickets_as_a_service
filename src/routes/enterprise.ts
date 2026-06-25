import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { rootLogger } from '../utils/logger.js';
const log = rootLogger.child({ module: 'enterprise-api' });
const router = Router();
router.use(rateLimit({ windowMs: 60000, limit: 30, message: { error: 'Too many requests' } }));
const F = [
  { k: 'sso_saml', l: 'SSO / SAML', d: 'SSO via SAML 2.0 with any identity provider', c: 'security' },
  { k: 'dedicated_support', l: 'Dedicated Support', d: 'Slack and email with 15-min response SLA', c: 'support' },
  { k: 'compliance', l: 'Compliance Artifacts', d: 'SOC 2, HIPAA BAA, PCI DSS, ISO 27001, DPA', c: 'compliance' },
  { k: 'custom_sla', l: 'Custom SLA', d: 'Custom SLAs with up to 99.99% uptime', c: 'support' },
  { k: 'audit_log', l: 'Audit Log Export', d: 'Export logs to SIEM via webhook or S3', c: 'security' },
  { k: 'priority', l: 'Priority Queue', d: 'Fixes dispatched ahead of lower tiers', c: 'perf' },
  { k: 'sandbox', l: 'Private Sandbox', d: 'Dedicated sandbox, no colocation', c: 'security' },
  { k: 'unlimited', l: 'Unlimited Fixes', d: 'No per-month fix limits', c: 'billing' },
  { k: 'webhooks', l: 'Custom Webhooks', d: 'Custom endpoints with retry and auth', c: 'integ' },
  { k: 'model', l: 'Dedicated AI Model', d: 'Dedicated AGI instance', c: 'ai' },
];
router.get('/plan', (_, r) => r.json({ plan: { id: 'enterprise', name: 'Enterprise', basePriceCents: 250000, stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise', monthlyFixLimit: -1, concurrentFixes: 50, features: F, complianceArtifacts: ['SOC 2','HIPAA BAA','PCI DSS','ISO 27001','DPA'], slaTiers: [{ level: 'Platinum', responseMin: 15, resolutionH: 2 }, { level: 'Gold', responseMin: 30, resolutionH: 4 }, { level: 'Silver', responseMin: 60, resolutionH: 8 }] } }));
router.get('/features', (_, r) => r.json({ features: F }));
router.get('/sla', (_, r) => r.json({ slaTiers: [{ level: 'Platinum', responseMin: 15, resolutionH: 2 }, { level: 'Gold', responseMin: 30, resolutionH: 4 }, { level: 'Silver', responseMin: 60, resolutionH: 8 }] }));
router.get('/compliance', (req, res) => {
  if (!req.headers['x-account-id'] && !req.headers.authorization) { res.status(401).json({ error: 'Auth required' }); return; }
  res.json({ artifacts: [{ id: 'soc2', name: 'SOC 2 Type II', type: 'soc2', available: true }, { id: 'hipaa', name: 'HIPAA BAA', type: 'hipaa', available: true }, { id: 'pci', name: 'PCI DSS', type: 'pci', available: true }, { id: 'iso', name: 'ISO 27001', type: 'iso27001', available: true }, { id: 'dpa', name: 'DPA', type: 'dpa', available: true }] });
});
router.post('/contact', async (req, res) => {
  try {
    const { name, email, company, message } = req.body as any;
    if (!name || !email || !company || !message) { res.status(400).json({ error: 'Missing fields' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'Invalid email' }); return; }
    log.info({ name, email, company }, 'Enterprise contact');
    if (process.env.ENTERPRISE_SLACK_WEBHOOK) { fetch(process.env.ENTERPRISE_SLACK_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Lead: ${name} (${email}) - ${company}` }) }).catch(() => {}); }
    res.status(201).json({ success: true, message: 'Thank you. We will reach out within 24 hours.' });
  } catch (err) { log.error({ err: String(err) }, 'Contact error'); res.status(500).json({ error: 'Failed' }); }
});
router.get('/status', (req, res) => {
  const tid = req.query.tenant as string || req.headers['x-saml-tenant'] as string;
  if (!tid) { res.json({ enterprise: false, saml: false, features: [] }); return; }
  const isE = process.env[`TENANT_${tid.toUpperCase().replace(/-/g, '_')}_TIER`] === 'enterprise';
  res.json({ tenantId: tid, enterprise: isE, saml: isE, features: isE ? F.map(f => f.k) : [] });
});
export { router as enterpriseRouter };
