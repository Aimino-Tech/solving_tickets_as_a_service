import { useEffect } from 'react';

export default function Dpa() {
  useEffect(() => { document.title = 'Data Processing Agreement — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 'calc(var(--nav-height) + 48px)' }}>
      <div className="section-header">
        <div className="label">Legal</div>
        <h1>Data Processing Agreement</h1>
      </div>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Overview</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          This Data Processing Agreement (DPA) governs how SYNTARO processes data on behalf of its users.
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Data Handling</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          SYNTARO processes GitHub issue and repository data solely for the purpose of creating automated fixes. No data is retained after processing.
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Contact</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
          For DPA inquiries, contact dpa@aimino.io.
        </p>
      </div>
    </section>
  );
}