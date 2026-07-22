import { Link } from 'react-router-dom';
import { useEffect } from 'react';
export default function Pricing() {
  useEffect(() => { document.title = 'Pricing — STAS'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <div className="label">Pricing</div>
        <h2>Simple, Transparent Pricing</h2>
        <p className="sub">Start free. Upgrade when you outgrow us.</p>
      </div>
      <div className="bento-grid" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="bento-item"><h3>Free</h3><p>10 fixes/month, 1 repo, community support. $0</p></div>
        <div className="bento-item"><h3>Solo</h3><p>100 fixes/month, unlimited repos, priority model. $49/mo</p></div>
        <div className="bento-item"><h3>Team</h3><p>500 fixes/month, team analytics, SLA. $149/mo</p></div>
        <div className="bento-item wide"><h3>Enterprise</h3><p>Unlimited fixes, SSO, VPC, dedicated support. Custom pricing.</p></div>
      </div>
      <div className="btn-group" style={{ justifyContent: 'center', marginTop: 48 }}>
        <a href="https://github.com/apps/stasgithub1/installations/new" className="btn btn-primary btn-lg">Get Started Free →</a>
      </div>
    </section>
  );
}
