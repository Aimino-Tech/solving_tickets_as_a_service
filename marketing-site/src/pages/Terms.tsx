import { useEffect } from 'react';

export default function Terms() {
  useEffect(() => { document.title = 'Terms of Service — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 'calc(var(--nav-height) + 48px)' }}>
      <div className="section-header">
        <div className="label">Legal</div>
        <h1>Terms of Service</h1>
      </div>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Acceptance of Terms</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          By using SYNTARO, you agree to these Terms of Service.
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Service Description</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          SYNTARO is an open-source GitHub automation tool that analyzes issues and creates pull requests.
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Contact</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
          For questions about these terms, contact legal@aimino.io.
        </p>
      </div>
    </section>
  );
}