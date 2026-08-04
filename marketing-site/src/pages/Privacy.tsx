import { useEffect } from 'react';

export default function Privacy() {
  useEffect(() => { document.title = 'Privacy Policy — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 'calc(var(--nav-height) + 48px)' }}>
      <div className="section-header">
        <div className="label">Legal</div>
        <h1>Privacy Policy</h1>
      </div>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          SYNTARO respects your privacy. We do not collect, store, or share personal data from your GitHub repositories.
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Data Processing</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          All code processing occurs in ephemeral sandboxes that are destroyed after each fix run. Your source code is never stored on our servers.
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Contact</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
          For privacy inquiries, contact us at privacy@aimino.io.
        </p>
      </div>
    </section>
  );
}