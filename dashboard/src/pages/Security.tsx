export default function Security() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">Security & Trust</h1>
        <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">Your code is your intellectual property. We built SYNTARO with a security-first architecture so you never have to compromise on trust.</p>
      </div>
      <div className="mt-16 rounded-2xl border border-brand-200 bg-brand-50 p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white text-xl font-bold">✓</div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">We Never Train on Your Code</h2>
            <p className="mt-2 text-gray-700 leading-relaxed">Your source code, repository contents, issue descriptions, and pull requests are <strong>never used to train or improve our AI models</strong>. Period. Code is processed ephemerally during a fix run and discarded immediately. No training pipelines ingest your data. This guarantee is backed by our <a href="/dpa" className="text-brand-600 underline hover:text-brand-700">Data Processing Agreement</a>.</p>
          </div>
        </div>
      </div>
      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 text-lg">🔒</div>
          <h3 className="mt-4 text-lg font-semibold text-gray-900">Encryption at Rest</h3>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">All customer data is encrypted at rest using <strong>AES-256</strong>. Database storage uses transparent data encryption (TDE) with per-tenant keys. Backups are encrypted with separate keys stored in a hardware security module (HSM) backed keystore.</p>
        </div>
        <div className="rounded-xl border border-gray-200 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 text-lg">🔐</div>
          <h3 className="mt-4 text-lg font-semibold text-gray-900">Encryption in Transit</h3>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">All network traffic uses <strong>TLS 1.3</strong> with strong cipher suites. API endpoints enforce HTTPS-only access. Webhook payloads are signed with HMAC-SHA256 for integrity verification. Internal service communication uses mutual TLS (mTLS).</p>
        </div>
      </div>
      <div className="mt-8 rounded-xl border border-gray-200 p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 text-lg">🛡️</div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">Per-Tenant Data Isolation</h3>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed max-w-3xl">Every customer's data is strictly isolated at the database level using row-level security policies keyed on <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">account_id</code>. No query can access data belonging to another tenant. Sandbox environments are ephemeral and provisioned per-run with no persistent storage between sessions.</p>
      </div>
      <div className="mt-12">
        <h2 className="text-2xl font-bold text-gray-900">SOC 2 Roadmap</h2>
        <p className="mt-2 text-gray-600">We are actively pursuing SOC 2 Type II certification:</p>
        <div className="mt-6 space-y-4">
          {[{ phase: 'Q3 2026', title: 'Gap Analysis', desc: 'Complete SOC 2 readiness assessment against all 5 trust service criteria.' },{ phase: 'Q4 2026', title: 'Control Implementation', desc: 'Implement and document controls for all identified gaps.' },{ phase: 'Q1 2027', title: 'Audit & Certification', desc: 'Engage a licensed CPA firm for SOC 2 Type I audit. Begin Type II observation.' },{ phase: 'Q3 2027', title: 'Type II Report', desc: 'Complete SOC 2 Type II audit with minimum 6-month observation period.' }].map((m) => (
            <div key={m.phase} className="flex gap-4 rounded-lg border border-gray-200 p-4"><div className="flex h-10 w-20 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-sm font-bold text-brand-700">{m.phase}</div><div><h4 className="font-semibold text-gray-900">{m.title}</h4><p className="mt-1 text-sm text-gray-600">{m.desc}</p></div></div>
          ))}
        </div>
      </div>
      <div className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900">Addressing the 6 Trust Concerns</h2>
        <p className="mt-2 text-gray-600">Based on real discussions from developers evaluating AI-powered code tools:</p>
        <div className="mt-8 space-y-6">
          {[{ vector: '"Does SYNTARO train on my code?"', answer: 'No. We have a strict No Training policy. Your code is processed ephemerally per fix run and never used for model training. This is legally binding in our DPA.' },{ vector: '"Is my code stored on your servers?"', answer: 'Only during an active fix run. Repositories are cloned into ephemeral sandboxes destroyed immediately after the run completes.' },{ vector: '"Can you see my private repositories?"', answer: 'SYNTARO operates through a GitHub App with scoped permissions. We can only access repos you explicitly install the app on.' },{ vector: '"What happens if there is a data breach?"', answer: 'We use defense-in-depth: TLS 1.3, AES-256 encryption, per-tenant isolation, ephemeral sandboxes. Incident response includes mandatory 24-hour disclosure.' },{ vector: '"Do you sell or share my data?"', answer: 'Never. We do not sell, rent, or share customer data with third parties. Code is processed exclusively to deliver the fix run you requested.' },{ vector: '"How do I delete my data?"', answer: 'Request data deletion from your Settings page. After cancellation, data is retained for 30 days (grace period for reactivation), then permanently purged.' }].map((item) => (
            <div key={item.vector} className="rounded-xl border border-gray-200 p-6"><h3 className="text-base font-semibold text-gray-900 italic">{item.vector}</h3><p className="mt-2 text-sm text-gray-600 leading-relaxed">{item.answer}</p></div>
          ))}
        </div>
      </div>
    </div>
  );
}
