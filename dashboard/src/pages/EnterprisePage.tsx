import { useState } from 'react';
import { Link } from 'react-router-dom';

interface CF { name: string; email: string; company: string; teamSize: string; message: string; }

const FEATURES = [
  { k: 'sso_saml', l: 'SSO / SAML', d: 'Single sign-on via SAML 2.0 with Okta, Azure AD, or Google Workspace.', c: 'security' },
  { k: 'dedicated_support', l: 'Dedicated Support', d: 'Slack and email with 15-min response SLA and dedicated account manager.', c: 'support' },
  { k: 'compliance', l: 'Compliance Artifacts', d: 'SOC 2 Type II, HIPAA BAA, PCI DSS, ISO 27001, and DPA.', c: 'compliance' },
  { k: 'custom_sla', l: 'Custom SLA', d: 'Custom SLAs with uptime guarantees from 99.9% to 99.99%.', c: 'support' },
  { k: 'audit_log', l: 'Audit Log Export', d: 'Export audit logs to your SIEM via webhook or S3.', c: 'security' },
  { k: 'priority', l: 'Priority Queue', d: 'Fixes dispatched ahead of all lower-tier tenants.', c: 'performance' },
  { k: 'sandbox', l: 'Private Sandbox', d: 'Dedicated sandbox environment with no colocation.', c: 'security' },
  { k: 'vpc', l: 'VPC Private Link', d: 'Deploy SYNTARO within your VPC via AWS PrivateLink or Azure Private Link.', c: 'infra' },
  { k: 'scim', l: 'SCIM Provisioning', d: 'Automated user provisioning and deprovisioning via SCIM 2.0.', c: 'security' },
  { k: 'onprem', l: 'On-Premise Deploy', d: 'Deploy the full SYNTARO stack in your own data center.', c: 'infra' },
  { k: 'webhooks', l: 'Custom Webhooks', d: 'Custom webhook endpoints with retry, auth, and rate limiting.', c: 'integ' },
  { k: 'model', l: 'Dedicated AI Model', d: 'Dedicated AGI instance for your organization.', c: 'ai' },
];

const CC: Record<string, string> = {
  security: 'bg-blue-50 text-blue-700', support: 'bg-green-50 text-green-700',
  compliance: 'bg-purple-50 text-purple-700', performance: 'bg-orange-50 text-orange-700',
  infra: 'bg-gray-50 text-gray-700', integ: 'bg-indigo-50 text-indigo-700', ai: 'bg-pink-50 text-pink-700',
  billing: 'bg-yellow-50 text-yellow-700',
};

const ARTIFACTS = [
  { id: 'soc2', name: 'SOC 2 Type II Report', desc: 'System and Organization Controls 2 audit report' },
  { id: 'hipaa', name: 'HIPAA BAA', desc: 'Business Associate Agreement for covered entities' },
  { id: 'pci', name: 'PCI DSS Attestation', desc: 'PCI Data Security Standard compliance' },
  { id: 'iso', name: 'ISO 27001 Certificate', desc: 'Information Security Management certificate' },
  { id: 'dpa', name: 'Data Processing Agreement', desc: 'Standard contractual clauses for GDPR' },
];

export default function EnterprisePage() {
  const [f, setF] = useState<CF>({ name: '', email: '', company: '', teamSize: '', message: '' });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const h = (k: keyof CF, v: string) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const r = await fetch('/api/v1/enterprise/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      setSent(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  };
  if (sent) return (
    <div className="mx-auto max-w-4xl px-4 py-24 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
      </div>
      <h2 className="mt-6 text-3xl font-bold text-gray-900">Thank You</h2>
      <p className="mt-4 text-lg text-gray-600">Our team will reach out within 24 hours.</p>
      <Link to="/" className="mt-8 inline-flex text-sm font-semibold text-brand-600">&larr; Back</Link>
    </div>
  );
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-gray-900 sm:text-6xl">Enterprise</h1>
        <p className="mt-6 text-xl text-gray-600 max-w-3xl mx-auto">Unlimited fixes, dedicated support, compliance artifacts, and SSO. Built for scale.</p>
        <div className="mt-8 flex justify-center gap-4">
          <span className="rounded-full bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-700">From $2,500/mo</span>
          <span className="rounded-full bg-green-50 px-4 py-1.5 text-sm font-medium text-green-700">Unlimited fixes</span>
          <span className="rounded-full bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700">SSO / SAML</span>
        </div>
      </div>
      <div className="mt-16 rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
        <p className="text-lg font-semibold text-brand-900">Custom Pricing Starting at $2,500/month</p>
        <p className="mt-2 text-brand-700">Annual contracts save 20%. Volume discounts for 1,000+ fixes/mo.</p>
      </div>
      <div className="mt-16">
        <h2 className="text-3xl font-bold text-gray-900">Enterprise Features</h2>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((fe) => (
            <div key={fe.k} className="rounded-xl border border-gray-200 bg-white p-6 hover:shadow-md transition-shadow">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${CC[fe.c] || 'bg-gray-50 text-gray-600'}`}>{fe.c}</span>
              <h3 className="mt-3 text-lg font-semibold text-gray-900">{fe.l}</h3>
              <p className="mt-2 text-sm text-gray-600">{fe.d}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-16">
        <h2 className="text-3xl font-bold text-gray-900">Compliance</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ARTIFACTS.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{a.name}</h3>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Available</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-16 rounded-2xl border border-gray-200 bg-white p-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold text-center text-gray-900">Contact Sales</h2>
          <p className="mt-2 text-lg text-center text-gray-600">Fill out the form and our team will respond within 24 hours.</p>
          {err && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
          <form onSubmit={submit} className="mt-8 space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700">Name *</label>
                <input id="contact-name" type="text" required aria-required="true" value={f.name} onChange={e => h('name', e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm" placeholder="Jane Smith" />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700">Email *</label>
                <input id="contact-email" type="email" required aria-required="true" value={f.email} onChange={e => h('email', e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm" placeholder="jane@company.com" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="contact-company" className="block text-sm font-medium text-gray-700">Company *</label>
                <input id="contact-company" type="text" required aria-required="true" value={f.company} onChange={e => h('company', e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm" placeholder="Acme Corp" />
              </div>
              <div>
                <label htmlFor="contact-team-size" className="block text-sm font-medium text-gray-700">Team Size</label>
                <select id="contact-team-size" value={f.teamSize} onChange={e => h('teamSize', e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm">
                  <option value="">Select...</option>
                  <option value="1-10">1-10</option><option value="11-50">11-50</option>
                  <option value="51-200">51-200</option><option value="201+">201+</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="contact-message" className="block text-sm font-medium text-gray-700">Message *</label>
              <textarea id="contact-message" required aria-required="true" rows={4} value={f.message} onChange={e => h('message', e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm" placeholder="Tell us about your needs..." />
            </div>
            <button type="submit" className="w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">Contact Sales</button>
          </form>
        </div>
      </div>
    </div>
  );
}
