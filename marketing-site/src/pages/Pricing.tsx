import { useEffect, useState } from 'react';

interface TierProps {
  name: string;
  desc: string;
  price: string;
  period: string;
  features: { text: string; included: boolean }[];
  cta: string;
  ctaLink: string;
  featured?: boolean;
  badge?: string;
  priceId?: string;
}

function TierCard({ name, desc, price, period, features, cta, ctaLink, featured, badge, priceId }: TierProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (!priceId) {
      window.location.href = ctaLink;
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/billing/subscription/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: priceId, successUrl: `${window.location.origin}/pricing/success`, cancelUrl: `${window.location.origin}/pricing` }),
      });
      if (!res.ok) throw new Error('Checkout failed');
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      window.location.href = ctaLink;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`pricing-card${featured ? ' featured' : ''}`}>
      {badge && <div className="pricing-badge">{badge}</div>}
      <div className="pricing-name">{name}</div>
      <div className="pricing-desc">{desc}</div>
      <div className="pricing-price">{price}<span>/mo</span></div>
      <div className="pricing-period">{period}</div>
      <ul className="pricing-features">
        {features.map((f, i) => (
          <li key={i} className={f.included ? '' : 'missing'}>{f.text}</li>
        ))}
      </ul>
      <button className={`btn btn-${featured ? 'primary' : 'secondary'} btn-full`} onClick={handleCheckout} disabled={loading}>
        {loading ? 'Processing...' : cta}
      </button>
    </div>
  );
}

export default function Pricing() {
  useEffect(() => { document.title = 'Pricing — STAS'; }, []);

  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <div className="label">Pricing</div>
        <h2>Simple, Transparent Pricing</h2>
        <p className="sub">Start free. Upgrade when you outgrow us. No hidden fees, no surprises.</p>
      </div>

      <div className="pricing-grid" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <TierCard
          name="Free"
          desc="For individuals and small open-source projects"
          price="$0"
          period="Forever free, no credit card required"
          cta="Get Started Free →"
          ctaLink="https://github.com/apps/stasgithub1/installations/new"
          features={[
            { text: '50 fixes per month', included: true },
            { text: '1 private repository', included: true },
            { text: 'Unlimited public repos', included: true },
            { text: 'Community support', included: true },
            { text: 'Premium AI models', included: false },
            { text: 'Priority queue', included: false },
            { text: 'MCP access', included: false },
          ]}
        />

        <TierCard
          name="Solo"
          desc="For individual developers shipping faster"
          price="$49"
          period="Billed monthly. Cancel anytime."
          cta="Subscribe Now →"
          ctaLink="https://github.com/apps/stasgithub1/installations/new"
          featured
          badge="Most Popular"
          features={[
            { text: '500 fixes per month', included: true },
            { text: '10 private repositories', included: true },
            { text: 'Unlimited public repos', included: true },
            { text: 'Premium AI models (Claude Sonnet, GPT-4o)', included: true },
            { text: 'Priority queue', included: true },
            { text: 'MCP access', included: true },
            { text: 'Priority support', included: true },
          ]}
        />

        <TierCard
          name="Team"
          desc="For teams that need reliability at scale"
          price="$149"
          period="Billed monthly. Cancel anytime."
          cta="Subscribe Now →"
          ctaLink="https://github.com/apps/stasgithub1/installations/new"
          features={[
            { text: '2000 fixes per month', included: true },
            { text: 'Unlimited private repositories', included: true },
            { text: 'Unlimited public repos', included: true },
            { text: 'Premium AI models (Claude Sonnet, GPT-4o)', included: true },
            { text: 'Priority queue', included: true },
            { text: 'MCP access', included: true },
            { text: 'SLA & dedicated support', included: true },
          ]}
        />

        <TierCard
          name="Enterprise"
          desc="For organizations with custom requirements"
          price="Custom"
          period="Tailored to your team"
          cta="Contact Us →"
          ctaLink="mailto:sales@aimino.io"
          features={[
            { text: 'Unlimited fixes', included: true },
            { text: 'Unlimited private repositories', included: true },
            { text: 'All premium AI models', included: true },
            { text: 'Priority queue', included: true },
            { text: 'SSO / SAML', included: true },
            { text: 'VPC / dedicated deployment', included: true },
            { text: 'Custom SLA & support', included: true },
          ]}
        />
      </div>

      <div style={{ textAlign: 'center', marginTop: 64, padding: '32px', background: 'var(--bg2)', borderRadius: 16, maxWidth: 700, margin: '64px auto 0' }}>
        <h3 style={{ marginBottom: 8 }}>All plans include:</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', fontSize: 14, color: 'var(--text2)' }}>
          <span style={{ padding: '4px 12px', background: 'var(--bg3)', borderRadius: 20 }}>🤖 AI-powered investigation</span>
          <span style={{ padding: '4px 12px', background: 'var(--bg3)', borderRadius: 20 }}>🧪 Automatic test running</span>
          <span style={{ padding: '4px 12px', background: 'var(--bg3)', borderRadius: 20 }}>📊 Usage dashboard</span>
          <span style={{ padding: '4px 12px', background: 'var(--bg3)', borderRadius: 20 }}>🔗 MCP integration</span>
          <span style={{ padding: '4px 12px', background: 'var(--bg3)', borderRadius: 20 }}>🔄 Draft PR workflow</span>
        </div>
      </div>
    </section>
  );
}
