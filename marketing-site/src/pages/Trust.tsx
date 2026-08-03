import { useEffect } from 'react';
export default function Trust() {
  useEffect(() => { document.title = 'Trust & Security — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <div className="label">Trust</div>
        <h2>Security & Privacy First</h2>
        <p className="sub">Your code is your intellectual property. We treat it that way.</p>
      </div>
      <div className="bento-grid" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="bento-item"><h3>🔒 Ephemeral Sandboxes</h3><p>Every fix runs in a disposable sandbox. Destroyed after execution.</p></div>
        <div className="bento-item"><h3>📝 Audit Trail</h3><p>Every action is logged. Full diff + test results attached to every PR.</p></div>
        <div className="bento-item"><h3>🔑 Open Source</h3><p>MIT licensed. Inspect every line of code. No black boxes.</p></div>
        <div className="bento-item"><h3>🛡️ Quality Gates</h3><p>6 deterministic gates block bad PRs before they reach you.</p></div>
      </div>
    </section>
  );
}
