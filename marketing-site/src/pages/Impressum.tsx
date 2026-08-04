import { useEffect } from 'react';

export default function Impressum() {
  useEffect(() => { document.title = 'Impressum — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 'calc(var(--nav-height) + 48px)' }}>
      <div className="section-header">
        <div className="label">Legal</div>
        <h1>Impressum</h1>
      </div>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Angaben gemäß § 5 TMG</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          AImino GmbH<br />
          Musterstraße 1<br />
          10115 Berlin, Germany
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Kontakt</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          E-Mail: contact@aimino.io
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Registereintrag</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
          Eintragung im Handelsregister.<br />
          Registergericht: Amtsgericht Berlin-Charlottenburg<br />
          Registernummer: HRB 123456
        </p>
        <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 16 }}>Umsatzsteuer-ID</h3>
        <p style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
          Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:<br />
          DE123456789
        </p>
      </div>
    </section>
  );
}